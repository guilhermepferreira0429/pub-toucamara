import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LimitePedidos } from '../chat/limite.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { AuthService } from './auth.service.js';
import { pode, type Perfil } from './permissoes.js';

export const VALIDADE_CODIGO_MIN = 10;
export const MAX_TENTATIVAS = 5;
/** A sessão do telemóvel dura 30 dias (revogável a qualquer momento). */
export const VALIDADE_SESSAO_DIAS = 30;

export const esquemaPedirCodigoEquipa = z.object({
  email: z.email().toLowerCase(),
});

export const esquemaEntrarEquipa = z.object({
  email: z.email().toLowerCase(),
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Código de 6 dígitos.'),
  /** O que a app disser do telemóvel ("Samsung Galaxy A52"). */
  dispositivo: z.string().trim().max(120).optional(),
});

/** Quem pode usar a app de campo: quem faz fiscalização ou trata ocorrências. */
export function perfilDeCampo(perfil: Perfil): boolean {
  return pode(perfil, 'fiscalizacao') || pode(perfil, 'ocorrencias');
}

interface LinhaUtilizador {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  municipio_id: string | null;
  servico_id: string | null;
}

/**
 * Entrar na app da equipa de campo: código de 6 dígitos por email (só o
 * hash, 10 minutos, 5 tentativas; 5 códigos por hora por email e 10 por 10
 * minutos por IP) e um JWT do painel ligado a uma sessão do dispositivo,
 * revogável (o PainelGuard recusa-o depois de sair). Responde sempre igual
 * a emails que não existem ou sem perfil de campo (não revela contas).
 */
@Injectable()
export class AppEquipaService {
  private readonly limiteIp = new LimitePedidos(10, 10 * 60_000);
  private readonly limiteEmail = new LimitePedidos(5, 60 * 60_000);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async pedirCodigo(
    dados: z.output<typeof esquemaPedirCodigoEquipa>,
    ip: string | undefined,
  ) {
    if (
      (ip && !this.limiteIp.permitir(ip)) ||
      !this.limiteEmail.permitir(dados.email)
    ) {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiados_pedidos',
        'Já pediu vários códigos. Tente daqui a pouco.',
      );
    }
    const resposta = {
      enviado: true,
      validade_minutos: VALIDADE_CODIGO_MIN,
    };
    const [u] = await this.db.query<LinhaUtilizador>(
      `SELECT id, nome, email, perfil FROM utilizadores
       WHERE lower(email) = $1 AND ativo`,
      [dados.email],
    );
    if (!u || !perfilDeCampo(u.perfil)) return resposta;

    const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      // Só o último código vale.
      await tx.query(
        `UPDATE painel_app_codigos SET expira_em = least(expira_em, now())
         WHERE utilizador_id = $1 AND usado_em IS NULL`,
        [u.id],
      );
      await tx.query(
        `INSERT INTO painel_app_codigos (id, utilizador_id, codigo_hash, expira_em)
         VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
        [id, u.id, this.hash(`codigo:${id}:${codigo}`), VALIDADE_CODIGO_MIN],
      );
    });
    await this.mensagens.email({
      para: u.email,
      assunto: `Código para a app Tou, Câmara · Equipa: ${codigo}`,
      texto: `Olá ${u.nome},\n\nO seu código para entrar na app da equipa é ${codigo}. É válido ${VALIDADE_CODIGO_MIN} minutos.\n\nNão o partilhe com ninguém. Se não pediu, ignore este email.`,
    });
    return resposta;
  }

  /** Confere o código e abre a sessão do telemóvel. O token só sai aqui. */
  async entrar(
    dados: z.output<typeof esquemaEntrarEquipa>,
    ip: string | undefined,
  ) {
    const r = await this.db.transaction(async (tx) => {
      const [c] = await tx.query<
        LinhaUtilizador & {
          codigo_id: string;
          codigo_hash: Buffer;
          tentativas: number;
        }
      >(
        `SELECT c.id AS codigo_id, c.codigo_hash, c.tentativas,
                u.id, u.nome, u.email, u.perfil, u.municipio_id, u.servico_id
         FROM painel_app_codigos c JOIN utilizadores u ON u.id = c.utilizador_id
         WHERE lower(u.email) = $1 AND u.ativo
           AND c.usado_em IS NULL AND c.expira_em > now()
         ORDER BY c.criado_em DESC LIMIT 1
         FOR UPDATE OF c`,
        [dados.email],
      );
      if (!c || !perfilDeCampo(c.perfil))
        return { estado: 'sem_codigo' as const };
      if (c.tentativas >= MAX_TENTATIVAS)
        return { estado: 'esgotado' as const };
      const certo = timingSafeEqual(
        c.codigo_hash,
        this.hash(`codigo:${c.codigo_id}:${dados.codigo}`),
      );
      if (!certo) {
        await tx.query(
          'UPDATE painel_app_codigos SET tentativas = tentativas + 1 WHERE id = $1',
          [c.codigo_id],
        );
        return {
          estado: 'errado' as const,
          restantes: MAX_TENTATIVAS - c.tentativas - 1,
        };
      }
      await tx.query(
        'UPDATE painel_app_codigos SET usado_em = now() WHERE id = $1',
        [c.codigo_id],
      );
      const expira = new Date(
        Date.now() + VALIDADE_SESSAO_DIAS * 24 * 3_600_000,
      );
      const [s] = await tx.query<{ id: string }>(
        `INSERT INTO painel_app_sessoes (utilizador_id, dispositivo, expira_em, ultimo_uso_em)
         VALUES ($1, $2, $3, now()) RETURNING id`,
        [c.id, dados.dispositivo || null, expira],
      );
      await tx.query(
        'UPDATE utilizadores SET ultimo_acesso_em = now() WHERE id = $1',
        [c.id],
      );
      await this.auditoria.registar(
        {
          municipioId: c.municipio_id,
          atorTipo: 'utilizador',
          atorId: c.id,
          acao: 'entrar_app_equipa',
          objetoTipo: 'sessao_app_equipa',
          objetoId: s.id,
          dados: { dispositivo: dados.dispositivo ?? null },
          ip,
        },
        tx,
      );
      return { estado: 'ok' as const, sessao: s.id, expira, u: c };
    });

    // Os erros saem depois do COMMIT, para a tentativa falhada contar.
    if (r.estado === 'sem_codigo') {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'codigo_expirado',
        'Não há código válido. Peça um novo.',
      );
    }
    if (r.estado === 'esgotado') {
      throw new ErroApi(
        HttpStatus.TOO_MANY_REQUESTS,
        'demasiadas_tentativas',
        'Código errado demasiadas vezes. Peça um novo.',
      );
    }
    if (r.estado === 'errado') {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'codigo_errado',
        'Código errado.',
        { tentativas_restantes: r.restantes },
      );
    }
    const municipio = r.u.municipio_id
      ? (
          await this.db.query<{ slug: string; nome: string }>(
            'SELECT slug, nome FROM municipios WHERE id = $1',
            [r.u.municipio_id],
          )
        )[0]
      : null;
    return {
      token: await this.auth.emitir(r.u.id, r.expira, r.sessao),
      expira_em: r.expira.toISOString(),
      sessao_id: r.sessao,
      utilizador: {
        id: r.u.id,
        nome: r.u.nome,
        email: r.u.email,
        perfil: r.u.perfil,
        municipioId: r.u.municipio_id,
        servicoId: r.u.servico_id,
      },
      municipio: municipio ?? null,
    };
  }

  /** As sessões de telemóvel ativas desta pessoa (ecrã "Sessão"). */
  async sessoes(u: UtilizadorPainel) {
    const linhas = await this.db.query<{ id: string }>(
      `SELECT id, dispositivo, criada_em, ultimo_uso_em, expira_em
       FROM painel_app_sessoes
       WHERE utilizador_id = $1 AND revogada_em IS NULL AND expira_em > now()
       ORDER BY criada_em DESC`,
      [u.id],
    );
    return {
      itens: linhas.map((s) => ({ ...s, esta: s.id === u.sessaoAppId })),
    };
  }

  /**
   * Termina uma sessão: a própria (sair) ou outra da mesma pessoa; a chefia
   * (recurso 'equipa') termina as de qualquer pessoa do município.
   */
  async revogar(
    municipioId: string,
    u: UtilizadorPainel,
    sessaoId: string,
    ip: string | undefined,
  ) {
    const chefia = pode(u.perfil, 'equipa');
    const [s] = await this.db.query<{ id: string; utilizador_id: string }>(
      `UPDATE painel_app_sessoes s
       SET revogada_em = coalesce(s.revogada_em, now()),
           revogada_por = coalesce(s.revogada_por, CASE WHEN s.utilizador_id = $2 THEN 'utilizador' ELSE 'chefia' END)
       FROM utilizadores w
       WHERE s.id = $1 AND w.id = s.utilizador_id
         AND (s.utilizador_id = $2 OR ($3 AND w.municipio_id = $4))
       RETURNING s.id, s.utilizador_id`,
      [sessaoId, u.id, chefia, municipioId],
    );
    if (!s) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sessao_nao_encontrada',
        'Sessão não encontrada.',
      );
    }
    await this.auditoria.registar({
      municipioId,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: s.utilizador_id === u.id ? 'sair_app_equipa' : 'revogar_app_equipa',
      objetoTipo: 'sessao_app_equipa',
      objetoId: s.id,
      ip,
    });
    return { revogada: true };
  }

  private hash(texto: string): Buffer {
    const segredo = this.config.get<string>('app.dadosChave') || 'dev-app';
    return createHmac('sha256', `equipa:${segredo}`).update(texto).digest();
  }
}
