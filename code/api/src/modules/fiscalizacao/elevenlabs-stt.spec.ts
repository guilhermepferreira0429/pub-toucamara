import { type Buscar, transcrever, URL_STT } from './elevenlabs-stt';

const pedido = {
  apiKey: 'chave',
  modelo: 'scribe_v2',
  audio: Buffer.from('áudio de teste'),
  mime: 'audio/webm',
  nome: 'ditado.webm',
};

function falso(status: number, corpo: string) {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const buscar: Buscar = (url, init) => {
    pedidos.push({ url, init });
    return Promise.resolve(new Response(corpo, { status }));
  };
  return { buscar, pedidos };
}

describe('transcrever (ElevenLabs speech-to-text)', () => {
  it('envia multipart com o modelo, o idioma e o ficheiro; devolve o texto', async () => {
    const f = falso(
      200,
      JSON.stringify({
        text: ' O aviso está afixado. ',
        language_code: 'por',
        words: [],
      }),
    );
    const r = await transcrever(f.buscar, pedido);
    expect(r).toEqual({
      ok: true,
      texto: 'O aviso está afixado.',
      idioma: 'por',
    });
    const [p] = f.pedidos;
    expect(p.url).toBe(URL_STT);
    expect(p.init.method).toBe('POST');
    expect((p.init.headers as Record<string, string>)['xi-api-key']).toBe(
      'chave',
    );
    const corpo = p.init.body as FormData;
    expect(corpo.get('model_id')).toBe('scribe_v2');
    expect(corpo.get('language_code')).toBe('por');
    expect(corpo.get('tag_audio_events')).toBe('false');
    const ficheiro = corpo.get('file') as File;
    expect(ficheiro.name).toBe('ditado.webm');
    expect(ficheiro.type).toBe('audio/webm');
    expect(Buffer.from(await ficheiro.arrayBuffer()).toString()).toBe(
      'áudio de teste',
    );
  });

  it('erros voltam no resultado, sem lançar', async () => {
    expect(
      await transcrever(falso(401, 'unauthorized').buscar, pedido),
    ).toEqual({
      ok: false,
      erro: 'ElevenLabs 401: unauthorized',
    });
    expect(
      (await transcrever(falso(200, 'não é json').buscar, pedido)).ok,
    ).toBe(false);
    expect((await transcrever(falso(200, '{"x":1}').buscar, pedido)).ok).toBe(
      false,
    );
    expect(
      await transcrever(falso(200, '{"text":"  "}').buscar, pedido),
    ).toEqual({
      ok: false,
      erro: 'O áudio não tem fala reconhecível.',
    });
    const rede: Buscar = () => Promise.reject(new Error('ECONNRESET'));
    expect(await transcrever(rede, pedido)).toEqual({
      ok: false,
      erro: 'ElevenLabs inacessível: ECONNRESET',
    });
  });
});
