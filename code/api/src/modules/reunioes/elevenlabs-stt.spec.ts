import {
  formatarTranscricao,
  nomeOrador,
  transcrever,
  URL_STT,
} from './elevenlabs-stt.js';

function resposta(status: number, corpo: unknown): Response {
  return new Response(
    typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    { status },
  );
}

const PEDIDO = {
  apiKey: 'xi_teste',
  urlGravacao: 'https://s3.exemplo/gravacoes/reuniao.mp3?assinatura=1',
};

const PALAVRAS = [
  { text: 'Bom', type: 'word', speaker_id: 'speaker_0' },
  { text: ' ', type: 'spacing', speaker_id: 'speaker_0' },
  { text: 'dia.', type: 'word', speaker_id: 'speaker_0' },
  { text: ' ', type: 'spacing', speaker_id: 'speaker_1' },
  { text: '(aplausos)', type: 'audio_event', speaker_id: 'speaker_1' },
  { text: 'Ponto', type: 'word', speaker_id: 'speaker_1' },
  { text: ' ', type: 'spacing', speaker_id: 'speaker_1' },
  { text: '1.', type: 'word', speaker_id: 'speaker_1' },
  { text: ' ', type: 'spacing', speaker_id: 'speaker_0' },
  { text: 'Aprovado.', type: 'word', speaker_id: 'speaker_0' },
];

describe('transcrever (ElevenLabs speech-to-text)', () => {
  it('pedido: URL, header e campos do multipart; resposta com uma linha por orador', async () => {
    const buscar = jest.fn().mockResolvedValue(
      resposta(200, {
        language_code: 'por',
        language_probability: 0.98,
        text: 'Bom dia. Ponto 1. Aprovado.',
        words: PALAVRAS,
      }),
    );
    await expect(transcrever(buscar, PEDIDO)).resolves.toEqual({
      ok: true,
      texto: 'Orador 1: Bom dia.\nOrador 2: Ponto 1.\nOrador 1: Aprovado.',
      idioma: 'por',
    });
    const [url, init] = buscar.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_STT);
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(
      'xi_teste',
    );
    const corpo = init.body as FormData;
    expect(Object.fromEntries(corpo.entries())).toEqual({
      model_id: 'scribe_v1',
      cloud_storage_url: PEDIDO.urlGravacao,
      language_code: 'por',
      diarize: 'true',
      tag_audio_events: 'false',
      timestamps_granularity: 'word',
    });
  });

  it('sem diarização fica o texto corrido', () => {
    expect(formatarTranscricao({ text: '  Só texto. ', words: [] })).toBe(
      'Só texto.',
    );
    expect(nomeOrador('speaker_3')).toBe('Orador 4');
  });

  it('erros voltam no resultado, nunca lançam', async () => {
    await expect(
      transcrever(
        jest.fn().mockResolvedValue(resposta(401, 'chave inválida')),
        PEDIDO,
      ),
    ).resolves.toEqual({ ok: false, erro: 'ElevenLabs 401: chave inválida' });
    await expect(
      transcrever(jest.fn().mockRejectedValue(new Error('ECONNRESET')), PEDIDO),
    ).resolves.toEqual({
      ok: false,
      erro: 'ElevenLabs inacessível: ECONNRESET',
    });
    await expect(
      transcrever(
        jest.fn().mockResolvedValue(resposta(200, 'não é json')),
        PEDIDO,
      ),
    ).resolves.toEqual({ ok: false, erro: 'Resposta do ElevenLabs ilegível.' });
    await expect(
      transcrever(
        jest.fn().mockResolvedValue(resposta(200, { nada: 1 })),
        PEDIDO,
      ),
    ).resolves.toEqual({
      ok: false,
      erro: 'Resposta do ElevenLabs inesperada.',
    });
    await expect(
      transcrever(
        jest.fn().mockResolvedValue(resposta(200, { text: ' ' })),
        PEDIDO,
      ),
    ).resolves.toEqual({ ok: false, erro: 'A transcrição veio vazia.' });
  });
});
