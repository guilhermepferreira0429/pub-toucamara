/*
 * Speech-to-text do ElevenLabs (Scribe) para o relatório ditado no terreno.
 *
 * NÃO CONFIRMADO na documentação (sem rede ao escrever isto); é o pedido
 * documentado em https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 * tal como o conhecemos:
 *
 *   POST https://api.elevenlabs.io/v1/speech-to-text
 *   Header  xi-api-key: <ELEVENLABS_API_KEY>
 *   Corpo   multipart/form-data:
 *             model_id        'scribe_v2' (ou 'scribe_v1'; ELEVENLABS_STT_MODELO)
 *             file            o áudio (webm/ogg/m4a/mp3/wav)
 *             language_code   'por' (ISO-639-3; também aceita 'pt')
 *             tag_audio_events 'false' (não queremos "(risos)" no relatório)
 *   Resposta 200 JSON: { language_code, language_probability, text, words: [...] }
 *
 * O cliente fica isolado aqui (como chamadas-saida/elevenlabs-saida.ts) e
 * testa-se com um `buscar` falso. Confirmar o modelo e os campos antes de
 * pôr em produção.
 */
import { z } from 'zod';

export const URL_STT = 'https://api.elevenlabs.io/v1/speech-to-text';
export const MODELO_STT_POR_OMISSAO = 'scribe_v2';

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

export interface PedidoTranscricao {
  apiKey: string;
  modelo: string;
  audio: Buffer;
  mime: string;
  /** Nome do ficheiro no multipart (alguns formatos são detetados pela extensão). */
  nome: string;
  /** ISO-639-3. */
  idioma?: string;
}

export type ResultadoTranscricao =
  | { ok: true; texto: string; idioma: string | null }
  | { ok: false; erro: string };

export const esquemaRespostaStt = z
  .object({
    text: z.string(),
    language_code: z.string().nullish(),
  })
  .loose();

/** Pede a transcrição. Nunca lança: o erro volta no resultado. */
export async function transcrever(
  buscar: Buscar,
  p: PedidoTranscricao,
): Promise<ResultadoTranscricao> {
  const corpo = new FormData();
  corpo.append('model_id', p.modelo);
  corpo.append('language_code', p.idioma ?? 'por');
  corpo.append('tag_audio_events', 'false');
  corpo.append(
    'file',
    new Blob([new Uint8Array(p.audio)], { type: p.mime }),
    p.nome,
  );
  let r: Response;
  try {
    r = await buscar(URL_STT, {
      method: 'POST',
      headers: { 'xi-api-key': p.apiKey },
      body: corpo,
      signal: AbortSignal.timeout(120_000),
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
  if (!v.success)
    return { ok: false, erro: 'Resposta do ElevenLabs inesperada.' };
  const t = v.data.text.trim();
  if (!t) return { ok: false, erro: 'O áudio não tem fala reconhecível.' };
  return { ok: true, texto: t, idioma: v.data.language_code ?? null };
}

/** Formatos que os telemóveis gravam. */
export const MIME_AUDIO: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};
