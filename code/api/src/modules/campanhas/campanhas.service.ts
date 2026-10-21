import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import {
  ContextoChamada,
  instanteLocal,
  local,
  telefoneLigavel,
} from '../chamadas-saida/regras.js';
import {
  MunicipesService,
  normalizarTelefone,
} from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  ESTADOS_DESTINATARIO,
  EstadoDestinatario,
  NECESSIDADES,
  PRESETS,
  TIPOS_CAMPANHA,
} from './regras.js';

export const esquemaContacto = z.object({
  nome: z.string().trim().min(1).max(120),
  telefone: z.string().trim().min(6).max(25),
  morada: z.string().trim().max(300).optional(),
  freguesia: z.string().trim().max(120).optional(),
  notas: z.string().trim().max(500).optional(),
  consentimento_origem: z
    .enum(['balcao', 'telefone', 'formulario', 'acao_social'])
    .default('acao_social'),
});

const freguesias = z
  .array(z.string().trim().min(1).max(120))
  .max(100)
  .optional();

export const esquemaPreVisualizar = z.object({ freguesias });

export const esquemaCampanha = z.object({
  tipo: z.enum(TIPOS_CAMPANHA),
  titulo: z.string().trim().min(3).max(120),
  mensagem: z.string().trim().min(10).max(600),
  perguntas: z.array(z.string().trim().min(3).max(200)).min(1).max(5),
  sms_recurso: z.string().trim().min(10).max(320),
  freguesias,
  /** Emergência: liga já, a qualquer hora. Por omissão, das 9h às 21h. */
  ignorar_horario: z.boolean().default(false),
});

export const esquemaTratar = z.object({
  nota: z.string().trim().max(500).optional(),
  estado: z.enum(['bem', 'precisa_ajuda']).optional(),
});

export const entradaResposta = z.object({
  estado: z
    .enum(['bem', 'precisa_ajuda'])
    .describe(
      '"bem" se a pessoa está bem e não precisa de nada; "precisa_ajuda" se pediu ou precisa de alguma coisa, ou se ficaste preocupado.',
    ),
  necessidades: z
    .array(z.enum(NECESSIDADES))
    .max(NECESSIDADES.length)
    .default([])
    .describe(
      'O que precisa: agua, transporte, medicamentos, companhia, saude, alimentacao, outro.',
    ),
  nota: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe(
      'O que a pessoa disse, em poucas palavras (ex.: "está sozinha, sem água fresca, tonturas").',
    ),
});

/** Campanhas de 9h às 21h, todos os dias (o calor não espera por segunda). */
const HORA_INICIO = 9;
const HORA_FIM = 21;

interface Destinatario {
  id: string;
  nome: string;
  telefone: string | null;
  morada: string | null;
  freguesia: string | null;
  notas: string | null;
  estado: EstadoDestinatario;
  necessidades: string[];
  nota: string | null;
  respondido_em: Date | null;
  tratado_em: Date | null;
  tratado_nota: string | null;
  tratado_por_nome: string | null;
  tentativas: number | null;
  chamada_erro: string | null;
  conversa_id: string | null;
}

/**
 * Campanhas de contacto: a câmara carrega num botão e o agente liga a todas
 * as pessoas inscritas (com autorização). As chamadas são as de saída de
 * sempre (`chamadas_saida`, motivo 'campanha'); quem não atende recebe SMS.
 */
@Injectable()
export class CampanhasService {
  constructor(
    private readonly db: DatabaseService,
    private readonly municipes: MunicipesService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ------------------------------------------------------------------
  // Pessoas inscritas
  // ------------------------------------------------------------------

  async contactos(m: Municipio) {
    const linhas = await this.db.query<{
      id: string;
      nome: string;
      telefone: string | null;
      morada: string | null;
      freguesia: string | null;
      notas: string | null;
      consentimento_em: Date;
      consentimento_origem: string;
      aceita_chamadas: boolean;
    }>(
      `SELECT c.id, c.nome, mu.telefone_e164 AS telefone, c.morada, c.freguesia, c.notas,
              c.consentimento_em, c.consentimento_origem, mu.aceita_chamadas
       FROM contactos_cuidado c JOIN municipes mu ON mu.id = c.municipe_id
       WHERE c.municipio_id = $1 AND c.ativo AND mu.anonimizado_em IS NULL
       ORDER BY c.freguesia NULLS LAST, c.nome`,
      [m.id],
    );
    return {
      contactos: linhas.map((l) => ({
        ...l,
        consentimento_em: l.consentimento_em.toISOString(),
        ligavel: telefoneLigavel(l.telefone) && l.aceita_chamadas,
      })),
      freguesias: contarFreguesias(linhas),
      presets: PRESETS,
    };
  }

  async criarContacto(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaContacto>,
  ) {
    const telefone = normalizarTelefone(d.telefone);
    if (!telefone) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'telefone_invalido',
        'Número de telefone inválido.',
      );
    }
    return this.db.transaction(async (tx) => {
      const municipe = await this.municipes.porTelefone(m.id, telefone, tx);
      if (!municipe) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'telefone_invalido',
          'Número de telefone inválido.',
        );
      }
      await tx.query(
        'UPDATE municipes SET nome = coalesce(nome, $2) WHERE id = $1',
        [municipe.id, d.nome],
      );
      const [c] = await tx.query<{ id: string }>(
        `INSERT INTO contactos_cuidado (municipio_id, municipe_id, nome, morada, freguesia, notas,
           consentimento_em, consentimento_origem, criado_por)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
         ON CONFLICT (municipio_id, municipe_id) DO UPDATE
           SET nome = EXCLUDED.nome, morada = EXCLUDED.morada, freguesia = EXCLUDED.freguesia,
               notas = EXCLUDED.notas, ativo = true,
               consentimento_em = EXCLUDED.consentimento_em,
               consentimento_origem = EXCLUDED.consentimento_origem
         RETURNING id`,
        [
          m.id,
          municipe.id,
          d.nome,
          d.morada ?? null,
          d.freguesia ?? null,
          d.notas ?? null,
          d.consentimento_origem,
          u.id,
        ],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'inscrever_contacto_cuidado',
          objetoTipo: 'contacto_cuidado',
          objetoId: c.id,
          dados: { origem: d.consentimento_origem },
        },
        tx,
      );
      return { id: c.id };
    });
  }

  async removerContacto(m: Municipio, u: UtilizadorPainel, id: string) {
    const [c] = await this.db.query<{ id: string }>(
      `UPDATE contactos_cuidado SET ativo = false
       WHERE id = $1 AND municipio_id = $2 AND ativo RETURNING id`,
      [id, m.id],
    );
    if (!c) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'contacto_desconhecido',
        'Esta pessoa não está inscrita.',
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'remover_contacto_cuidado',
      objetoTipo: 'contacto_cuidado',
      objetoId: id,
    });
    return { removido: true };
  }

  // ------------------------------------------------------------------
  // Campanhas
  // ------------------------------------------------------------------

  async preVisualizar(m: Municipio, f: z.output<typeof esquemaPreVisualizar>) {
    const alvo = await this.alvo(this.db, m.id, f.freguesias);
    const ligaveis = alvo.filter((a) => a.ligavel);
    return {
      destinatarios: alvo.length,
      a_ligar: ligaveis.length,
      sem_telefone: alvo.filter((a) => !telefoneLigavel(a.telefone)).length,
      recusam_chamadas: alvo.filter(
        (a) => telefoneLigavel(a.telefone) && !a.aceita_chamadas,
      ).length,
      // Ao ritmo do job (20 por minuto), quanto demora a ligar a todos.
      minutos_estimados: Math.max(1, Math.ceil(ligaveis.length / 20)),
    };
  }

  async criar(
    m: Municipio,
    u: UtilizadorPainel,
    d: z.output<typeof esquemaCampanha>,
    agora = new Date(),
  ) {
    return this.db.transaction(async (tx) => {
      const alvo = await this.alvo(tx, m.id, d.freguesias);
      if (alvo.length === 0) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'sem_destinatarios',
          'Não há pessoas inscritas para estas freguesias.',
        );
      }
      const [c] = await tx.query<{ id: string }>(
        `INSERT INTO campanhas (municipio_id, tipo, titulo, mensagem, perguntas, sms_recurso,
           freguesias, ignorar_horario, criada_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          m.id,
          d.tipo,
          d.titulo,
          d.mensagem,
          JSON.stringify(d.perguntas),
          d.sms_recurso,
          d.freguesias?.length ? d.freguesias : null,
          d.ignorar_horario,
          u.id,
        ],
      );
      const quando = d.ignorar_horario
        ? agora
        : proximaHoraCampanha(agora, m.fuso);
      let aLigar = 0;
      for (const a of alvo) {
        const destId = randomUUID();
        if (!telefoneLigavel(a.telefone)) {
          await tx.query(
            `INSERT INTO campanha_destinatarios (id, campanha_id, contacto_id, municipe_id, estado)
             VALUES ($1, $2, $3, $4, 'sem_ligacao')`,
            [destId, c.id, a.contacto_id, a.municipe_id],
          );
          continue;
        }
        const contexto: ContextoChamada = {
          numero_processo: '',
          o_que_mudou: d.mensagem,
          o_que_falta: '',
          prazo: '',
          link: '',
          nota: `Perguntas: ${d.perguntas.join(' ')} No fim, regista a resposta com resposta_campanha.`,
          campanha: {
            id: c.id,
            destinatario_id: destId,
            perguntas: d.perguntas,
          },
        };
        const chave = `campanha:${destId}`;
        // A recusa de chamadas é tratada pelo job (cancela e manda o SMS).
        const [ch] = await tx.query<{ id: string }>(
          `INSERT INTO chamadas_saida (municipio_id, municipe_id, telefone_e164, motivo, contexto,
             recurso, agendada_para, forcar_horario, chave, criada_por)
           VALUES ($1, $2, $3, 'campanha', $4, $5, $6, true, $7, $8) RETURNING id`,
          [
            m.id,
            a.municipe_id,
            a.telefone,
            JSON.stringify(contexto),
            JSON.stringify({
              corpo: d.sms_recurso,
              chave,
              motivo: 'aviso',
              relacionado: { campanha_id: c.id },
            }),
            quando,
            chave,
            u.id,
          ],
        );
        await tx.query(
          `INSERT INTO campanha_destinatarios (id, campanha_id, contacto_id, municipe_id, estado, chamada_saida_id)
           VALUES ($1, $2, $3, $4, 'a_ligar', $5)`,
          [destId, c.id, a.contacto_id, a.municipe_id, ch.id],
        );
        aLigar++;
      }
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'lancar_campanha',
          objetoTipo: 'campanha',
          objetoId: c.id,
          dados: { tipo: d.tipo, destinatarios: alvo.length, a_ligar: aLigar },
        },
        tx,
      );
      return {
        id: c.id,
        destinatarios: alvo.length,
        a_ligar: aLigar,
        comeca_em: quando.toISOString(),
      };
    });
  }

  async listar(m: Municipio) {
    await this.sincronizar(m.id);
    const linhas = await this.db.query<{
      id: string;
      tipo: string;
      titulo: string;
      estado: string;
      criada_em: Date;
      terminada_em: Date | null;
      criada_por_nome: string | null;
      contagens: Record<string, number>;
    }>(
      `SELECT c.id, c.tipo, c.titulo, c.estado, c.criada_em, c.terminada_em,
              u.nome AS criada_por_nome,
              coalesce((SELECT jsonb_object_agg(estado, n) FROM (
                 SELECT estado, count(*)::int AS n FROM campanha_destinatarios
                 WHERE campanha_id = c.id GROUP BY estado) x), '{}') AS contagens
       FROM campanhas c LEFT JOIN utilizadores u ON u.id = c.criada_por
       WHERE c.municipio_id = $1
       ORDER BY c.criada_em DESC LIMIT 50`,
      [m.id],
    );
    return {
      campanhas: linhas.map((l) => ({
        ...l,
        criada_em: l.criada_em.toISOString(),
        terminada_em: l.terminada_em?.toISOString() ?? null,
        contagens: completar(l.contagens),
      })),
    };
  }

  async detalhe(m: Municipio, id: string) {
    await this.sincronizar(m.id);
    const [c] = await this.db.query<{
      id: string;
      tipo: string;
      titulo: string;
      mensagem: string;
      perguntas: string[];
      sms_recurso: string;
      freguesias: string[] | null;
      ignorar_horario: boolean;
      estado: string;
      criada_em: Date;
      terminada_em: Date | null;
      criada_por_nome: string | null;
    }>(
      `SELECT c.id, c.tipo, c.titulo, c.mensagem, c.perguntas, c.sms_recurso, c.freguesias,
              c.ignorar_horario, c.estado, c.criada_em, c.terminada_em, u.nome AS criada_por_nome
       FROM campanhas c LEFT JOIN utilizadores u ON u.id = c.criada_por
       WHERE c.id = $1 AND c.municipio_id = $2`,
      [id, m.id],
    );
    if (!c) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'campanha_desconhecida',
        'Esta campanha não existe.',
      );
    }
    const dest = await this.db.query<Destinatario>(
      `SELECT d.id, cc.nome, mu.telefone_e164 AS telefone, cc.morada, cc.freguesia, cc.notas,
              d.estado, d.necessidades, d.nota, d.respondido_em, d.tratado_em, d.tratado_nota,
              ut.nome AS tratado_por_nome, cs.tentativas, cs.erro AS chamada_erro, cs.conversa_id
       FROM campanha_destinatarios d
       JOIN contactos_cuidado cc ON cc.id = d.contacto_id
       JOIN municipes mu ON mu.id = d.municipe_id
       LEFT JOIN chamadas_saida cs ON cs.id = d.chamada_saida_id
       LEFT JOIN utilizadores ut ON ut.id = d.tratado_por
       WHERE d.campanha_id = $1
       ORDER BY ${ORDEM_ESTADO}, d.tratado_em NULLS FIRST, cc.freguesia NULLS LAST, cc.nome`,
      [id],
    );
    const contagens = completar(
      dest.reduce<Record<string, number>>((a, d) => {
        a[d.estado] = (a[d.estado] ?? 0) + 1;
        return a;
      }, {}),
    );
    return {
      ...c,
      criada_em: c.criada_em.toISOString(),
      terminada_em: c.terminada_em?.toISOString() ?? null,
      contagens,
      total: dest.length,
      destinatarios: dest.map((d) => ({
        ...d,
        respondido_em: d.respondido_em?.toISOString() ?? null,
        tratado_em: d.tratado_em?.toISOString() ?? null,
      })),
    };
  }

  async cancelar(m: Municipio, u: UtilizadorPainel, id: string) {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.query<{ estado: string }>(
        `SELECT estado FROM campanhas WHERE id = $1 AND municipio_id = $2 FOR UPDATE`,
        [id, m.id],
      );
      if (!c) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'campanha_desconhecida',
          'Esta campanha não existe.',
        );
      }
      if (c.estado !== 'a_ligar') return { cancelada: false, estado: c.estado };
      // Só as que ainda não tocaram; as que estão a tocar seguem.
      const canceladas = await tx.query<{ id: string }>(
        `UPDATE chamadas_saida cs SET estado = 'cancelada', terminada_em = now(),
           erro = 'Campanha cancelada.'
         FROM campanha_destinatarios d
         WHERE d.chamada_saida_id = cs.id AND d.campanha_id = $1 AND cs.estado = 'agendada'
         RETURNING d.id`,
        [id],
      );
      await tx.query(
        `UPDATE campanha_destinatarios SET estado = 'cancelado'
         WHERE id = ANY($1::uuid[])`,
        [canceladas.map((x) => x.id)],
      );
      await tx.query(
        `UPDATE campanhas SET estado = 'cancelada', terminada_em = now() WHERE id = $1`,
        [id],
      );
      await this.auditoria.registar(
        {
          municipioId: m.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'cancelar_campanha',
          objetoTipo: 'campanha',
          objetoId: id,
          dados: { chamadas_canceladas: canceladas.length },
        },
        tx,
      );
      return { cancelada: true, chamadas_canceladas: canceladas.length };
    });
  }

  /** A ação social tratou (ou falou com a pessoa por outro meio). */
  async tratar(
    m: Municipio,
    u: UtilizadorPainel,
    destId: string,
    d: z.output<typeof esquemaTratar>,
  ) {
    const [r] = await this.db.query<{ id: string }>(
      `UPDATE campanha_destinatarios d
       SET tratado_em = now(), tratado_por = $3, tratado_nota = $4,
           estado = coalesce($5, d.estado),
           respondido_em = CASE WHEN $5::text IS NULL THEN d.respondido_em ELSE coalesce(d.respondido_em, now()) END
       FROM campanhas c
       WHERE d.id = $1 AND c.id = d.campanha_id AND c.municipio_id = $2
       RETURNING d.id`,
      [destId, m.id, u.id, d.nota ?? null, d.estado ?? null],
    );
    if (!r) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'destinatario_desconhecido',
        'Esta pessoa não está nesta campanha.',
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'tratar_destinatario_campanha',
      objetoTipo: 'campanha_destinatario',
      objetoId: destId,
    });
    return { tratado: true };
  }

  // ------------------------------------------------------------------
  // Ferramenta do agente
  // ------------------------------------------------------------------

  async resposta(ctx: ContextoFerramenta, e: z.output<typeof entradaResposta>) {
    if (!ctx.conversaId) return semCampanha();
    const [d] = await this.db.query<{ id: string }>(
      `SELECT d.id FROM campanha_destinatarios d
       JOIN chamadas_saida cs ON cs.id = d.chamada_saida_id
       JOIN conversas cv ON cv.provider_id = cs.provider_conversa_ref
       WHERE cv.id = $1 AND cs.motivo = 'campanha' AND cs.municipio_id = $2`,
      [ctx.conversaId, ctx.municipio.id],
    );
    if (!d) return semCampanha();
    await this.db.query(
      `UPDATE campanha_destinatarios
       SET estado = $2, necessidades = $3, nota = $4, respondido_em = now()
       WHERE id = $1`,
      [d.id, e.estado, e.necessidades, e.nota ?? null],
    );
    return {
      gravado: true,
      dizer:
        e.estado === 'precisa_ajuda'
          ? 'Obrigado. Já passei a informação à ação social da câmara: vão contactá-lo hoje.'
          : 'Ainda bem. Se precisar de alguma coisa, ligue para este número a qualquer hora.',
    };
  }

  // ------------------------------------------------------------------

  /**
   * Traz o resultado das chamadas para os destinatários que ainda estão
   * 'a_ligar' (a resposta do agente, se veio, já mudou o estado) e fecha as
   * campanhas sem nada por ligar.
   */
  async sincronizar(municipioId: string): Promise<void> {
    await this.db.query(
      `UPDATE campanha_destinatarios d
       SET estado = CASE cs.estado
             WHEN 'atendida' THEN 'atendeu'
             WHEN 'nao_atendida' THEN 'nao_atendeu'
             WHEN 'falhou' THEN 'sem_ligacao'
             ELSE CASE WHEN mu.aceita_chamadas THEN 'cancelado' ELSE 'recusou' END
           END
       FROM chamadas_saida cs, municipes mu, campanhas c
       WHERE d.chamada_saida_id = cs.id AND mu.id = d.municipe_id AND c.id = d.campanha_id
         AND c.municipio_id = $1 AND d.estado = 'a_ligar'
         AND cs.estado IN ('atendida','nao_atendida','falhou','cancelada')`,
      [municipioId],
    );
    await this.db.query(
      `UPDATE campanhas c SET estado = 'terminada', terminada_em = now()
       WHERE c.municipio_id = $1 AND c.estado = 'a_ligar'
         AND NOT EXISTS (SELECT 1 FROM campanha_destinatarios d
                         WHERE d.campanha_id = c.id AND d.estado IN ('por_ligar','a_ligar'))`,
      [municipioId],
    );
  }

  private async alvo(
    q: Pick<Tx, 'query'>,
    municipioId: string,
    filtro: string[] | undefined,
  ) {
    const linhas = await q.query<{
      contacto_id: string;
      municipe_id: string;
      telefone: string | null;
      aceita_chamadas: boolean;
    }>(
      `SELECT c.id AS contacto_id, c.municipe_id, mu.telefone_e164 AS telefone, mu.aceita_chamadas
       FROM contactos_cuidado c JOIN municipes mu ON mu.id = c.municipe_id
       WHERE c.municipio_id = $1 AND c.ativo AND mu.anonimizado_em IS NULL
         AND ($2::text[] IS NULL OR c.freguesia = ANY($2))
       ORDER BY c.nome`,
      [municipioId, filtro?.length ? filtro : null],
    );
    return linhas.map((l) => ({
      ...l,
      ligavel: telefoneLigavel(l.telefone) && l.aceita_chamadas,
    }));
  }
}

/** Primeiro quem precisa de ajuda, depois quem não atendeu, no fim quem está bem. */
const ORDEM_ESTADO = `CASE d.estado
  WHEN 'precisa_ajuda' THEN 0 WHEN 'nao_atendeu' THEN 1 WHEN 'atendeu' THEN 2
  WHEN 'sem_ligacao' THEN 3 WHEN 'a_ligar' THEN 4 WHEN 'por_ligar' THEN 5
  WHEN 'bem' THEN 6 ELSE 7 END`;

function completar(
  c: Record<string, number>,
): Record<EstadoDestinatario, number> {
  return Object.fromEntries(
    ESTADOS_DESTINATARIO.map((e) => [e, c[e] ?? 0]),
  ) as Record<EstadoDestinatario, number>;
}

function contarFreguesias(l: { freguesia: string | null }[]) {
  const m = new Map<string, number>();
  for (const x of l)
    if (x.freguesia) m.set(x.freguesia, (m.get(x.freguesia) ?? 0) + 1);
  return [...m.entries()]
    .map(([nome, pessoas]) => ({ nome, pessoas }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

function semCampanha() {
  return {
    gravado: false,
    instrucao:
      'Esta conversa não é uma chamada de campanha. Segue o atendimento normal.',
  };
}

/** Agora, se forem 9h–21h no município; senão as 9h seguintes. */
export function proximaHoraCampanha(agora: Date, fuso: string): Date {
  const l = local(agora, fuso);
  if (l.hora >= HORA_INICIO && l.hora < HORA_FIM) return agora;
  // Antes das 9h: hoje às 9h; depois das 21h: amanhã às 9h.
  const base = new Date(agora);
  if (l.hora >= HORA_FIM) base.setUTCDate(base.getUTCDate() + 1);
  const dia = local(base, fuso).dia;
  return instanteLocal(dia, HORA_INICIO, fuso);
}
