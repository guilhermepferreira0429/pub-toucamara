import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { normalizarTelefone } from '../municipes/municipes.service.js';
import { linhasObjetos, objetosDaConversa } from './objetos-conversa.js';
import {
  JANELA_RETOMAR_DIAS,
  Pendente,
  PedidoInicioChamada,
  quandoFalado,
  resumoCurto,
  UltimaConversa,
  VARIAVEIS_VAZIAS,
  VariaveisInicio,
  variaveisInicio,
} from './retomar.js';

export interface RespostaInicioChamada {
  type: 'conversation_initiation_client_data';
  dynamic_variables: VariaveisInicio;
  /** Voz e ritmo do painel (só com ELEVENLABS_SOBREPOR_VOZ=true). */
  conversation_config_override?: { tts: { voice_id?: string; speed: number } };
}

/** Ritmo do painel → velocidade do TTS do ElevenLabs (0,7 a 1,2). */
export const VELOCIDADE_RITMO = { calmo: 0.9, normal: 1, rapido: 1.1 } as const;
export type Ritmo = keyof typeof VELOCIDADE_RITMO;

/** A conversa anterior, para o contexto da primeira mensagem do chat. */
export interface AnteriorParaContexto {
  iniciada_em: Date;
  resumo: string;
  proximos_passos: string[];
}

// A última conversa do munícipe antes de `c` (ou de agora). Se for uma
// emergência ou tiver mais de 30 dias, não serve: não se procura outra.
const SQL_ULTIMA_DO_MUNICIPE = `
  SELECT a.id, a.iniciada_em, a.resultado::text AS resultado, a.resumo, a.resumo_sms
  FROM conversas a
  WHERE a.municipio_id = $1 AND a.municipe_id = $2
    AND a.id IS DISTINCT FROM $3::uuid
    AND a.provider_id IS DISTINCT FROM $4::text
    AND a.iniciada_em <= coalesce($5::timestamptz, now())
  ORDER BY a.iniciada_em DESC
  LIMIT 1`;

/**
 * Retomar a conversa: contexto no início da chamada (variáveis dinâmicas do
 * ElevenLabs), ligação `continuacao_de` entre a conversa nova e a anterior,
 * a ferramenta `conversa_anterior` e o resumo da anterior no chat.
 */
@Injectable()
export class RetomarService {
  private readonly logger = new Logger(RetomarService.name);

  constructor(private readonly db: DatabaseService) {}

  // ------------------------------------------------------------------
  // Início da chamada
  // ------------------------------------------------------------------

  /**
   * As variáveis dinâmicas para o ElevenLabs. Nunca falha: sem município,
   * sem número ou com a BD lenta, a chamada começa sem contexto.
   */
  async inicioChamada(
    p: PedidoInicioChamada,
    agora = new Date(),
    sobreporVoz = false,
  ): Promise<RespostaInicioChamada> {
    let voz: RespostaInicioChamada['conversation_config_override'];
    const resposta = (v: VariaveisInicio): RespostaInicioChamada => ({
      type: 'conversation_initiation_client_data',
      dynamic_variables: v,
      ...(voz ? { conversation_config_override: voz } : {}),
    });
    try {
      const municipio = await this.municipioDaChamada(
        p.agent_id ?? null,
        normalizarTelefone(p.called_number),
      );
      if (!municipio) {
        this.logger.warn(
          `Início de chamada sem município (agent_id ${p.agent_id ?? '—'}): sem contexto.`,
        );
        return resposta(VARIAVEIS_VAZIAS);
      }
      // O override tem de estar autorizado no agente do ElevenLabs (Security
      // › Overrides), senão a chamada é recusada: por isso só com a flag.
      if (sobreporVoz) {
        voz = {
          tts: {
            ...(municipio.voz_id ? { voice_id: municipio.voz_id } : {}),
            speed: VELOCIDADE_RITMO[municipio.ritmo] ?? 1,
          },
        };
      }
      const telefone = normalizarTelefone(p.caller_id);
      // Só leitura: o munícipe novo é criado pela primeira ferramenta.
      const [municipe] = telefone
        ? await this.db.query<{ id: string; nome: string | null }>(
            `SELECT id, nome FROM municipes
             WHERE municipio_id = $1 AND telefone_e164 = $2 AND anonimizado_em IS NULL`,
            [municipio.id, telefone],
          )
        : [];
      if (!municipe) return resposta(VARIAVEIS_VAZIAS);

      const [[ultima], pendentes] = await Promise.all([
        this.db.query<UltimaConversa>(SQL_ULTIMA_DO_MUNICIPE, [
          municipio.id,
          municipe.id,
          null,
          p.conversation_id ?? null,
          null,
        ]),
        this.pendentes(municipio.id, municipe.id),
      ]);
      return resposta(
        variaveisInicio({
          nome: municipe.nome,
          ultima: ultima ?? null,
          pendentes,
          agora,
          fuso: municipio.fuso,
        }),
      );
    } catch (e) {
      this.logger.error(
        `Contexto do início da chamada por calcular: ${(e as Error).message}`,
      );
      return resposta(VARIAVEIS_VAZIAS);
    }
  }

  /**
   * Pelo agente (o de entrada ou o de saída do agente_config: são do mesmo
   * município) ou pelo número da linha.
   */
  private async municipioDaChamada(
    agentId: string | null,
    numero: string | null,
  ): Promise<{
    id: string;
    fuso: string;
    voz_id: string | null;
    ritmo: Ritmo;
  } | null> {
    if (!agentId && !numero) return null;
    const [m] = await this.db.query<{
      id: string;
      fuso: string;
      voz_id: string | null;
      ritmo: Ritmo;
    }>(
      `SELECT x.id, x.fuso, a.voz_id, coalesce(a.ritmo, 'normal') AS ritmo FROM (
         SELECT m.id, m.fuso, 1 AS ordem FROM agente_config a
         JOIN municipios m ON m.id = a.municipio_id
         WHERE $1 IN (a.elevenlabs_agent_id, a.elevenlabs_agent_id_saida)
         UNION ALL
         SELECT id, fuso, 2 FROM municipios
         WHERE regexp_replace(telefone_linha, '[^0-9+]', '', 'g') = $2
       ) x LEFT JOIN agente_config a ON a.municipio_id = x.id
       ORDER BY x.ordem LIMIT 1`,
      [agentId, numero],
    );
    return m ?? null;
  }

  /** O que o munícipe tem pendente: marcações próximas, requerimentos, documentos, ocorrências. */
  async pendentes(
    municipioId: string,
    municipeId: string,
  ): Promise<Pendente[]> {
    const [marcacoes, requerimentos, documentos, ocorrencias] =
      await Promise.all([
        this.db.query<{ inicio: Date; agenda: string }>(
          `SELECT lower(m.periodo) AS inicio, a.nome AS agenda
           FROM marcacoes m JOIN agendas a ON a.id = m.agenda_id
           WHERE m.municipe_id = $1 AND a.municipio_id = $2 AND m.estado = 'marcada'
             AND lower(m.periodo) BETWEEN now() AND now() + interval '7 days'
           ORDER BY lower(m.periodo) LIMIT 1`,
          [municipeId, municipioId],
        ),
        this.db.query<{ estado: 'pronto' | 'a_preencher'; nome: string }>(
          `SELECT r.estado::text AS estado, lower(tp.nome) AS nome
           FROM requerimentos r JOIN tipos_processo tp ON tp.id = r.tipo_processo_id
           WHERE r.municipe_id = $1 AND r.municipio_id = $2
             AND r.estado IN ('pronto', 'a_preencher')
             AND r.atualizado_em > now() - make_interval(days => $3)
           ORDER BY (r.estado = 'pronto') DESC, r.atualizado_em DESC LIMIT 2`,
          [municipeId, municipioId, JANELA_RETOMAR_DIAS],
        ),
        // Obrigatórios do tipo sem documento recebido válido (ou por verificar).
        this.db.query<{ processo: string; documentos: string[] }>(
          `SELECT p.numero AS processo,
                  coalesce(array_agg(td.nome ORDER BY td.ordem)
                    FILTER (WHERE td.id IS NOT NULL), '{}') AS documentos
           FROM processos p
           LEFT JOIN tipo_processo_documentos td
             ON td.tipo_processo_id = p.tipo_processo_id AND td.obrigatorio
            AND NOT td.gerado_pelo_sistema
            AND NOT EXISTS (
              SELECT 1 FROM documentos d
              WHERE d.processo_id = p.id AND d.tipo_documento_id = td.id
                AND d.verificacao_estado IN ('valido', 'por_verificar'))
           WHERE p.municipe_id = $1 AND p.municipio_id = $2 AND p.fase = 'documentos'
           GROUP BY p.id, p.numero, p.atualizado_em
           ORDER BY p.atualizado_em DESC LIMIT 1`,
          [municipeId, municipioId],
        ),
        this.db.query<{ numero: string; categoria: string }>(
          `SELECT o.numero, lower(co.nome) AS categoria
           FROM ocorrencias o JOIN categorias_ocorrencia co ON co.id = o.categoria_id
           WHERE o.municipe_id = $1 AND o.municipio_id = $2
             AND o.estado IN ('nova', 'com_equipa')
           ORDER BY o.criada_em DESC LIMIT 1`,
          [municipeId, municipioId],
        ),
      ]);
    return [
      ...marcacoes.map((m) => ({ tipo: 'marcacao' as const, ...m })),
      ...requerimentos.map((r) => ({ tipo: 'requerimento' as const, ...r })),
      ...documentos.map((d) => ({ tipo: 'documentos' as const, ...d })),
      ...ocorrencias.map((o) => ({ tipo: 'ocorrencia' as const, ...o })),
    ];
  }

  // ------------------------------------------------------------------
  // continuacao_de
  // ------------------------------------------------------------------

  /**
   * Liga a conversa à anterior, se ainda não estiver ligada e a anterior for
   * do mesmo município e de antes. Idempotente (o fim da chamada repete-se).
   */
  async ligarContinuacao(
    conversaId: string,
    anteriorId: string | null,
    tx?: Tx,
  ): Promise<boolean> {
    if (!anteriorId || anteriorId === conversaId) return false;
    const r = await (tx ?? this.db).query(
      `UPDATE conversas c SET continuacao_de = a.id
       FROM conversas a
       WHERE c.id = $1 AND a.id = $2 AND c.continuacao_de IS NULL
         AND a.municipio_id = c.municipio_id AND a.iniciada_em <= c.iniciada_em
       RETURNING c.id`,
      [conversaId, anteriorId],
    );
    return r.length > 0;
  }

  /**
   * Liga a conversa à última do seu munícipe (chat identificado por SMS),
   * com as mesmas regras do início da chamada: 30 dias, sem emergências.
   */
  async ligarUltimaDoMunicipe(conversaId: string, tx?: Tx): Promise<boolean> {
    const q = tx ?? this.db;
    const [c] = await q.query<{
      municipio_id: string;
      municipe_id: string | null;
      iniciada_em: Date;
      continuacao_de: string | null;
    }>(
      `SELECT municipio_id, municipe_id, iniciada_em, continuacao_de
       FROM conversas WHERE id = $1`,
      [conversaId],
    );
    if (!c?.municipe_id || c.continuacao_de) return false;
    const [a] = await q.query<UltimaConversa>(SQL_ULTIMA_DO_MUNICIPE, [
      c.municipio_id,
      c.municipe_id,
      conversaId,
      null,
      c.iniciada_em,
    ]);
    if (
      !a ||
      a.resultado === 'emergencia' ||
      c.iniciada_em.getTime() - a.iniciada_em.getTime() >
        JANELA_RETOMAR_DIAS * 86_400_000
    ) {
      return false;
    }
    return this.ligarContinuacao(conversaId, a.id, tx);
  }

  /**
   * Chat criado com `sessao_anterior` (o token que o browser guardou): a
   * nova sessão continua a anterior, se for deste município, dos últimos
   * 30 dias e não for uma emergência. O munícipe não passa: identificar-se
   * continua a pedir o código por SMS.
   */
  async continuarChat(
    conversaId: string,
    municipioId: string,
    tokenAnterior: string,
  ): Promise<boolean> {
    const [a] = await this.db.query<{ id: string }>(
      `SELECT id FROM conversas
       WHERE provider_id = $1 AND canal = 'chat' AND municipio_id = $2
         AND resultado <> 'emergencia'
         AND iniciada_em > now() - make_interval(days => $3)`,
      [tokenAnterior, municipioId, JANELA_RETOMAR_DIAS],
    );
    return a ? this.ligarContinuacao(conversaId, a.id) : false;
  }

  /** A conversa de que esta é continuação, resumida para o contexto do chat. */
  async anteriorParaContexto(
    conversaId: string,
  ): Promise<AnteriorParaContexto | null> {
    const [a] = await this.db.query<{
      iniciada_em: Date;
      resumo: string | null;
      resumo_sms: string | null;
      proximos_passos: string[];
    }>(
      `SELECT a.iniciada_em, a.resumo, a.resumo_sms, a.proximos_passos
       FROM conversas c JOIN conversas a ON a.id = c.continuacao_de
       WHERE c.id = $1`,
      [conversaId],
    );
    if (!a) return null;
    return {
      iniciada_em: a.iniciada_em,
      resumo: resumoCurto(a.resumo_sms, a.resumo),
      proximos_passos: Array.isArray(a.proximos_passos)
        ? a.proximos_passos
        : [],
    };
  }

  // ------------------------------------------------------------------
  // Ferramenta conversa_anterior
  // ------------------------------------------------------------------

  /**
   * As últimas conversas do munícipe do contexto (ou, sem munícipe, aquela
   * de que esta é continuação). Liga a conversa atual à mais recente.
   */
  async paraFerramenta(ctx: ContextoFerramenta, quantas: number) {
    if (!ctx.municipeId && !ctx.conversaId)
      return precisaIdentificacao(ctx.canal);
    const linhas = await this.db.query<{
      id: string;
      canal: string;
      iniciada_em: Date;
      resultado: string;
      tema: string | null;
      resumo: string | null;
      resumo_sms: string | null;
      proximos_passos: string[];
    }>(
      `SELECT c.id, c.canal::text AS canal, c.iniciada_em, c.resultado::text AS resultado,
              t.nome AS tema, c.resumo, c.resumo_sms, c.proximos_passos
       FROM conversas c LEFT JOIN temas t ON t.id = c.tema_id
       WHERE c.municipio_id = $1
         AND c.id IS DISTINCT FROM $2::uuid
         AND c.iniciada_em > now() - make_interval(days => $5)
         AND (($3::uuid IS NOT NULL AND c.municipe_id = $3)
              OR c.id = (SELECT continuacao_de FROM conversas WHERE id = $2::uuid))
         AND c.iniciada_em <= coalesce(
              (SELECT iniciada_em FROM conversas WHERE id = $2::uuid), now())
       ORDER BY c.iniciada_em DESC
       LIMIT $4`,
      [
        ctx.municipio.id,
        ctx.conversaId,
        ctx.municipeId,
        quantas,
        JANELA_RETOMAR_DIAS,
      ],
    );
    if (linhas.length === 0) {
      if (!ctx.municipeId) return precisaIdentificacao(ctx.canal);
      return {
        encontradas: 0,
        instrucao: `Não há conversas desta pessoa nos últimos ${JANELA_RETOMAR_DIAS} dias. Peça-lhe que explique o assunto.`,
      };
    }
    if (ctx.conversaId) {
      await this.ligarContinuacao(ctx.conversaId, linhas[0].id);
    }
    const agora = new Date();
    const conversas = await Promise.all(
      linhas.map(async (l) => ({
        quando: quandoFalado(l.iniciada_em, agora, ctx.municipio.fuso),
        canal: l.canal,
        tema: l.tema,
        resultado: l.resultado,
        resumo:
          resumoCurto(l.resumo_sms, l.resumo, 600) ||
          'Ainda sem resumo (a conversa terminou há pouco).',
        proximos_passos: Array.isArray(l.proximos_passos)
          ? l.proximos_passos
          : [],
        registado: linhasObjetos(await objetosDaConversa(this.db, l.id)),
      })),
    );
    return {
      encontradas: conversas.length,
      conversas,
      instrucao:
        'Use isto para continuar o assunto sem pedir à pessoa que repita. Confirme com ela antes de agir; o estado atual de um processo vê-se com estado_processo.',
    };
  }
}

function precisaIdentificacao(canal: ContextoFerramenta['canal']) {
  return {
    precisa_identificacao: true,
    instrucao:
      canal === 'chat'
        ? 'Para ver conversas anteriores a pessoa tem de se identificar no chat com o número de telemóvel (recebe um código por SMS); depois volte a chamar esta ferramenta.'
        : 'Para ver conversas anteriores é preciso identificar a pessoa: peça o NIF e use identificar_municipe; depois volte a chamar esta ferramenta.',
  };
}
