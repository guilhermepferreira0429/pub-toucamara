/*
 * Juntar um familiar à chamada (sem BD, para testar à parte).
 *
 * Com o Twilio (API REST 2010-04-01, conferências):
 * 1. A chamada do munícipe (CallSid, que o ElevenLabs dá às ferramentas em
 *    {{system__call_sid}}) recebe TwiML novo: <Dial><Conference>sala. A
 *    ligação ao ElevenLabs cai e o munícipe fica na sala.
 * 2. POST /Conferences/{sala}/Participants: o agente volta a entrar, com
 *    uma chamada da linha para a própria linha (o ElevenLabs atende-a como
 *    qualquer outra; o início da chamada reconhece-a por quem liga ser a
 *    linha e dá-lhe o contexto da junção).
 * 3. POST /Conferences/{sala}/Participants: o familiar, com StatusCallback
 *    para sabermos se atendeu.
 *
 * O Participants aceita o FriendlyName da conferência no lugar do SID.
 * O webhook do Twilio é assinado: X-Twilio-Signature = base64(HMAC-SHA1(
 * auth token, URL completo + cada parâmetro POST ordenado, nome+valor)).
 */
export { assinaturaTwilio, assinaturaValida } from '../../common/twilio.js';

export const URL_TWILIO = 'https://api.twilio.com/2010-04-01';

/** Quanto tempo toca o telefone do familiar. */
export const TOQUE_FAMILIAR_S = 30;

/** Uma chamada da linha para a linha só é a do agente se a junção for recente. */
export const JANELA_AGENTE_S = 180;

/** O agente precisa de tempo para dizer "um momento" antes de a chamada mudar. */
export const ESPERA_ANTES_DE_JUNTAR_S = 6;

export type EstadoJuncao =
  | 'pedida'
  | 'a_juntar'
  | 'agente_ligado'
  | 'familiar_atendeu'
  | 'familiar_nao_atendeu'
  | 'terminada'
  | 'falhou'
  | 'sms_enviado';

export function escaparXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** TwiML que passa o munícipe para a sala (a sala acaba quando ele sai). */
export function twimlSala(sala: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Response><Dial>' +
    '<Conference startConferenceOnEnter="true" endConferenceOnExit="true" beep="false">' +
    `${escaparXml(sala)}</Conference></Dial></Response>`
  );
}

/** Nome da sala: curto, sem dados pessoais. */
export function nomeSala(id: string): string {
  return `tc-familiar-${id.replace(/-/g, '').slice(0, 16)}`;
}

/** Estado do participante (CallStatus do StatusCallback) → estado da junção. */
export function estadoDoParticipante(
  callStatus: string,
  atual: EstadoJuncao,
): EstadoJuncao | null {
  switch (callStatus) {
    case 'in-progress':
    case 'answered':
      return 'familiar_atendeu';
    case 'busy':
    case 'no-answer':
    case 'failed':
    case 'canceled':
      return 'familiar_nao_atendeu';
    case 'completed':
      return atual === 'familiar_atendeu'
        ? 'terminada'
        : 'familiar_nao_atendeu';
    default:
      return null; // queued, initiated, ringing: nada muda
  }
}

/** Como o agente fala do familiar: "a sua filha Ana", "o Rui". */
export function quemFalado(
  nome: string | null,
  relacao: string | null,
): string {
  const r = relacao?.trim().toLowerCase();
  const n = nome?.trim();
  if (r && n) return `${r} ${n}`;
  return r || n || 'o seu familiar';
}
