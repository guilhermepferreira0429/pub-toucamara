import { DescarregadorService } from './descarregador.service.js';
import { ErroFonte } from './recolha.js';

/** Sem esperas a sério: regista quanto teria esperado. */
class SemEspera extends DescarregadorService {
  esperas: number[] = [];
  protected esperar(ms: number): Promise<void> {
    this.esperas.push(ms);
    return Promise.resolve();
  }
}

type Rota = (init: RequestInit) => Response;

describe('DescarregadorService', () => {
  const fetchOriginal = global.fetch;
  let rotas: Record<string, Rota | Rota[]>;
  let pedidos: { url: string; headers: Record<string, string> }[];

  beforeEach(() => {
    rotas = {};
    pedidos = [];
    global.fetch = jest.fn((url: string, init: RequestInit) => {
      pedidos.push({ url, headers: init.headers as Record<string, string> });
      const r = rotas[new URL(url).pathname];
      const fn = Array.isArray(r) ? r.shift() : r;
      return Promise.resolve(fn ? fn(init) : new Response('', { status: 404 }));
    }) as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  const html = (corpo: string, headers: Record<string, string> = {}) =>
    new Response(corpo, {
      status: 200,
      headers: { 'content-type': 'text/html', ...headers },
    });

  it('devolve os bytes, o tipo e o ETag/Last-Modified', async () => {
    rotas['/taxas'] = () =>
      html('<p>ok</p>', { etag: '"v1"', 'last-modified': 'Mon, 19 Oct 2026' });
    const d = await new SemEspera().obter('https://cm.pt/taxas');
    expect(d).toMatchObject({
      estado: 'ok',
      http: 200,
      tipo: 'text/html',
      etag: '"v1"',
      ultimaModificacao: 'Mon, 19 Oct 2026',
    });
    expect(d.estado === 'ok' && d.bytes.toString()).toBe('<p>ok</p>');
  });

  it('pedido condicional: manda If-None-Match / If-Modified-Since e aceita 304', async () => {
    rotas['/taxas'] = () => new Response(null, { status: 304 });
    const d = await new SemEspera().obter('https://cm.pt/taxas', {
      etag: '"v1"',
      ultimaModificacao: 'Mon, 19 Oct 2026',
    });
    expect(d).toEqual({ estado: 'nao_modificado', http: 304 });
    const p = pedidos.find((x) => x.url.endsWith('/taxas'))!;
    expect(p.headers['If-None-Match']).toBe('"v1"');
    expect(p.headers['If-Modified-Since']).toBe('Mon, 19 Oct 2026');
    expect(p.headers['User-Agent']).toMatch(/^TouCamara\//);
  });

  it('respeita o robots.txt, a não ser que a câmara autorize', async () => {
    rotas['/robots.txt'] = () =>
      new Response('User-agent: *\nDisallow: /privado');
    rotas['/privado/x'] = () => html('segredo');
    const d = new SemEspera();
    await expect(d.obter('https://cm.pt/privado/x')).rejects.toMatchObject({
      codigo: 'robots',
    });
    await expect(
      d.obter('https://cm.pt/privado/x', { ignorarRobots: true }),
    ).resolves.toMatchObject({ estado: 'ok' });
    // O robots.txt fica em cache: só se pediu uma vez.
    expect(pedidos.filter((p) => p.url.endsWith('/robots.txt'))).toHaveLength(
      1,
    );
  });

  it('5xx e 429 repetem (o Retry-After conta); à 3.ª desiste', async () => {
    rotas['/a'] = [
      () => new Response('', { status: 503 }),
      () => new Response('', { status: 429, headers: { 'retry-after': '20' } }),
      () => html('<p>finalmente</p>'),
    ];
    const d = new SemEspera();
    d.intervaloMs = 0;
    await expect(d.obter('https://cm.pt/a')).resolves.toMatchObject({
      estado: 'ok',
    });
    expect(d.esperas).toEqual([2_000, 20_000]);

    rotas['/b'] = () => new Response('', { status: 500 });
    await expect(d.obter('https://cm.pt/b')).rejects.toThrow(
      'HTTP 500 (3 tentativas)',
    );
  });

  it('4xx é definitivo, com uma mensagem para o painel', async () => {
    rotas['/foi'] = () => new Response('', { status: 410 });
    rotas['/bloq'] = () => new Response('', { status: 403 });
    const d = new SemEspera();
    const e1 = await d.obter('https://cm.pt/foi').catch((e: ErroFonte) => e);
    expect(e1).toMatchObject({ codigo: 'nao_existe' });
    const e2 = await d.obter('https://cm.pt/bloq').catch((e: ErroFonte) => e);
    expect(e2).toMatchObject({ codigo: 'bloqueado' });
    expect(pedidos.filter((p) => p.url.endsWith('/foi'))).toHaveLength(1);
  });

  it('espaça os pedidos ao mesmo site (o Crawl-delay manda se for maior)', async () => {
    rotas['/robots.txt'] = () => new Response('User-agent: *\nCrawl-delay: 5');
    rotas['/1'] = () => html('1');
    rotas['/2'] = () => html('2');
    const d = new SemEspera();
    d.intervaloMs = 2_000;
    await d.obter('https://cm.pt/1');
    await d.obter('https://cm.pt/2');
    // O 2.º pedido esperou ~5 s (o 1.º não esperou nada).
    expect(d.esperas).toHaveLength(1);
    expect(d.esperas[0]).toBeGreaterThan(4_000);
    expect(d.esperas[0]).toBeLessThanOrEqual(5_000);
  });
});
