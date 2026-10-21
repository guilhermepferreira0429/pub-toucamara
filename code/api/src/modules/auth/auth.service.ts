import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { authConfig } from '../../config/configuration.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';

const LINK_MINUTOS = 15;

interface LinhaUtilizador {
  id: string;
  nome: string;
  email: string;
  perfil: UtilizadorPainel['perfil'];
  municipio_id: string | null;
  servico_id: string | null;
  foto_url: string | null;
}

function paraUtilizador(u: LinhaUtilizador): UtilizadorPainel {
  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    perfil: u.perfil,
    municipioId: u.municipio_id,
    servicoId: u.servico_id,
  };
}

function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/**
 * Login do painel na semana: link mágico por email (uso único, 15 min) →
 * JWT curto. Na V2, OIDC da câmara.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private cfg() {
    return this.config.getOrThrow<ConfigType<typeof authConfig>>('auth');
  }

  private segredo(): Uint8Array {
    let s = this.cfg().jwtSecret;
    if (!s) {
      if (this.config.get<string>('app.ambiente') === 'production') {
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'auth_sem_segredo',
          'JWT_SECRET é obrigatório em produção.',
        );
      }
      s = 'dev-jwt-secret';
    }
    return new TextEncoder().encode(s);
  }

  /** Manda o link se o email existir. Responde sempre igual (não revela contas). */
  async pedirLink(email: string): Promise<void> {
    const [u] = await this.db.query<LinhaUtilizador>(
      'SELECT id, nome, email FROM utilizadores WHERE email = $1 AND ativo',
      [email],
    );
    if (!u) return;
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO links_magicos (utilizador_id, token_hash, expira_em)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [u.id, hashToken(token), LINK_MINUTOS],
    );
    const url = `${this.config.get<string>('app.webUrl')}/entrar?token=${token}`;
    await this.mensagens.email({
      para: u.email,
      assunto: 'Entrar no painel Tou, Câmara?',
      texto: `Olá ${u.nome},\n\nPara entrar no painel, abra este link nos próximos ${LINK_MINUTOS} minutos:\n${url}\n\nSe não pediu, ignore este email.`,
    });
  }

  /**
   * Token de entrada de uso único para um utilizador ativo do município (o
   * mesmo do link mágico), depois de o fornecedor OIDC da câmara o
   * identificar. A equipa interna não entra por aqui.
   */
  async linkDeEntrada(
    email: string,
    municipioId: string,
  ): Promise<string | null> {
    const [u] = await this.db.query<{ id: string }>(
      `SELECT id FROM utilizadores
       WHERE lower(email) = $1 AND ativo AND municipio_id = $2`,
      [email, municipioId],
    );
    if (!u) return null;
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `INSERT INTO links_magicos (utilizador_id, token_hash, expira_em)
       VALUES ($1, $2, now() + interval '2 minutes')`,
      [u.id, hashToken(token)],
    );
    return token;
  }

  /** Troca o token do link por um JWT. */
  async entrar(
    token: string,
    ip?: string,
  ): Promise<{
    token: string;
    expira_em: string;
    utilizador: UtilizadorPainel;
  }> {
    const [u] = await this.db.query<LinhaUtilizador>(
      `UPDATE links_magicos l SET usado_em = now()
       FROM utilizadores u
       WHERE l.token_hash = $1 AND l.usado_em IS NULL AND l.expira_em > now()
         AND u.id = l.utilizador_id AND u.ativo
       RETURNING u.id, u.nome, u.email, u.perfil, u.municipio_id, u.servico_id`,
      [hashToken(token)],
    );
    if (!u) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'link_invalido',
        'O link expirou ou já foi usado. Peça outro.',
      );
    }
    await this.db.query(
      'UPDATE utilizadores SET ultimo_acesso_em = now() WHERE id = $1',
      [u.id],
    );
    await this.auditoria.registar({
      municipioId: u.municipio_id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'entrar',
      objetoTipo: 'utilizador',
      objetoId: u.id,
      ip,
    });
    const horas = this.cfg().validadeHoras;
    const { SignJWT } = await import('jose');
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(u.id)
      .setIssuedAt()
      .setExpirationTime(`${horas}h`)
      .sign(this.segredo());
    return {
      token: jwt,
      expira_em: new Date(Date.now() + horas * 3_600_000).toISOString(),
      utilizador: paraUtilizador(u),
    };
  }

  /** Valida o JWT e carrega o utilizador (desativado = fora). */
  async verificar(jwt: string): Promise<UtilizadorPainel> {
    let id: string | undefined;
    try {
      const { jwtVerify } = await import('jose');
      const { payload } = await jwtVerify(jwt, this.segredo(), {
        algorithms: ['HS256'],
      });
      id = payload.sub;
    } catch {
      id = undefined;
    }
    const [u] = id
      ? await this.db.query<LinhaUtilizador>(
          `SELECT id, nome, email, perfil, municipio_id, servico_id
           FROM utilizadores WHERE id = $1 AND ativo`,
          [id],
        )
      : [];
    if (!u) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'nao_autenticado',
        'Sessão inválida ou expirada.',
      );
    }
    return paraUtilizador(u);
  }

  async perfil(id: string) {
    const [u] = await this.db.query<LinhaUtilizador>(
      `SELECT id, nome, email, perfil, municipio_id, servico_id, foto_url
       FROM utilizadores WHERE id = $1`,
      [id],
    );
    return u;
  }
}
