import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
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

/** Comparação em tempo constante (pelo hash, para os tamanhos serem iguais). */
function iguais(a: string, b: string): boolean {
  return timingSafeEqual(hashToken(a), hashToken(b));
}

/** O que `entrar` e `entrarJuri` devolvem: o JWT e quem entrou. */
export interface SessaoPainel {
  token: string;
  expira_em: string;
  utilizador: UtilizadorPainel;
}

const NOME_JURI = 'Júri do Hack4Guimarães';

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

  /**
   * Acesso do júri ligado e dentro do prazo: o email, a chave do link, até
   * quando vale e o município. Sem os três valores, ou depois do prazo, null.
   */
  private juri(): {
    email: string;
    chave: string;
    ate: Date;
    municipio: string;
  } | null {
    const j = this.cfg().juri;
    const ate = new Date(j.ate);
    if (!j.email || !j.chave || Number.isNaN(ate.getTime())) return null;
    if (ate.getTime() <= Date.now()) return null;
    return { ...j, ate };
  }

  /** O email do júri (escrito no /entrar) entra sem link por email. */
  eEmailDoJuri(email: string): boolean {
    const j = this.juri();
    return !!j && iguais(email.trim().toLowerCase(), j.email);
  }

  /**
   * Entrar como júri, com a chave do link ou o email: uma sessão só de
   * leitura (o PainelGuard recusa o que altera dados) que nunca passa do
   * prazo. O utilizador do júri cria-se na primeira entrada, com o perfil
   * que vê todas as áreas; desativá-lo na Equipa corta o acesso.
   */
  async entrarJuri(chave: string, ip?: string): Promise<SessaoPainel> {
    const j = this.juri();
    const c = chave.trim();
    if (!j || !(iguais(c, j.chave) || iguais(c.toLowerCase(), j.email))) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'juri_invalido',
        'Este acesso não é válido ou já terminou.',
      );
    }
    const [u] = await this.db.query<LinhaUtilizador & { ativo: boolean }>(
      `INSERT INTO utilizadores (municipio_id, email, nome, perfil)
       SELECT id, $2, $3, 'chefe_divisao' FROM municipios WHERE slug = $1
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, nome, email, perfil, municipio_id, servico_id, ativo`,
      [j.municipio, j.email, NOME_JURI],
    );
    if (!u?.ativo) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'juri_invalido',
        'Este acesso não é válido ou já terminou.',
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
      acao: 'entrar_juri',
      objetoTipo: 'utilizador',
      objetoId: u.id,
      ip,
    });
    const horas = this.cfg().validadeHoras;
    const expira = new Date(
      Math.min(Date.now() + horas * 3_600_000, j.ate.getTime()),
    );
    return {
      token: await this.emitir(u.id, expira, undefined, { leitura: true }),
      expira_em: expira.toISOString(),
      utilizador: {
        ...paraUtilizador(u),
        soLeitura: true,
        acessoAte: j.ate.toISOString(),
      },
    };
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
  async entrar(token: string, ip?: string): Promise<SessaoPainel> {
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
    const expira = new Date(Date.now() + horas * 3_600_000);
    return {
      token: await this.emitir(u.id, expira),
      expira_em: expira.toISOString(),
      utilizador: paraUtilizador(u),
    };
  }

  /**
   * O JWT do painel. Com `sessaoApp` (app da equipa de campo) leva o id da
   * sessão do dispositivo em `sid`: deixa de valer quando ela for revogada.
   */
  async emitir(
    utilizadorId: string,
    expira: Date,
    sessaoApp?: string,
    extra: { leitura?: true } = {},
  ): Promise<string> {
    const { SignJWT } = await import('jose');
    return new SignJWT({ ...(sessaoApp ? { sid: sessaoApp } : {}), ...extra })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(utilizadorId)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expira.getTime() / 1000))
      .sign(this.segredo());
  }

  /** Valida o JWT e carrega o utilizador (desativado = fora). */
  async verificar(jwt: string): Promise<UtilizadorPainel> {
    let id: string | undefined;
    let sid: string | null = null;
    let leitura = false;
    try {
      const { jwtVerify } = await import('jose');
      const { payload } = await jwtVerify(jwt, this.segredo(), {
        algorithms: ['HS256'],
      });
      id = payload.sub;
      sid = typeof payload['sid'] === 'string' ? payload['sid'] : null;
      leitura = payload['leitura'] === true;
    } catch {
      id = undefined;
    }
    // O júri: o acesso acaba no prazo (ou quando se desliga), mesmo com o JWT válido.
    const juri = leitura ? this.juri() : null;
    if (leitura && !juri) id = undefined;
    // Sessão da app da equipa: tem de estar ativa (sair/revogar corta-a).
    const [u] = id
      ? await this.db.query<LinhaUtilizador>(
          `SELECT u.id, u.nome, u.email, u.perfil, u.municipio_id, u.servico_id
           FROM utilizadores u
           WHERE u.id = $1 AND u.ativo
             AND ($2::uuid IS NULL OR EXISTS (
               SELECT 1 FROM painel_app_sessoes s
               WHERE s.id = $2 AND s.utilizador_id = u.id
                 AND s.revogada_em IS NULL AND s.expira_em > now()))`,
          [id, sid],
        )
      : [];
    if (u && sid) {
      await this.db.query(
        `UPDATE painel_app_sessoes SET ultimo_uso_em = now()
         WHERE id = $1 AND (ultimo_uso_em IS NULL OR ultimo_uso_em < now() - interval '5 minutes')`,
        [sid],
      );
    }
    if (!u) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'nao_autenticado',
        'Sessão inválida ou expirada.',
      );
    }
    if (juri) {
      return {
        ...paraUtilizador(u),
        soLeitura: true,
        acessoAte: juri.ate.toISOString(),
      };
    }
    return sid ? { ...paraUtilizador(u), sessaoAppId: sid } : paraUtilizador(u);
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
