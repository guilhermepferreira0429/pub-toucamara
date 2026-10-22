import { randomUUID } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao, pagina } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { webhooksConfig } from '../../config/configuration.js';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { destinoSimulado } from '../comunicacao/destino-simulado.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import {
  MensagensService,
  MotivoMensagem,
} from '../comunicacao/mensagens.service.js';
import type { WebhookTranscricao } from '../conversas/elevenlabs.js';
import { RetomarService } from '../conversas/retomar.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { diaPorExtenso, emFaltaFalado } from '../processos/avisos.js';
import { Fase, FASE_EM_PALAVRAS } from '../processos/regras.js';
import {
  Buscar,
  chamadaDaTranscricao,
  FalhaInicio,
  municipeFalou,
  pedirChamada,
  razaoFalada,
  refDaFalha,
} from './elevenlabs-saida.js';
import {
  aposNaoAtendida,
  ConfigChamadas,
  ContextoChamada,
  decidirChamada,
  dentroDaJanela,
  ESTADOS_CHAMADA,
  esquemaConfigChamadas,
  lerConfig,
  local,
  MOTIVO_FALADO,
  MotivoChamada,
  MotivoSemChamada,
  MOTIVOS_CHAMADA,
  proximaJanela,
  SEM_RESULTADO_MS,
  TEXTO_SEM_CHAMADA,
  variaveisSaida,
} from './regras.js';

type Q = Pick<Tx, 'query'>;

/** O SMS que vai se a chamada não for atendida (o que iria sem chamada). */
export interface RecursoSms {
  corpo: string;
  chave: string;
  motivo: MotivoMensagem;
  relacionado: Record<string, string>;
}

export interface NovaChamada {
  municipioId: string;
  municipeId: string;
  motivo: MotivoChamada;
  processoId?: string | null;
  pedidoId?: string | null;
  /** O que mudou, dito pelo agente (por omissão, pelo motivo). */
  oQueMudou?: string | null;
  nota?: string | null;
  recurso: RecursoSms | null;
  /** Idempotência: a chave do aviso (a mesma do SMS). */
  chave?: string | null;
  manual?: { utilizadorId: string; forcarHorario: boolean };
  /** Para quem precisa do id antes de gravar (a chave do SMS manual). */
  id?: string;
}

export type ResultadoAgendar =
  | { agendada: true; id: string; agendada_para: Date }
  | { agendada: false; motivo: MotivoSemChamada };

interface Chamada {
  id: string;
  municipio_id: string;
  municipe_id: string;
  telefone_e164: string;
  motivo: MotivoChamada;
  processo_id: string | null;
  pedido_id: string | null;
  contexto: Partial<ContextoChamada>;
  recurso: RecursoSms | null;
  estado: (typeof ESTADOS_CHAMADA)[number];
  tentativas: number;
  forcar_horario: boolean;
  recurso_sms_id: string | null;
  /** Número simulado (demonstração): a chamada nunca sai. */
  simulado: boolean;
}

const COLUNAS = `c.id, c.municipio_id, c.municipe_id, c.telefone_e164, c.motivo, c.processo_id,
  c.pedido_id, c.contexto, c.recurso, c.estado, c.tentativas, c.forcar_horario, c.recurso_sms_id,
  c.simulado`;

/** O que fica numa chamada a um número simulado (nunca feita). */
export const ERRO_SIMULADA =
  'Número simulado ou de demonstração: a chamada fica registada mas nunca sai para o fornecedor.';

/** Por corrida do job; o resto fica para o minuto seguinte. */
const LOTE = 20;

const EQUIPA_INTERNA: readonly UtilizadorPainel['perfil'][] = [
  'admin',
  'equipa_toucamara',
];

export const esquemaListaChamadas = esquemaPaginacao.extend({
  estado: z.enum(ESTADOS_CHAMADA).optional(),
  motivo: z.enum(MOTIVOS_CHAMADA).optional(),
});

export const esquemaLigar = z.object({
  motivo: z.enum(MOTIVOS_CHAMADA).optional(),
  nota: z.string().trim().min(1).max(500).optional(),
  forcar_horario: z.boolean().optional(),
});

export const esquemaCancelar = z.object({
  /** O SMS de recurso vai na mesma (o aviso tem de chegar por escrito). */
  enviar_sms: z.boolean().default(true),
});

/**
 * Chamadas de saída: o agente de voz liga ao munícipe quando o processo
 * avança, quando falta um documento ou quando o prazo está a acabar; se
 * ninguém atender, vai o SMS que iria de qualquer forma. Ver `regras.ts`
 * (quando se liga) e `elevenlabs-saida.ts` (a API e os webhooks).
 */
@Injectable()
export class ChamadasSaidaService {
  private readonly logger = new Logger(ChamadasSaidaService.name);
  /** Trocável nos testes: nunca se chama o ElevenLabs a sério. */
  buscar: Buscar = (url, init) => fetch(url, init);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly municipios: MunicipiosService,
    private readonly mensagens: MensagensService,
    private readonly links: LinksCurtosService,
    private readonly retomar: RetomarService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private get apiKey(): string {
    return (
      this.config.get<ConfigType<typeof webhooksConfig>>('webhooks')
        ?.elevenlabsApiKey ?? ''
    );
  }

  // ------------------------------------------------------------------
  // Agendar
  // ------------------------------------------------------------------

  /**
   * Agenda uma chamada em vez do aviso escrito, se as regras deixarem
   * (`decidirChamada`). Corre dentro da transação de quem avisa; o munícipe
   * fica bloqueado até ao fim, para dois avisos ao mesmo tempo não marcarem
   * duas chamadas. Não agendada → quem chama envia o SMS/email como sempre.
   */
  async agendar(
    tx: Tx,
    n: NovaChamada,
    agora = new Date(),
  ): Promise<ResultadoAgendar> {
    const [m] = await tx.query<{
      telefone: string | null;
      aceita_chamadas: boolean;
      preferido: string | null;
    }>(
      `SELECT telefone_e164 AS telefone, aceita_chamadas, canal_preferido AS preferido
       FROM municipes WHERE id = $1 AND municipio_id = $2 AND anonimizado_em IS NULL
       FOR UPDATE`,
      [n.municipeId, n.municipioId],
    );
    if (!m) return { agendada: false, motivo: 'sem_telefone' };
    const config = await this.configDe(tx, n.municipioId);
    const municipio = await this.municipios.porId(n.municipioId);
    const [feriados, outras] = await Promise.all([
      this.municipios.feriados(n.municipioId),
      tx.query<{ estado: string; dia: string }>(
        `SELECT estado,
                to_char((coalesce(iniciada_em, agendada_para) AT TIME ZONE $2)::date, 'YYYY-MM-DD') AS dia
         FROM chamadas_saida
         WHERE municipe_id = $1 AND estado <> 'cancelada'
           AND coalesce(iniciada_em, agendada_para) > now() - interval '3 days'`,
        [n.municipeId, municipio.fuso],
      ),
    ]);
    const d = decidirChamada({
      config,
      motivo: n.motivo,
      municipe: m,
      manual: !!n.manual,
      forcarHorario: n.manual?.forcarHorario,
      temPendente: outras.some((o) =>
        ['agendada', 'a_ligar'].includes(o.estado),
      ),
      // 'falhou' não chegou a tocar.
      diasLigados: new Set(
        outras
          .filter((o) => ['atendida', 'nao_atendida'].includes(o.estado))
          .map((o) => o.dia),
      ),
      agora,
      fuso: municipio.fuso,
      feriados,
    });
    if (!d.liga) return { agendada: false, motivo: d.motivo };

    const contexto = await this.contexto(tx, municipio, n, agora);
    const [nova] = await tx.query<{ id: string; agendada_para: Date }>(
      `INSERT INTO chamadas_saida (id, municipio_id, municipe_id, telefone_e164, motivo,
         processo_id, pedido_id, contexto, recurso, agendada_para, forcar_horario, chave, criada_por)
       VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (chave) DO NOTHING
       RETURNING id, agendada_para`,
      [
        n.id ?? null,
        n.municipioId,
        n.municipeId,
        m.telefone,
        n.motivo,
        n.processoId ?? null,
        n.pedidoId ?? null,
        JSON.stringify(contexto),
        n.recurso ? JSON.stringify(n.recurso) : null,
        d.agendarPara,
        n.manual?.forcarHorario ?? false,
        n.chave ?? null,
        n.manual?.utilizadorId ?? null,
      ],
    );
    if (nova) return { agendada: true, ...nova };
    // A mesma chave já agendou (o aviso repetiu-se): é essa.
    const [existente] = await tx.query<{ id: string; agendada_para: Date }>(
      'SELECT id, agendada_para FROM chamadas_saida WHERE chave = $1',
      [n.chave],
    );
    return { agendada: true, ...existente };
  }

  private async configDe(q: Q, municipioId: string): Promise<ConfigChamadas> {
    const [a] = await q.query<{ chamadas_saida: unknown }>(
      'SELECT chamadas_saida FROM agente_config WHERE municipio_id = $1',
      [municipioId],
    );
    return lerConfig(a?.chamadas_saida);
  }

  /** O que o agente vai dizer, tirado do processo no momento do aviso. */
  private async contexto(
    tx: Tx,
    municipio: Municipio,
    n: NovaChamada,
    agora: Date,
  ): Promise<ContextoChamada> {
    const c: ContextoChamada = {
      numero_processo: '',
      o_que_mudou: n.oQueMudou ?? '',
      o_que_falta: '',
      prazo: '',
      link: '',
      nota: n.nota ?? '',
    };
    if (!n.processoId) return c;
    const hoje = local(agora, municipio.fuso).dia;
    const [[p], pedidos] = await Promise.all([
      tx.query<{ numero: string; fase: Fase }>(
        'SELECT numero, fase FROM processos WHERE id = $1 AND municipio_id = $2',
        [n.processoId, municipio.id],
      ),
      tx.query<{ id: string; descricao: string; prazo: string }>(
        `SELECT id, descricao, to_char(prazo, 'YYYY-MM-DD') AS prazo
         FROM processo_pedidos_estado
         WHERE processo_id = $1 AND respondido_em IS NULL
         ORDER BY prazo, pedido_em`,
        [n.processoId],
      ),
    ]);
    if (!p) return c;
    c.numero_processo = p.numero;
    c.link = await this.link(tx, municipio.id, n.processoId);
    c.o_que_falta = emFaltaFalado(
      pedidos.map((x) => ({ nome: x.descricao, prazo: x.prazo })),
      hoje,
    );
    const pedido = pedidos.find((x) => x.id === n.pedidoId);
    if (pedido) c.prazo = diaPorExtenso(pedido.prazo);
    if (!c.o_que_mudou) {
      if (n.motivo === 'processo_fase') {
        c.o_que_mudou = `O processo ${FASE_EM_PALAVRAS[p.fase]}.`;
      } else if (n.motivo === 'pedido_documento' && pedido) {
        c.o_que_mudou = `A câmara pediu-lhe: ${pedido.descricao}, até dia ${c.prazo}.`;
      } else if (n.motivo === 'lembrete_prazo' && pedido) {
        c.o_que_mudou = `O prazo para entregar ${pedido.descricao} termina a ${c.prazo}.`;
      }
    }
    return c;
  }

  /** O link do processo (reaproveita um que ainda dure uma semana). */
  private async link(
    tx: Tx,
    municipioId: string,
    processoId: string,
  ): Promise<string> {
    const [l] = await tx.query<{ codigo: string }>(
      `SELECT codigo FROM links_curtos
       WHERE destino_tipo = 'processo' AND destino_id = $1 AND expira_em > now() + interval '7 days'
       ORDER BY expira_em DESC LIMIT 1`,
      [processoId],
    );
    if (l)
      return `${this.config.get<string>('app.webUrl') ?? ''}/r/${l.codigo}`;
    return (await this.links.criar(municipioId, 'processo', processoId, { tx }))
      .url;
  }

  // ------------------------------------------------------------------
  // Job: ligar as que estão na hora
  // ------------------------------------------------------------------

  /** O trabalho do job `chamadas_saida` (a cada minuto). */
  async processar(): Promise<number> {
    await this.expirarSemResultado();
    const linhas = await this.db.query<{ id: string }>(
      `SELECT id FROM chamadas_saida
       WHERE estado = 'agendada' AND agendada_para <= now()
       ORDER BY agendada_para LIMIT ${LOTE}`,
    );
    let ligadas = 0;
    for (const { id } of linhas) {
      try {
        if (await this.despachar(id)) ligadas++;
      } catch (e) {
        this.logger.error(`Chamada ${id}: ${(e as Error).message}`);
      }
    }
    if (ligadas) this.logger.log(`Chamadas de saída pedidas: ${ligadas}.`);
    return ligadas;
  }

  /**
   * Liga, se ainda for caso disso: fora de horas reagenda; quem entretanto
   * recusou chamadas ou já respondeu ao pedido não é ligado; sem ElevenLabs
   * configurado fica 'falhou' e vai o SMS (nunca se finge uma chamada).
   * Devolve true se a chamada foi pedida ao ElevenLabs com sucesso.
   */
  async despachar(id: string, agora = new Date()): Promise<boolean> {
    const pronta = await this.db.transaction(async (tx) => {
      const [c] = await tx.query<
        Chamada & {
          aceita_chamadas: boolean;
          respondido: boolean | null;
          agent_id: string | null;
          config: unknown;
        }
      >(
        `SELECT ${COLUNAS}, m.aceita_chamadas,
                (SELECT pe.respondido_em IS NOT NULL FROM processo_pedidos_estado pe
                 WHERE pe.id = c.pedido_id) AS respondido,
                -- O agente das chamadas da câmara; sem ele, o de entrada.
                coalesce(a.elevenlabs_agent_id_saida, a.elevenlabs_agent_id) AS agent_id,
                a.chamadas_saida AS config
         FROM chamadas_saida c
         JOIN municipes m ON m.id = c.municipe_id
         LEFT JOIN agente_config a ON a.municipio_id = c.municipio_id
         WHERE c.id = $1 AND c.estado = 'agendada'
         FOR UPDATE OF c SKIP LOCKED`,
        [id],
      );
      if (!c) return null;
      // BARREIRA (destinoSimulado, o mesmo ponto dos SMS): um número
      // simulado ou da gama de demonstração nunca é ligado (nem recebe o SMS
      // de recurso), com qualquer configuração e em qualquer ambiente.
      if (destinoSimulado({ destino: c.telefone_e164, simulado: c.simulado })) {
        await this.terminar(tx, c, 'cancelada', ERRO_SIMULADA);
        return null;
      }
      const municipio = await this.municipios.porId(c.municipio_id);
      const feriados = await this.municipios.feriados(c.municipio_id);
      if (
        !c.forcar_horario &&
        !dentroDaJanela(agora, municipio.fuso, feriados)
      ) {
        await tx.query(
          'UPDATE chamadas_saida SET agendada_para = $2 WHERE id = $1',
          [c.id, proximaJanela(agora, municipio.fuso, feriados)],
        );
        return null;
      }
      if (!c.aceita_chamadas) {
        await this.terminar(
          tx,
          c,
          'cancelada',
          'O munícipe pediu para não ser ligado.',
        );
        await this.recurso(tx, c);
        return null;
      }
      if (
        c.respondido &&
        (c.motivo === 'pedido_documento' ||
          c.motivo === 'lembrete_prazo' ||
          c.motivo === 'antecipacao')
      ) {
        await this.terminar(tx, c, 'cancelada', 'O pedido já foi respondido.');
        // O pedido tem de ficar por escrito; o lembrete já não faz falta.
        if (c.motivo === 'pedido_documento') await this.recurso(tx, c);
        return null;
      }
      const config = lerConfig(c.config);
      const falta = !this.apiKey
        ? 'ELEVENLABS_API_KEY'
        : !c.agent_id
          ? 'agente_config.elevenlabs_agent_id_saida ou elevenlabs_agent_id'
          : !config.numero_id
            ? 'número de saída (chamadas_saida.numero_id)'
            : null;
      if (falta) {
        this.logger.warn(
          `Chamada ${c.id} não feita: sem ElevenLabs (${falta}). Vai o SMS de recurso.`,
        );
        await this.terminar(tx, c, 'falhou', `sem ElevenLabs (${falta})`);
        await this.recurso(tx, c);
        await this.eventoProcesso(
          tx,
          c,
          'Chamada do agente não feita (ElevenLabs por configurar): aviso enviado por SMS.',
          true,
        );
        return null;
      }
      await tx.query(
        `UPDATE chamadas_saida SET estado = 'a_ligar', tentativas = tentativas + 1,
           iniciada_em = now(), erro = NULL
         WHERE id = $1`,
        [c.id],
      );
      return { c, agentId: c.agent_id!, config };
    });
    if (!pronta) return false;
    const { c, agentId, config } = pronta;
    // Segunda barreira, mesmo à porta do fornecedor.
    if (destinoSimulado({ destino: c.telefone_e164, simulado: c.simulado }))
      throw new Error(ERRO_SIMULADA);

    // As mesmas variáveis do início de uma chamada de entrada (ja_ligou,
    // pendentes…) mais as da saída: o prompt é um só.
    const inicio = await this.retomar.inicioChamada(
      { agent_id: agentId, caller_id: c.telefone_e164 },
      agora,
    );
    const variaveis: Record<string, string> = {
      ...inicio.dynamic_variables,
      ...variaveisSaida(c.id, c.motivo, c.contexto),
    };
    const r = await pedirChamada(this.buscar, {
      apiKey: this.apiKey,
      via: config.via,
      agentId,
      numeroId: config.numero_id!,
      para: c.telefone_e164,
      variaveis,
      utilizador: c.municipe_id,
    });
    return this.db.transaction(async (tx) => {
      if (r.ok) {
        await tx.query(
          `UPDATE chamadas_saida SET provider_ref = $2, provider_conversa_ref = $3
           WHERE id = $1 AND estado = 'a_ligar'`,
          [c.id, r.callRef, r.conversationId],
        );
        return true;
      }
      this.logger.warn(`Chamada ${c.id} falhou: ${r.erro}`);
      const [ainda] = await tx.query<{ id: string }>(
        `SELECT id FROM chamadas_saida WHERE id = $1 AND estado = 'a_ligar' FOR UPDATE`,
        [c.id],
      );
      if (ainda) {
        await this.terminar(tx, c, 'falhou', r.erro);
        await this.recurso(tx, c);
        await this.eventoProcesso(
          tx,
          c,
          'Chamada do agente falhou: aviso enviado por SMS.',
          true,
        );
      }
      return false;
    });
  }

  /** 'a_ligar' há muito tempo sem nenhum webhook: falhou, vai o SMS. */
  private async expirarSemResultado(): Promise<void> {
    const presas = await this.db.query<{ id: string }>(
      `SELECT id FROM chamadas_saida
       WHERE estado = 'a_ligar' AND iniciada_em < now() - make_interval(secs => $1)`,
      [SEM_RESULTADO_MS / 1000],
    );
    for (const { id } of presas) {
      await this.db.transaction(async (tx) => {
        const [c] = await tx.query<Chamada>(
          `SELECT ${COLUNAS} FROM chamadas_saida c
           WHERE c.id = $1 AND c.estado = 'a_ligar' FOR UPDATE SKIP LOCKED`,
          [id],
        );
        if (!c) return;
        await this.terminar(tx, c, 'falhou', 'Sem resultado do ElevenLabs.');
        await this.recurso(tx, c);
      });
    }
  }

  // ------------------------------------------------------------------
  // Resultado (webhooks do ElevenLabs)
  // ------------------------------------------------------------------

  /**
   * Depois de gravada a transcrição (`post_call_transcription`): se foi uma
   * chamada nossa, liga a conversa ao munícipe que se chamou e marca
   * 'atendida'. O SMS do que foi dito é o do fim de chamada de sempre
   * (resumo, `sms_fim_chamada`). Sem nada dito pelo munícipe (voicemail)
   * conta como não atendida. Idempotente.
   */
  async aoTerminarConversa(
    d: WebhookTranscricao['data'],
    conversaId: string,
  ): Promise<{ chamada_saida_id: string; estado: string } | null> {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.query<Chamada>(
        `SELECT ${COLUNAS} FROM chamadas_saida c
         WHERE c.id = $1::uuid OR c.provider_conversa_ref = $2
         ORDER BY (c.id = $1::uuid) DESC LIMIT 1
         FOR UPDATE`,
        [chamadaDaTranscricao(d), d.conversation_id],
      );
      if (!c) return null;
      // Numa chamada de saída o "caller_id" pode ser o nosso número.
      await tx.query('UPDATE conversas SET municipe_id = $2 WHERE id = $1', [
        conversaId,
        c.municipe_id,
      ]);
      const falou = municipeFalou(d);
      // Só a tentativa em curso (ou a dada por perdida sem resultado).
      if (!(c.estado === 'a_ligar' || (c.estado === 'falhou' && falou))) {
        return { chamada_saida_id: c.id, estado: c.estado };
      }
      if (!falou) {
        const estado = await this.naoAtendida(
          tx,
          c,
          'sem_resposta',
          conversaId,
        );
        return { chamada_saida_id: c.id, estado };
      }
      await tx.query(
        `UPDATE chamadas_saida SET estado = 'atendida', conversa_id = $2,
           terminada_em = now(), erro = NULL
         WHERE id = $1`,
        [c.id, conversaId],
      );
      await this.eventoProcesso(
        tx,
        c,
        `O agente ligou ao munícipe (${MOTIVO_FALADO[c.motivo]}) e a chamada foi atendida.`,
        false,
        { conversa_id: conversaId },
      );
      return { chamada_saida_id: c.id, estado: 'atendida' };
    });
  }

  /**
   * `call_initiation_failure`: ocupado, não atendeu ou recusou. Volta a
   * tentar 2 h depois (no período) ou, à 2.ª, desiste e vai o SMS.
   */
  async aoFalharInicio(
    d: FalhaInicio,
  ): Promise<{ chamada_saida_id: string | null; estado?: string }> {
    return this.db.transaction(async (tx) => {
      const [c] = await tx.query<Chamada>(
        `SELECT ${COLUNAS} FROM chamadas_saida c
         WHERE c.provider_conversa_ref = $1 OR c.provider_ref = $2
         LIMIT 1 FOR UPDATE`,
        [d.conversation_id ?? null, refDaFalha(d)],
      );
      if (!c) {
        this.logger.log(
          `call_initiation_failure sem chamada nossa (${d.conversation_id ?? '—'}).`,
        );
        return { chamada_saida_id: null };
      }
      if (c.estado !== 'a_ligar')
        return { chamada_saida_id: c.id, estado: c.estado };
      const estado = await this.naoAtendida(
        tx,
        c,
        d.failure_reason ?? 'unknown',
      );
      return { chamada_saida_id: c.id, estado };
    });
  }

  private async naoAtendida(
    tx: Tx,
    c: Chamada,
    razao: string,
    conversaId: string | null = null,
  ): Promise<string> {
    const municipio = await this.municipios.porId(c.municipio_id);
    const feriados = await this.municipios.feriados(c.municipio_id);
    const erro = `Tentativa ${c.tentativas}: ${razaoFalada(razao)}.`;
    const a = aposNaoAtendida(
      c.tentativas,
      new Date(),
      municipio.fuso,
      feriados,
    );
    if (a.repetir) {
      await tx.query(
        `UPDATE chamadas_saida SET estado = 'agendada', agendada_para = $2, erro = $3,
           conversa_id = coalesce($4, conversa_id)
         WHERE id = $1`,
        [c.id, a.em, erro, conversaId],
      );
      return 'agendada';
    }
    await tx.query(
      `UPDATE chamadas_saida SET estado = 'nao_atendida', terminada_em = now(), erro = $2,
         conversa_id = coalesce($3, conversa_id)
       WHERE id = $1`,
      [c.id, erro, conversaId],
    );
    await this.recurso(tx, c);
    await this.eventoProcesso(
      tx,
      c,
      `O agente ligou ${c.tentativas} vezes sem resposta: aviso enviado por SMS.`,
      true,
    );
    return 'nao_atendida';
  }

  private async terminar(
    q: Q,
    c: Pick<Chamada, 'id'>,
    estado: 'falhou' | 'cancelada',
    erro: string,
  ) {
    await q.query(
      `UPDATE chamadas_saida SET estado = $2, terminada_em = now(), erro = $3 WHERE id = $1`,
      [c.id, estado, erro],
    );
  }

  /** O SMS de recurso, uma vez (a chave é a do aviso original). */
  private async recurso(tx: Tx, c: Chamada): Promise<string | null> {
    if (!c.recurso || c.recurso_sms_id) return null;
    const smsId = await this.mensagens.sms(
      {
        municipioId: c.municipio_id,
        municipeId: c.municipe_id,
        destino: c.telefone_e164,
        motivo: c.recurso.motivo,
        corpo: c.recurso.corpo,
        relacionado: { ...c.recurso.relacionado, chamada_saida_id: c.id },
        chave: c.recurso.chave,
        // O SMS de recurso de uma chamada simulada também nunca sai.
        simulado: c.simulado !== false,
      },
      tx,
    );
    await tx.query(
      'UPDATE chamadas_saida SET recurso_sms_id = $2 WHERE id = $1',
      [c.id, smsId],
    );
    c.recurso_sms_id = smsId;
    return smsId;
  }

  private async eventoProcesso(
    q: Q,
    c: Pick<Chamada, 'id' | 'processo_id'>,
    descricao: string,
    interno: boolean,
    dados: Record<string, unknown> = {},
  ) {
    if (!c.processo_id) return;
    await q.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, interno, dados)
       VALUES ($1, 'chamada_saida', $2, 'sistema', $3, $4)`,
      [
        c.processo_id,
        descricao,
        interno,
        JSON.stringify({ chamada_saida_id: c.id, ...dados }),
      ],
    );
  }

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  async listar(m: Municipio, f: z.output<typeof esquemaListaChamadas>) {
    const linhas = await this.db.query<{ id: string; criada_em: Date }>(
      `SELECT c.id, c.motivo, c.estado, c.tentativas, c.agendada_para, c.iniciada_em,
              c.terminada_em, c.telefone_e164, c.municipe_id, mu.nome AS municipe_nome,
              c.processo_id, p.numero AS processo_numero, c.contexto, c.conversa_id,
              c.recurso_sms_id, c.erro, c.forcar_horario, c.criada_por,
              u.nome AS criada_por_nome, c.criada_em
       FROM chamadas_saida c
       JOIN municipes mu ON mu.id = c.municipe_id
       LEFT JOIN processos p ON p.id = c.processo_id
       LEFT JOIN utilizadores u ON u.id = c.criada_por
       WHERE c.municipio_id = $1
         AND ($2::text IS NULL OR c.estado = $2)
         AND ($3::text IS NULL OR c.motivo = $3)
         AND ($4::timestamptz IS NULL OR (c.criada_em, c.id) < ($4, $5::uuid))
       ORDER BY c.criada_em DESC, c.id DESC
       LIMIT $6`,
      [
        m.id,
        f.estado ?? null,
        f.motivo ?? null,
        f.cursor?.em ?? null,
        f.cursor?.id ?? null,
        f.limite + 1,
      ],
    );
    return pagina(linhas, f.limite, (l) => ({ em: l.criada_em, id: l.id }));
  }

  /**
   * "Ligar agora" a partir do processo (o momento da demonstração). Respeita
   * a recusa do munícipe e o horário; `forcar_horario` só para a equipa
   * interna. Se já estiver no período, liga logo.
   */
  async ligarManual(
    municipio: Municipio,
    u: UtilizadorPainel,
    processoId: string,
    b: z.output<typeof esquemaLigar>,
  ) {
    if (b.forcar_horario && !EQUIPA_INTERNA.includes(u.perfil)) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'sem_permissao',
        'Só a equipa interna pode ligar fora de horas.',
      );
    }
    const motivo = b.motivo ?? 'manual';
    const id = randomUUID();
    const r = await this.db.transaction(async (tx) => {
      const [p] = await tx.query<{
        numero: string;
        municipe_id: string | null;
      }>(
        'SELECT numero, municipe_id FROM processos WHERE id = $1 AND municipio_id = $2',
        [processoId, municipio.id],
      );
      if (!p) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Processo não encontrado.',
        );
      }
      if (!p.municipe_id) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'sem_municipe',
          'Este processo não tem munícipe associado.',
        );
      }
      const [pedido] = await tx.query<{ id: string }>(
        `SELECT id FROM processo_pedidos_estado
         WHERE processo_id = $1 AND respondido_em IS NULL ORDER BY prazo LIMIT 1`,
        [processoId],
      );
      const link = await this.link(tx, municipio.id, processoId);
      const r = await this.agendar(tx, {
        id,
        municipioId: municipio.id,
        municipeId: p.municipe_id,
        motivo,
        processoId,
        pedidoId:
          motivo === 'pedido_documento' || motivo === 'lembrete_prazo'
            ? (pedido?.id ?? null)
            : null,
        nota: b.nota ?? null,
        recurso: {
          corpo: `${municipio.nome}: tentámos ligar-lhe sobre o processo ${p.numero}. Veja aqui: ${link}`,
          chave: `chamada_manual:${id}`,
          motivo: 'processo',
          relacionado: { processo_id: processoId },
        },
        chave: `chamada_manual:${id}`,
        manual: { utilizadorId: u.id, forcarHorario: !!b.forcar_horario },
      });
      if (!r.agendada) {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'chamada_nao_permitida',
          TEXTO_SEM_CHAMADA[r.motivo],
          { motivo: r.motivo },
        );
      }
      await this.auditoria.registar(
        {
          municipioId: municipio.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'ligar',
          objetoTipo: 'chamada_saida',
          objetoId: r.id,
          dados: {
            processo_id: processoId,
            motivo,
            forcar_horario: !!b.forcar_horario,
          },
        },
        tx,
      );
      return r;
    });
    if (r.agendada_para.getTime() <= Date.now()) await this.despachar(r.id);
    return this.uma(municipio.id, r.id);
  }

  private async uma(municipioId: string, id: string) {
    const [c] = await this.db.query(
      `SELECT id, motivo, estado, tentativas, agendada_para, iniciada_em, terminada_em,
              processo_id, contexto, provider_ref, conversa_id, recurso_sms_id, erro, criada_em
       FROM chamadas_saida WHERE id = $1 AND municipio_id = $2`,
      [id, municipioId],
    );
    return c;
  }

  /** Só as agendadas (uma 'a_ligar' já está a tocar). */
  async cancelar(
    municipio: Municipio,
    u: UtilizadorPainel,
    id: string,
    b: z.output<typeof esquemaCancelar>,
  ) {
    await this.db.transaction(async (tx) => {
      const [c] = await tx.query<Chamada>(
        `SELECT ${COLUNAS} FROM chamadas_saida c
         WHERE c.id = $1 AND c.municipio_id = $2 FOR UPDATE`,
        [id, municipio.id],
      );
      if (!c) {
        throw new ErroApi(
          HttpStatus.NOT_FOUND,
          'nao_encontrado',
          'Chamada não encontrada.',
        );
      }
      if (c.estado !== 'agendada') {
        throw new ErroApi(
          HttpStatus.CONFLICT,
          'estado_invalido',
          'Só se cancela uma chamada ainda agendada.',
          { estado: c.estado },
        );
      }
      await this.terminar(tx, c, 'cancelada', `Cancelada por ${u.nome}.`);
      if (b.enviar_sms) await this.recurso(tx, c);
      await this.auditoria.registar(
        {
          municipioId: municipio.id,
          atorTipo: 'utilizador',
          atorId: u.id,
          acao: 'cancelar',
          objetoTipo: 'chamada_saida',
          objetoId: id,
          dados: { enviar_sms: b.enviar_sms },
        },
        tx,
      );
    });
    return this.uma(municipio.id, id);
  }

  async obterConfig(m: Municipio) {
    const [a] = await this.db.query<{
      chamadas_saida: unknown;
      agent_id: string | null;
      agent_id_saida: string | null;
    }>(
      `SELECT chamadas_saida, elevenlabs_agent_id AS agent_id,
              elevenlabs_agent_id_saida AS agent_id_saida
       FROM agente_config WHERE municipio_id = $1`,
      [m.id],
    );
    return {
      ...lerConfig(a?.chamadas_saida),
      agente_configurado: !!(a?.agent_id_saida ?? a?.agent_id),
      // false: as chamadas da câmara usam o agente de entrada (sem as
      // ferramentas das campanhas, emergências e antecipações).
      agente_saida_configurado: !!a?.agent_id_saida,
      elevenlabs_disponivel: !!this.apiKey,
    };
  }

  async guardarConfig(
    m: Municipio,
    u: UtilizadorPainel,
    b: z.output<typeof esquemaConfigChamadas>,
  ) {
    if (b.ativo && !b.numero_id) {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'sem_numero_saida',
        TEXTO_SEM_CHAMADA.sem_numero_saida,
      );
    }
    const config: ConfigChamadas = { ...b, motivos: [...new Set(b.motivos)] };
    const [a] = await this.db.query<{ municipio_id: string }>(
      `UPDATE agente_config SET chamadas_saida = $2 WHERE municipio_id = $1
       RETURNING municipio_id`,
      [m.id, JSON.stringify(config)],
    );
    if (!a) {
      throw new ErroApi(
        HttpStatus.CONFLICT,
        'agente_por_configurar',
        'O agente deste município ainda não está configurado.',
      );
    }
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'configurar_chamadas_saida',
      objetoTipo: 'agente_config',
      objetoId: m.id,
      dados: { ...config },
    });
    return this.obterConfig(m);
  }

  // ------------------------------------------------------------------
  // Ferramentas do agente
  // ------------------------------------------------------------------

  /** A chamada de saída desta conversa (pelo conversation_id do ElevenLabs). */
  private async daConversa(q: Q, conversaId: string | null) {
    if (!conversaId) return null;
    const [c] = await q.query<Chamada>(
      `SELECT ${COLUNAS} FROM chamadas_saida c
       JOIN conversas cv ON cv.provider_id = c.provider_conversa_ref
       WHERE cv.id = $1`,
      [conversaId],
    );
    if (c) {
      await q.query(
        'UPDATE conversas SET municipe_id = $2 WHERE id = $1 AND municipe_id IS DISTINCT FROM $2',
        [conversaId, c.municipe_id],
      );
    }
    return c ?? null;
  }

  async motivoDaChamada(ctx: ContextoFerramenta) {
    const c = await this.daConversa(this.db, ctx.conversaId);
    if (!c) {
      return {
        chamada_de_saida: false,
        instrucao: 'Foi a pessoa que ligou: segue o atendimento normal.',
      };
    }
    const v = variaveisSaida(c.id, c.motivo, c.contexto);
    if (c.motivo === 'campanha') {
      return {
        chamada_de_saida: true,
        motivo: v.motivo,
        mensagem: c.contexto.o_que_mudou ?? '',
        perguntas: c.contexto.campanha?.perguntas ?? [],
        instrucao:
          'Diz a mensagem, faz as perguntas uma de cada vez e ouve com calma. ' +
          'No fim usa resposta_campanha: estado "bem" ou "precisa_ajuda", com as necessidades e o que a pessoa disse. ' +
          'Se houver perigo para a vida (não respira, caiu e não se levanta, dor no peito), diz para ligar já 112.',
      };
    }
    return {
      chamada_de_saida: true,
      motivo: v.motivo,
      numero_processo: v.numero_processo,
      o_que_mudou: v.o_que_mudou,
      o_que_falta: v.o_que_falta,
      prazo: v.prazo,
      instrucao:
        'Explica o que mudou e o que falta, pergunta se tem dúvidas. O link do processo segue por SMS no fim da chamada.',
    };
  }

  /**
   * A pessoa não quer ser ligada: grava a recusa e cancela as chamadas que
   * estavam agendadas (os avisos dessas vão por SMS).
   */
  async naoQueroChamadas(ctx: ContextoFerramenta) {
    return this.db.transaction(async (tx) => {
      const c = await this.daConversa(tx, ctx.conversaId);
      const municipeId = c?.municipe_id ?? ctx.municipeId;
      if (!municipeId) {
        return {
          gravado: false,
          instrucao:
            'Não sei quem é a pessoa (número desconhecido). Diz que pode pedir ao balcão da câmara para não ser ligada.',
        };
      }
      await tx.query(
        `UPDATE municipes SET aceita_chamadas = false WHERE id = $1 AND municipio_id = $2`,
        [municipeId, ctx.municipio.id],
      );
      const pendentes = await tx.query<Chamada>(
        `SELECT ${COLUNAS} FROM chamadas_saida c
         WHERE c.municipe_id = $1 AND c.estado = 'agendada' FOR UPDATE`,
        [municipeId],
      );
      for (const p of pendentes) {
        await this.terminar(
          tx,
          p,
          'cancelada',
          'O munícipe pediu para não ser ligado.',
        );
        await this.recurso(tx, p);
      }
      await this.auditoria.registar(
        {
          municipioId: ctx.municipio.id,
          atorTipo: 'municipe',
          atorId: municipeId,
          acao: 'recusar_chamadas',
          objetoTipo: 'municipe',
          objetoId: municipeId,
          dados: { conversa_id: ctx.conversaId },
        },
        tx,
      );
      return {
        gravado: true,
        dizer:
          'Fica registado: não voltamos a ligar-lhe para avisos. Os avisos continuam a chegar por SMS.',
      };
    });
  }
}
