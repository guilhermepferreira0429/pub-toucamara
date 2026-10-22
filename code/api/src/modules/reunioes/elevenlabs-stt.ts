/*
 * Speech-to-text do ElevenLabs (Scribe) para a gravação das reuniões.
 *
 *   POST https://api.elevenlabs.io/v1/speech-to-text
 *   https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 *
 * Header `xi-api-key`. Corpo multipart/form-data:
 *   - model_id: 'scribe_v1'
 *   - cloud_storage_url: URL HTTPS do ficheiro (aqui, a URL assinada do S3,
 *     para a API não carregar a gravação inteira); em alternativa `file`.
 *   - language_code: 'por' (ISO 639-3; sem ele deteta a língua)
 *   - diarize: 'true' (separa quem fala: speaker_0, speaker_1...)
 *   - tag_audio_events: 'false' (sem "(aplausos)", "(risos)")
 *   - timestamps_granularity: 'word'
 * Resposta: { language_code, language_probability, text,
 *   words: [{ text, start, end, type: 'word'|'spacing'|'audio_event', speaker_id }] }.
 *
 * Uma reunião de 3 horas demora minutos: corre num job (fila
 * `reunioes_transcrever`), nunca no pedido do painel.
 */
import { z } from 'zod';

export const URL_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
export const MODELO_STT = 'scribe_v1';
/** Uma gravação longa pode demorar; o job espera até 15 minutos. */
export const TIMEOUT_STT_MS = 15 * 60_000;

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

export interface PedidoStt {
  apiKey: string;
  /** URL assinada (GET) da gravação no S3. */
  urlGravacao: string;
  idioma?: string;
}

export type ResultadoStt =
  | { ok: true; texto: string; idioma: string | null }
  | { ok: false; erro: string };

export const esquemaRespostaStt = z
  .object({
    language_code: z.string().nullish(),
    text: z.string(),
    words: z
      .array(
        z
          .object({
            text: z.string(),
            type: z.string().nullish(),
            speaker_id: z.string().nullish(),
          })
          .loose(),
      )
      .nullish(),
  })
  .loose();

export type RespostaStt = z.infer<typeof esquemaRespostaStt>;

/** 'speaker_0' → 'Orador 1'. */
export function nomeOrador(id: string): string {
  const m = /(\d+)$/.exec(id);
  return m ? `Orador ${Number(m[1]) + 1}` : id;
}

/**
 * A transcrição com uma linha por mudança de orador ("Orador 1: ..."), no
 * formato que o resto do módulo lê (regras.ts, lerFalas). Sem diarização
 * fica o texto corrido.
 */
export function formatarTranscricao(r: RespostaStt): string {
  const palavras = (r.words ?? []).filter((w) => w.type !== 'audio_event');
  if (!palavras.some((w) => w.speaker_id)) return r.text.trim();
  const linhas: { orador: string; texto: string }[] = [];
  for (const w of palavras) {
    const orador = w.speaker_id ? nomeOrador(w.speaker_id) : null;
    const ultima = linhas[linhas.length - 1];
    if (orador && (!ultima || ultima.orador !== orador)) {
      if (w.type === 'spacing') continue;
      linhas.push({ orador, texto: w.text });
    } else if (ultima) {
      ultima.texto += w.text;
    }
  }
  return linhas
    .map((l) => `${l.orador}: ${l.texto.replace(/\s+/g, ' ').trim()}`)
    .filter((l) => !/:\s*$/.test(l))
    .join('\n');
}

/** Pede a transcrição ao ElevenLabs. Nunca lança: o erro volta no resultado. */
export async function transcrever(
  buscar: Buscar,
  p: PedidoStt,
): Promise<ResultadoStt> {
  const corpo = new FormData();
  corpo.append('model_id', MODELO_STT);
  corpo.append('cloud_storage_url', p.urlGravacao);
  corpo.append('language_code', p.idioma ?? 'por');
  corpo.append('diarize', 'true');
  corpo.append('tag_audio_events', 'false');
  corpo.append('timestamps_granularity', 'word');
  let r: Response;
  try {
    r = await buscar(URL_STT, {
      method: 'POST',
      headers: { 'xi-api-key': p.apiKey },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_STT_MS),
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
  const v = esquemaRespostaStt.safeParse(json);
  if (!v.success) {
    return { ok: false, erro: 'Resposta do ElevenLabs inesperada.' };
  }
  const final = formatarTranscricao(v.data);
  if (!final) return { ok: false, erro: 'A transcrição veio vazia.' };
  return { ok: true, texto: final, idioma: v.data.language_code ?? null };
}
