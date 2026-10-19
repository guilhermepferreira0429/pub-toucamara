import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';

/*
 * Webhooks do fim da chamada do ElevenLabs (post-call webhooks):
 * https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks
 *
 * - `post_call_transcription`: transcrição, metadados, análise e as
 *   variáveis dinâmicas (system__caller_id = número de quem ligou).
 * - `post_call_audio`: só agent_id, conversation_id e full_audio (MP3 em base64).
 * - `call_initiation_failure`: chamada que não chegou a começar (ignora-se).
 *
 * Header `ElevenLabs-Signature: t=<unix>,v0=<hex>` com
 * hex = HMAC-SHA256(segredo, `${t}.${rawBody}`). O SDK oficial aceita até
 * 30 minutos de atraso; aqui o mesmo, nos dois sentidos (relógios trocados).
 */

export const TOLERANCIA_ASSINATURA_S = 30 * 60;

export type ResultadoAssinatura =
  | { valida: true }
  | {
      valida: false;
      motivo: 'sem_cabecalho' | 'formato' | 'fora_de_tempo' | 'nao_confere';
    };

/** Verifica o header `ElevenLabs-Signature` contra o corpo tal como chegou. */
export function verificarAssinatura(
  cabecalho: string | undefined,
  rawBody: Buffer | string,
  segredo: string,
  agora: Date = new Date(),
): ResultadoAssinatura {
  if (!cabecalho) return { valida: false, motivo: 'sem_cabecalho' };
  const partes = cabecalho.split(',').map((p) => p.trim());
  const t = partes.find((p) => p.startsWith('t='))?.slice(2);
  const v0 = partes.find((p) => p.startsWith('v0='))?.slice(3);
  if (!t || !/^\d+$/.test(t) || !v0 || !/^[0-9a-f]{64}$/i.test(v0)) {
    return { valida: false, motivo: 'formato' };
  }
  const desvio = Math.abs(agora.getTime() / 1000 - Number(t));
  if (desvio > TOLERANCIA_ASSINATURA_S) {
    return { valida: false, motivo: 'fora_de_tempo' };
  }
  const esperado = createHmac('sha256', segredo)
    .update(`${t}.`)
    .update(rawBody)
    .digest();
  const recebido = Buffer.from(v0, 'hex');
  if (!timingSafeEqual(esperado, recebido)) {
    return { valida: false, motivo: 'nao_confere' };
  }
  return { valida: true };
}

/** Para testes e ferramentas de desenvolvimento: o header que o ElevenLabs mandaria. */
export function assinar(
  rawBody: string,
  segredo: string,
  t = Math.floor(Date.now() / 1000),
): string {
  const hex = createHmac('sha256', segredo)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  return `t=${t},v0=${hex}`;
}

// Só o que se usa; o resto do payload passa (o ElevenLabs acrescenta campos).
const entradaTranscricao = z.object({
  role: z.string(),
  message: z.string().nullish(),
  time_in_call_secs: z.number().nullish(),
});

export const esquemaTranscricao = z.object({
  type: z.literal('post_call_transcription'),
  event_timestamp: z.coerce.number().optional(),
  data: z.object({
    agent_id: z.string().min(1),
    conversation_id: z.string().min(1),
    status: z.string().nullish(),
    transcript: z.array(entradaTranscricao).nullish(),
    metadata: z
      .object({
        start_time_unix_secs: z.number().nullish(),
        call_duration_secs: z.number().nullish(),
        termination_reason: z.string().nullish(),
      })
      .nullish(),
    analysis: z
      .object({
        call_successful: z.string().nullish(),
        transcript_summary: z.string().nullish(),
        data_collection_results: z
          .record(z.string(), z.object({ value: z.unknown() }).loose())
          .nullish(),
      })
      .nullish(),
    conversation_initiation_client_data: z
      .object({
        dynamic_variables: z.record(z.string(), z.unknown()).nullish(),
      })
      .nullish(),
  }),
});

export const esquemaAudio = z.object({
  type: z.literal('post_call_audio'),
  data: z.object({
    agent_id: z.string().min(1),
    conversation_id: z.string().min(1),
    full_audio: z.string().min(1),
  }),
});

export type WebhookTranscricao = z.infer<typeof esquemaTranscricao>;

export interface TurnoNovo {
  ordem: number;
  papel: 'agente' | 'municipe';
  texto: string;
  inicio_ms: number | null;
  fim_ms: number | null;
}

/**
 * Turnos a gravar. Entradas sem texto (só chamadas a ferramentas) saem; o
 * fim de cada turno é o início do seguinte (ou o fim da chamada).
 */
export function converterTurnos(
  transcricao: {
    role: string;
    message?: string | null;
    time_in_call_secs?: number | null;
  }[],
  duracaoS: number | null,
): TurnoNovo[] {
  const comTexto = transcricao.filter(
    (e) => (e.message ?? '').trim().length > 0,
  );
  return comTexto.map((e, i) => {
    const inicio =
      e.time_in_call_secs == null
        ? null
        : Math.round(e.time_in_call_secs * 1000);
    const seguinte = comTexto[i + 1]?.time_in_call_secs;
    const fim =
      seguinte != null
        ? Math.round(seguinte * 1000)
        : duracaoS != null
          ? duracaoS * 1000
          : null;
    return {
      ordem: i + 1,
      papel: e.role === 'user' ? 'municipe' : 'agente',
      texto: e.message!.trim(),
      inicio_ms: inicio,
      fim_ms: fim != null && inicio != null && fim < inicio ? inicio : fim,
    };
  });
}

/** Abaixo disto, sem nada dito pelo munícipe, a chamada conta como 'caiu'. */
export const DURACAO_MINIMA_S = 10;

/**
 * Resultado no fim da chamada, só se as ferramentas não o marcaram (ainda
 * 'em_curso'): 'caiu' se o munícipe não disse nada ou a chamada durou menos
 * de 10 s; senão 'resolvida'. O resumo pode depois passá-la a
 * 'sem_resposta', 'passada_funcionario' ou 'marcacao'.
 */
export function resultadoPorOmissao(
  duracaoS: number | null,
  turnos: TurnoNovo[],
): 'resolvida' | 'caiu' {
  const falouMunicipe = turnos.some((t) => t.papel === 'municipe');
  if (!falouMunicipe) return 'caiu';
  if (duracaoS != null && duracaoS < DURACAO_MINIMA_S) return 'caiu';
  return 'resolvida';
}

/** Campo do "Data collection" do agente no ElevenLabs (booleano). */
export const CAMPO_CONSENTIMENTO = 'consentimento_gravacao';

/**
 * O munícipe aceitou a gravação? Só com sim explícito no campo de recolha de
 * dados `consentimento_gravacao` do agente. (O outro caminho é a ferramenta
 * marcar o momento 'consentimento' durante a chamada: ver o serviço.)
 */
export function consentiuNaAnalise(d: WebhookTranscricao['data']): boolean {
  const v = d.analysis?.data_collection_results?.[CAMPO_CONSENTIMENTO]?.value;
  if (v === true) return true;
  if (typeof v === 'string') {
    return ['true', 'sim', 'yes'].includes(v.trim().toLowerCase());
  }
  return false;
}

/** Número de quem ligou (variável de sistema do ElevenLabs). */
export function telefoneDaChamada(
  d: WebhookTranscricao['data'],
): string | null {
  const v =
    d.conversation_initiation_client_data?.dynamic_variables?.[
      'system__caller_id'
    ];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
