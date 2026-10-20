/*
 * Chamadas de saída do ElevenLabs Agents (confirmado na documentação, out. 2026):
 *
 * - Twilio:    POST https://api.elevenlabs.io/v1/convai/twilio/outbound-call
 *   https://elevenlabs.io/docs/api-reference/twilio/outbound-call
 * - SIP trunk: POST https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call
 *   https://elevenlabs.io/docs/api-reference/sip-trunk/outbound-call
 *
 * Header `xi-api-key`. Corpo: agent_id, agent_phone_number_id, to_number,
 * conversation_initiation_client_data { dynamic_variables, user_id } e
 * telephony_call_config { ringing_timeout_secs } (por omissão 60 s).
 * Resposta: { success, message, conversation_id, callSid } (Twilio) ou
 * { success, message, conversation_id, sip_call_id } (SIP).
 *
 * O resultado chega pelo mesmo webhook do fim da chamada:
 * - atendida → `post_call_transcription` (com as nossas variáveis dinâmicas
 *   em conversation_initiation_client_data.dynamic_variables);
 * - não atendida, ocupado ou recusada → `call_initiation_failure`, com
 *   failure_reason 'busy' | 'no-answer' | 'unknown' e os dados do operador
 *   em metadata ({ type: 'twilio', body: { CallSid, CallStatus… } } ou
 *   { type: 'sip', body: { call_sid, sip_status_code… } }). Tem de estar
 *   ligado nas definições do webhook do agente/workspace.
 * - atendida pelo voicemail: NÃO há call_initiation_failure (a chamada
 *   começou); chega a transcrição sem nada dito pelo munícipe.
 */
import { z } from 'zod';
import type { WebhookTranscricao } from '../conversas/elevenlabs.js';

export const URL_ELEVENLABS = 'https://api.elevenlabs.io';

/** Quanto tempo toca antes de desistir (o ElevenLabs aceita até ao limite do operador). */
export const TOQUE_S = 40;

export type ViaSaida = 'twilio' | 'sip_trunk';

export interface PedidoSaida {
  apiKey: string;
  via: ViaSaida;
  agentId: string;
  numeroId: string;
  para: string;
  variaveis: Record<string, string>;
  /** O nosso id do munícipe (aparece no histórico do ElevenLabs). */
  utilizador?: string | null;
}

export type ResultadoSaida =
  | { ok: true; conversationId: string | null; callRef: string | null }
  | { ok: false; erro: string };

export const esquemaRespostaSaida = z
  .object({
    success: z.boolean(),
    message: z.string().nullish(),
    conversation_id: z.string().nullish(),
    callSid: z.string().nullish(),
    sip_call_id: z.string().nullish(),
  })
  .loose();

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

/** Pede a chamada ao ElevenLabs. Nunca lança: o erro volta no resultado. */
export async function pedirChamada(
  buscar: Buscar,
  p: PedidoSaida,
): Promise<ResultadoSaida> {
  const caminho = p.via === 'sip_trunk' ? 'sip-trunk' : 'twilio';
  const corpo = {
    agent_id: p.agentId,
    agent_phone_number_id: p.numeroId,
    to_number: p.para,
    conversation_initiation_client_data: {
      dynamic_variables: p.variaveis,
      ...(p.utilizador ? { user_id: p.utilizador } : {}),
    },
    telephony_call_config: { ringing_timeout_secs: TOQUE_S },
  };
  let r: Response;
  try {
    r = await buscar(`${URL_ELEVENLABS}/v1/convai/${caminho}/outbound-call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': p.apiKey },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return {
      ok: false,
      erro: `ElevenLabs inacessível: ${(e as Error).message}`,
    };
  }
  const texto = await r.text().catch(() => '');
  if (!r.ok) {
    return {
      ok: false,
      erro: `ElevenLabs ${r.status}: ${texto.slice(0, 300)}`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(texto);
  } catch {
    return { ok: false, erro: 'Resposta do ElevenLabs ilegível.' };
  }
  const v = esquemaRespostaSaida.safeParse(json);
  if (!v.success)
    return { ok: false, erro: 'Resposta do ElevenLabs inesperada.' };
  if (!v.data.success) {
    return {
      ok: false,
      erro: `ElevenLabs recusou: ${v.data.message ?? 'sem motivo'}`,
    };
  }
  return {
    ok: true,
    conversationId: v.data.conversation_id ?? null,
    callRef: v.data.callSid ?? v.data.sip_call_id ?? null,
  };
}

/** Webhook `call_initiation_failure` (só o que se usa). */
export const esquemaFalhaInicio = z.object({
  type: z.literal('call_initiation_failure'),
  event_timestamp: z.coerce.number().optional(),
  data: z.object({
    agent_id: z.string().nullish(),
    conversation_id: z.string().nullish(),
    failure_reason: z.string().nullish(),
    metadata: z
      .object({
        type: z.string().nullish(),
        body: z.record(z.string(), z.unknown()).nullish(),
      })
      .loose()
      .nullish(),
  }),
});

export type FalhaInicio = z.infer<typeof esquemaFalhaInicio>['data'];

/** O id da chamada no operador (CallSid do Twilio ou call_sid do SIP). */
export function refDaFalha(d: FalhaInicio): string | null {
  const b = d.metadata?.body ?? {};
  const v = b['CallSid'] ?? b['call_sid'];
  return typeof v === 'string' && v ? v : null;
}

/** 'busy' → 'ocupado'; o resto como veio. */
export function razaoFalada(razao: string | null | undefined): string {
  switch (razao) {
    case 'busy':
      return 'ocupado';
    case 'no-answer':
      return 'não atendeu';
    case 'sem_resposta':
      return 'atendeu sem ninguém falar (voicemail?)';
    default:
      return razao || 'desconhecido';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A nossa chamada de saída, pela variável que demos ao ElevenLabs. */
export function chamadaDaTranscricao(
  d: WebhookTranscricao['data'],
): string | null {
  const v =
    d.conversation_initiation_client_data?.dynamic_variables?.[
      'chamada_saida_id'
    ];
  return typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null;
}

/** O munícipe chegou a dizer alguma coisa? Sem isso foi voicemail ou caiu. */
export function municipeFalou(d: WebhookTranscricao['data']): boolean {
  return (d.transcript ?? []).some(
    (t) => t.role === 'user' && (t.message ?? '').trim().length > 0,
  );
}
