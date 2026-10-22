import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AcompanhamentoFamiliarService } from '../ao-vivo/acompanhamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { primeiroNome } from '../conversas/retomar.js';
import { normalizarTelefone } from '../municipes/municipes.service.js';
import type { Buscar } from './elevenlabs-saida.js';
import {
  assinaturaValida,
  ESPERA_ANTES_DE_JUNTAR_S,
  estadoDoParticipante,
  EstadoJuncao,
  JANELA_AGENTE_S,
  nomeSala,
  quemFalado,
  TOQUE_FAMILIAR_S,
  twimlSala,
  URL_TWILIO,
} from './juncao-familiar.js';
import { VARIAVEIS_SAIDA_VAZIAS } from './regras.js';

export const FILA_JUNTAR_FAMILIAR = 'juntar_familiar';

/** Máximo de familiares por conversa (evita uma chamada a ligar a meia família). */
const MAXIMO_POR_CONVERSA = 2;

export const entradaJuntarFamiliar = z.object({
  telefone: z
    .string()
    .trim()
    .min(9)
    .max(20)
    .describe('Número do familiar, como o disse.'),
  nome: z.string().trim().max(60).nullish().describe('Nome, se o disse.'),
  relacao: z
    .string()
    .trim()
    .max(40)
    .nullish()
    .describe('Ex.: "a minha filha".'),
  resumo: z
    .string()
    .trim()
    .min(10)
    .max(800)
    .describe(
      'O que já falaram e vais explicar aos dois, em 2 a 4 frases (dizes ao voltar).',
    ),
  autorizou: z
    .boolean()
    .nullish()
    .describe('Pelo browser: true só depois do sim à pergunta do "dizer".'),
  call_sid: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .describe('Preenchido pelo sistema ({{system__call_sid}}). Não perguntes.'),
});

interface Juncao {
  id: string;
  municipio_id: string;
  conversa_id: string | null;
  municipe_id: string | null;
  telefone_familiar: string;
  nome_familiar: string | null;
  relacao: string | null;
  resumo: string;
  call_sid_municipe: string | null;
  sala: string;
  modo: 'conferencia' | 'sms';
  estado: EstadoJuncao;
}

/**
 * "Fale com o meu filho": o agente junta o familiar à chamada e explica aos
 * dois (funcionalidades que nos põem à frente, n.º 4). Ver juncao-familiar.ts
 * para o fluxo no Twilio. Sem Twilio, fora do telefone ou sem o CallSid, o
 * familiar recebe um SMS para ligar para a linha (só o primeiro nome de
 * quem pediu, nada do assunto).
 *
 * Por testar numa chamada real: a chamada da linha para a própria linha (o
 * agente a voltar) e o áudio da conferência no ElevenLabs.
 */
@Injectable()
export class JuncaoFamiliarService {
  private readonly logger = new Logger(JuncaoFamiliarService.name);
  /** Trocável nos testes. */
  buscar: Buscar = (url, init) => fetch(url, init);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly jobs: JobsService,
    private readonly mensagens: MensagensService,
    private readonly auditoria: AuditoriaService,
    private readonly acompanhamento: AcompanhamentoFamiliarService,
  ) {}

  private get twilio() {
    return (
      this.config.get<{ accountSid: string; authToken: string }>(
        'comunicacao.twilio',
      ) ?? { accountSid: '', authToken: '' }
    );
  }

  private get apiUrl(): string {
    return this.config.get<string>('app.apiUrl') ?? '';
  }

  /** Ferramenta `juntar_familiar`. */
  async pedir(
    ctx: ContextoFerramenta,
    e: z.output<typeof entradaJuntarFamiliar>,
  ) {
    const telefone = normalizarTelefone(e.telefone);
    if (!telefone || !/^\+\d{9,15}$/.test(telefone)) {
      return {
        juntado: false,
        dizer: 'Não percebi bem o número. Pode dizê-lo outra vez, devagar?',
      };
    }
    if (telefone === ctx.telefone) {
      return {
        juntado: false,
        dizer:
          'Esse é o número de onde está a ligar. Qual é o número do seu familiar?',
      };
    }
    if (ctx.conversaId) {
      const [n] = await this.db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM juncoes_familiar WHERE conversa_id = $1`,
        [ctx.conversaId],
      );
      if ((n?.n ?? 0) >= MAXIMO_POR_CONVERSA) {
        return {
          juntado: false,
          dizer:
            'Nesta chamada já não consigo juntar mais ninguém. Posso mandar um SMS com o resumo para o seu telemóvel.',
        };
      }
    }
    // Chamada web (/ligar) com transcrição em direto: o familiar acompanha
    // por um link e escreve ao agente, em vez da conferência no Twilio.
    const web = await this.acompanhamento.sessaoAtiva(ctx.conversaId);
    if (web)
      return this.acompanhamento.juntarNaChamadaWeb(ctx, e, telefone, web);

    const [mun] = await this.db.query<{ telefone_linha: string | null }>(
      `SELECT telefone_linha FROM municipios WHERE id = $1`,
      [ctx.municipio.id],
    );
    const linha = normalizarTelefone(mun?.telefone_linha);
    const tw = this.twilio;
    const conferencia =
      ctx.canal === 'telefone' &&
      !!e.call_sid &&
      !!linha &&
      !!tw.accountSid &&
      !!tw.authToken;
    const quem = quemFalado(e.nome ?? null, e.relacao ?? null);

    const [j] = await this.db.query<{ id: string }>(
      `INSERT INTO juncoes_familiar
         (municipio_id, conversa_id, municipe_id, telefone_familiar, nome_familiar,
          relacao, resumo, call_sid_municipe, sala, modo, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'tc-familiar-' || gen_random_uuid(), $9, $10)
       RETURNING id`,
      [
        ctx.municipio.id,
        ctx.conversaId,
        ctx.municipeId,
        telefone,
        e.nome ?? null,
        e.relacao ?? null,
        e.resumo,
        e.call_sid ?? null,
        conferencia ? 'conferencia' : 'sms',
        conferencia ? 'a_juntar' : 'pedida',
      ],
    );
    await this.db.query(`UPDATE juncoes_familiar SET sala = $2 WHERE id = $1`, [
      j.id,
      nomeSala(j.id),
    ]);
    await this.auditoria.registar({
      municipioId: ctx.municipio.id,
      atorTipo: 'agente',
      acao: 'juntar_familiar',
      objetoTipo: 'juncao_familiar',
      objetoId: j.id,
      dados: { modo: conferencia ? 'conferencia' : 'sms', canal: ctx.canal },
    });

    if (conferencia) {
      await this.jobs
        .enviar(
          FILA_JUNTAR_FAMILIAR,
          { juncaoId: j.id },
          {
            startAfter: ESPERA_ANTES_DE_JUNTAR_S,
            singletonKey: j.id,
            retryLimit: 0,
          },
        )
        .catch((err: Error) =>
          this.logger.error(`Junção ${j.id} fora da fila: ${err.message}`),
        );
      return {
        juntado: true,
        modo: 'conferencia',
        dizer: `Vou juntar ${quem} à chamada. Fique em linha: daqui a uns segundos volta a ouvir-me e depois o telefone de ${quem} toca.`,
      };
    }

    await this.smsAoFamiliar(ctx, j.id, telefone, e.nome ?? null, linha);
    return {
      juntado: false,
      modo: 'sms',
      dizer:
        ctx.canal === 'telefone'
          ? `Daqui não consigo juntar ${quem} à chamada. Mandei-lhe um SMS a pedir que ligue para esta linha; quando ligar, eu explico tudo.`
          : `Por aqui não consigo juntar ${quem}. Mandei-lhe um SMS a pedir que ligue para a linha da câmara.`,
    };
  }

  private async smsAoFamiliar(
    ctx: ContextoFerramenta,
    id: string,
    telefone: string,
    nome: string | null,
    linha: string | null,
  ) {
    const [m] = await this.db.query<{ nome: string | null }>(
      `SELECT nome FROM municipes
       WHERE municipio_id = $1 AND anonimizado_em IS NULL
         AND (id = $2 OR ($2::uuid IS NULL AND telefone_e164 = $3))
       LIMIT 1`,
      [ctx.municipio.id, ctx.municipeId, ctx.telefone],
    );
    const de = primeiroNome(m?.nome);
    const corpo =
      `Olá${nome ? ` ${primeiroNome(nome)}` : ''}. ${de || 'Um familiar seu'} pediu à Câmara Municipal de ${ctx.municipio.nome} ` +
      `para falar consigo sobre um assunto que está a tratar connosco.` +
      (linha
        ? ` Ligue para ${linha}${de ? ` e diga que vem da parte de ${de}` : ''}.`
        : '');
    await this.mensagens.sms({
      municipioId: ctx.municipio.id,
      municipeId: null,
      destino: telefone,
      motivo: 'familiar',
      corpo,
      relacionado: {
        juncao_familiar_id: id,
        ...(ctx.conversaId ? { conversa_id: ctx.conversaId } : {}),
      },
      chave: `familiar:${id}`,
    });
    await this.mudarEstado(id, 'sms_enviado');
  }

  /**
   * Trabalho da fila (alguns segundos depois do pedido): munícipe para a sala,
   * agente de volta, familiar chamado. Se a sala falhar depois de o munícipe
   * já lá estar, volta a ligar o munícipe à linha (não fica num silêncio).
   */
  async executar(id: string): Promise<void> {
    const [j] = await this.db.query<Juncao & { linha: string | null }>(
      `SELECT j.*, m.telefone_linha AS linha FROM juncoes_familiar j
       JOIN municipios m ON m.id = j.municipio_id
       WHERE j.id = $1 AND j.estado = 'a_juntar' AND j.modo = 'conferencia'`,
      [id],
    );
    if (!j) return;
    const linha = normalizarTelefone(j.linha);
    if (!linha || !j.call_sid_municipe) {
      await this.mudarEstado(id, 'falhou', 'sem linha ou sem CallSid');
      return;
    }
    const sid = encodeURIComponent(j.call_sid_municipe);
    const sala = encodeURIComponent(j.sala);

    const mover = await this.twilioPost(`/Calls/${sid}.json`, {
      Twiml: twimlSala(j.sala),
    });
    if (!mover.ok) {
      // O munícipe continua com o agente: só fica registado.
      await this.mudarEstado(id, 'falhou', mover.erro);
      return;
    }
    const agente = await this.twilioPost(
      `/Conferences/${sala}/Participants.json`,
      { From: linha, To: linha, Label: 'agente', EarlyMedia: 'false' },
    );
    const familiar = agente.ok
      ? await this.twilioPost(
          `/Conferences/${sala}/Participants.json`,
          {
            From: linha,
            To: j.telefone_familiar,
            Label: 'familiar',
            Timeout: String(TOQUE_FAMILIAR_S),
            StatusCallback: `${this.apiUrl}/v1/webhooks/twilio/juncoes/${id}`,
            StatusCallbackMethod: 'POST',
          },
          [
            ['StatusCallbackEvent', 'answered'],
            ['StatusCallbackEvent', 'completed'],
          ],
        )
      : agente;
    if (!familiar.ok) {
      await this.mudarEstado(id, 'falhou', familiar.erro);
      // Sem o agente na sala, o munícipe volta à linha (nova conversa, com
      // o contexto de quem liga).
      await this.twilioPost(`/Calls/${sid}.json`, {
        Twiml:
          '<?xml version="1.0" encoding="UTF-8"?><Response>' +
          '<Say language="pt-PT">Não consegui juntar o seu familiar. Vou passá-lo outra vez ao assistente.</Say>' +
          `<Dial>${linha}</Dial></Response>`,
      });
    }
  }

  /**
   * Início de uma chamada no ElevenLabs em que quem liga é a própria linha:
   * é o agente a voltar à sala de uma junção. Devolve as variáveis dinâmicas
   * (as mesmas das chamadas de saída, tipo_chamada = 'juncao_familiar'), ou
   * null se não for.
   */
  async inicioDoAgente(
    callerId: string | null | undefined,
    numeroChamado: string | null | undefined,
  ): Promise<Record<string, string> | null> {
    const de = normalizarTelefone(callerId);
    if (!de || de !== normalizarTelefone(numeroChamado)) return null;
    const [j] = await this.db.query<Juncao & { nome_municipe: string | null }>(
      `UPDATE juncoes_familiar j SET estado = 'agente_ligado', atualizada_em = now()
       FROM (
         SELECT j2.id FROM juncoes_familiar j2
         JOIN municipios m ON m.id = j2.municipio_id
         WHERE j2.estado = 'a_juntar'
           AND regexp_replace(m.telefone_linha, '[^0-9+]', '', 'g') = $1
           AND j2.criada_em > now() - make_interval(secs => $2)
         ORDER BY j2.criada_em DESC LIMIT 1
         FOR UPDATE OF j2 SKIP LOCKED
       ) x
       WHERE j.id = x.id
       RETURNING j.*, (SELECT nome FROM municipes WHERE id = j.municipe_id) AS nome_municipe`,
      [de, JANELA_AGENTE_S],
    );
    if (!j) return null;
    const quem = quemFalado(j.nome_familiar, j.relacao);
    return {
      ...VARIAVEIS_SAIDA_VAZIAS,
      tipo_chamada: 'juncao_familiar',
      motivo: `${primeiroNome(j.nome_municipe) || 'A pessoa'} pediu para juntar ${quem} à chamada. Diga que já voltou, que ${quem} vai ser chamado e, quando atender, explique tudo aos dois.`,
      o_que_mudou: j.resumo,
      nome_municipe: primeiroNome(j.nome_municipe),
    };
  }

  /** StatusCallback do participante familiar (assinado pelo Twilio). */
  async estadoTwilio(
    id: string,
    parametros: Record<string, string>,
    assinatura: string | undefined,
  ): Promise<{ ok: boolean }> {
    const url = `${this.apiUrl}/v1/webhooks/twilio/juncoes/${id}`;
    if (!assinaturaValida(this.twilio.authToken, url, parametros, assinatura)) {
      return { ok: false };
    }
    const [j] = await this.db.query<{ estado: EstadoJuncao }>(
      `SELECT estado FROM juncoes_familiar WHERE id = $1`,
      [id],
    );
    if (!j) return { ok: true };
    const novo = estadoDoParticipante(parametros['CallStatus'] ?? '', j.estado);
    if (novo && novo !== j.estado) await this.mudarEstado(id, novo);
    return { ok: true };
  }

  /** Ferramenta `estado_familiar`: o agente na sala pergunta se o familiar atendeu. */
  async estadoParaAgente(ctx: ContextoFerramenta) {
    const [j] = await this.db.query<Juncao>(
      `SELECT j.* FROM juncoes_familiar j
       WHERE j.municipio_id = $1 AND j.modo = 'conferencia'
         AND j.estado IN ('agente_ligado','familiar_atendeu','familiar_nao_atendeu')
         AND j.criada_em > now() - interval '30 minutes'
       ORDER BY j.criada_em DESC LIMIT 1`,
      [ctx.municipio.id],
    );
    if (!j) return { estado: 'sem_juncao' };
    const quem = quemFalado(j.nome_familiar, j.relacao);
    const dizer: Record<string, string> = {
      agente_ligado: `O telefone de ${quem} ainda está a tocar. Peça para aguardar um pouco.`,
      familiar_atendeu: `${quem} já está na chamada. Cumprimente e explique o assunto aos dois.`,
      familiar_nao_atendeu: `${quem} não atendeu. Ofereça mandar um SMS com o resumo ou tentar mais tarde.`,
    };
    return { estado: j.estado, dizer: dizer[j.estado] };
  }

  private async mudarEstado(id: string, estado: EstadoJuncao, erro?: string) {
    await this.db.query(
      `UPDATE juncoes_familiar SET estado = $2, erro = coalesce($3, erro), atualizada_em = now()
       WHERE id = $1`,
      [id, estado, erro ?? null],
    );
  }

  private async twilioPost(
    caminho: string,
    campos: Record<string, string>,
    repetidos: [string, string][] = [],
  ): Promise<{ ok: true } | { ok: false; erro: string }> {
    const { accountSid, authToken } = this.twilio;
    const corpo = new URLSearchParams(campos);
    for (const [k, v] of repetidos) corpo.append(k, v);
    try {
      const r = await this.buscar(
        `${URL_TWILIO}/Accounts/${accountSid}${caminho}`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: corpo.toString(),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (r.ok) return { ok: true };
      const texto = await r.text().catch(() => '');
      return { ok: false, erro: `Twilio ${r.status}: ${texto.slice(0, 300)}` };
    } catch (e) {
      return { ok: false, erro: `Twilio inacessível: ${(e as Error).message}` };
    }
  }
}
