/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { randomUUID } from 'crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import PDFDocument from 'pdfkit';
import { DescobertaService } from '../../src/modules/conhecimento/descoberta.service';
import { IngestaoService } from '../../src/modules/conhecimento/ingestao.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  linhas,
  MUNICIPIO_ID,
} from './app';

/*
 * Recolha das fontes (scrapers): hora diária, histórico das leituras,
 * pedido condicional (304), seletor, robots.txt, PDF com texto, arquivar e
 * a descoberta das páginas de um site (sitemap e links). As páginas vêm de
 * um servidor HTTP local; a leitura corre chamando a ingestão diretamente,
 * para não depender do tick de 5 minutos.
 */

type Pagina = {
  tipo: string;
  corpo: string | Buffer;
  etag?: string;
};

function pdf(texto: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const partes: Buffer[] = [];
    doc.on('data', (d: Buffer) => partes.push(d));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    doc.font('Helvetica').text(texto);
    doc.end();
  });
}

const html = (titulo: string, corpo: string, links: string[] = []) =>
  `<html><head><title>${titulo}</title></head><body><nav>Menu</nav><main>
   <h1>${titulo}</h1><p>${corpo}</p>
   ${links.map((l) => `<a href="${l}">${l}</a>`).join(' ')}
   </main></body></html>`;

describe('recolha das fontes', () => {
  let ctx: Contexto;
  let servidor: Server;
  let base: string;
  const paginas: Record<string, Pagina> = {};
  const pedidos: { url: string; inm?: string }[] = [];
  let chefe: Record<string, string>;
  let entidade: string;
  let ingestao: IngestaoService;
  let descoberta: DescobertaService;

  const responder = (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';
    pedidos.push({ url, inm: req.headers['if-none-match'] as string });
    const p = paginas[url];
    if (!p) return res.writeHead(404).end();
    if (p.etag && req.headers['if-none-match'] === p.etag) {
      return res.writeHead(304).end();
    }
    res
      .writeHead(200, {
        'Content-Type': p.tipo,
        ...(p.etag ? { ETag: p.etag } : {}),
      })
      .end(p.corpo);
  };

  beforeAll(async () => {
    servidor = createServer(responder);
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    paginas['/robots.txt'] = {
      tipo: 'text/plain',
      corpo: 'User-agent: *\nDisallow: /privado/\n',
    };

    ctx = await arrancarApp();
    ingestao = ctx.app.get(IngestaoService);
    descoberta = ctx.app.get(DescobertaService);
    entidade = randomUUID();
    await ctx.db.query(
      `INSERT INTO entidades (id, municipio_id, nome, tipo) VALUES ($1, $2, 'Câmara (recolha e2e)', 'camara')`,
      [entidade, MUNICIPIO_ID],
    );
    chefe = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'chefe_divisao'),
    );
  }, 60_000);

  afterAll(async () => {
    await ctx?.db.query(
      `UPDATE municipios SET hora_recolha = '03:00' WHERE id = $1`,
      [MUNICIPIO_ID],
    );
    await ctx?.fechar();
    await new Promise((r) => servidor?.close(r));
  });

  /** Fonte nova, sem leitura automática (o teste decide quando se lê). */
  async function novaFonte(caminho: string, extra: object = {}) {
    const r = await ctx
      .http()
      .post('/v1/painel/conhecimento/fontes')
      .set(chefe)
      .send({
        entidade_id: entidade,
        titulo: `Fonte ${caminho}`,
        tipo: 'pagina',
        url: `${base}${caminho}`,
        leitura_automatica: false,
        ...extra,
      })
      .expect(201);
    return r.body.id as string;
  }

  const ler = (fonte_id: string, forcar = true) =>
    ingestao.correr({ municipio_id: MUNICIPIO_ID, fonte_id, forcar });

  const fonte = (id: string) =>
    linha(
      ctx.db,
      `SELECT estado, erro, falhas_seguidas, proxima_leitura_em, etag, titulo,
              to_char(proxima_leitura_em AT TIME ZONE 'Europe/Lisbon', 'HH24:MI') AS hora
       FROM fontes WHERE id = $1`,
      [id],
    );

  it('a hora de recolha decide a próxima leitura; cada leitura fica no histórico', async () => {
    await ctx
      .http()
      .put('/v1/painel/conhecimento/recolha')
      .set(chefe)
      .send({ hora_recolha: '05:30' })
      .expect(200)
      .expect((r) => expect(r.body.hora_recolha).toBe('05:30'));

    paginas['/taxas'] = {
      tipo: 'text/html; charset=utf-8',
      corpo: html(
        'Taxas',
        'A licença de obras custa 10 euros por metro quadrado de construção, a pagar no balcão único ou por referência multibanco.',
      ),
    };
    const id = await novaFonte('/taxas');
    await ler(id);

    const f = await fonte(id);
    expect(f).toMatchObject({
      estado: 'em_dia',
      falhas_seguidas: 0,
      hora: '05:30',
    });
    expect(new Date(f.proxima_leitura_em).getTime()).toBeGreaterThan(
      Date.now(),
    );

    const h = await ctx
      .http()
      .get(`/v1/painel/conhecimento/fontes/${id}/leituras`)
      .set(chefe)
      .expect(200);
    expect(h.body).toHaveLength(1);
    expect(h.body[0]).toMatchObject({ resultado: 'mudou', http_estado: 200 });

    // Mudar a periodicidade para 6 h: a próxima conta da última leitura, não da hora.
    await ctx
      .http()
      .patch(`/v1/painel/conhecimento/fontes/${id}`)
      .set(chefe)
      .send({ ler_a_cada_horas: 6 })
      .expect(200);
    const f6 = await linha(
      ctx.db,
      `SELECT round(extract(epoch FROM proxima_leitura_em - ultima_leitura_em) / 3600) AS h
       FROM fontes WHERE id = $1`,
      [id],
    );
    expect(Number(f6.h)).toBe(6);
  });

  it('ETag: na leitura seguinte manda If-None-Match e o 304 não cria versão', async () => {
    paginas['/horario'] = {
      tipo: 'text/html',
      corpo: html(
        'Horário',
        'O balcão único está aberto das 9h às 16h nos dias úteis, sem marcação.',
      ),
      etag: '"h1"',
    };
    const id = await novaFonte('/horario');
    await ler(id);
    expect((await fonte(id)).etag).toBe('"h1"');

    // Vencida e automática: lê sem forçar, com o pedido condicional.
    await ctx.db.query(
      `UPDATE fontes SET leitura_automatica = true, proxima_leitura_em = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );
    await ler(id, false);
    expect(pedidos.filter((p) => p.url === '/horario').pop()?.inm).toBe('"h1"');
    const [ultima] = await linhas(
      ctx.db,
      `SELECT resultado, http_estado FROM fonte_leituras WHERE fonte_id = $1 ORDER BY iniciada_em DESC`,
      [id],
    );
    expect(ultima).toEqual({ resultado: 'nao_modificado', http_estado: 304 });
    const versoes = await linha(
      ctx.db,
      `SELECT count(*)::int AS n FROM fonte_versoes WHERE fonte_id = $1`,
      [id],
    );
    expect(versoes.n).toBe(1);
    await ctx.db.query(
      `UPDATE fontes SET leitura_automatica = false WHERE id = $1`,
      [id],
    );
  });

  it('seletor: só a parte escolhida; se deixar de existir, a fonte fica em erro', async () => {
    paginas['/regulamento'] = {
      tipo: 'text/html',
      corpo: `<html><body><main><div class="lateral">Notícias do dia e agenda cultural do concelho.</div>
        <div id="texto">Artigo 1.º O presente regulamento fixa as regras da ocupação do espaço público, incluindo esplanadas, toldos e publicidade.</div>
        </main></body></html>`,
    };
    const id = await novaFonte('/regulamento');
    await ctx
      .http()
      .patch(`/v1/painel/conhecimento/fontes/${id}`)
      .set(chefe)
      .send({ seletor: '#texto' })
      .expect(200);
    await ler(id);
    const v = await linha(
      ctx.db,
      `SELECT texto FROM fonte_versoes WHERE fonte_id = $1`,
      [id],
    );
    expect(v.texto).toContain('ocupação do espaço público');
    expect(v.texto).not.toContain('agenda cultural');

    await ctx
      .http()
      .patch(`/v1/painel/conhecimento/fontes/${id}`)
      .set(chefe)
      .send({ seletor: '#ja-nao-existe' })
      .expect(200);
    await ler(id);
    const f = await fonte(id);
    expect(f.estado).toBe('erro');
    expect(f.erro).toMatch(/seletor "#ja-nao-existe"/);
    expect(f.falhas_seguidas).toBe(1);
    const [ultima] = await linhas(
      ctx.db,
      `SELECT codigo_erro FROM fonte_leituras WHERE fonte_id = $1 ORDER BY iniciada_em DESC`,
      [id],
    );
    expect(ultima.codigo_erro).toBe('seletor');
  });

  it('robots.txt: não lê o que o site não deixa, até a câmara autorizar', async () => {
    paginas['/privado/actas'] = {
      tipo: 'text/html',
      corpo: html(
        'Actas',
        'Acta da reunião de câmara de 12 de outubro, com as deliberações aprovadas.',
      ),
    };
    const id = await novaFonte('/privado/actas');
    await ler(id);
    expect((await fonte(id)).erro).toMatch(/robots\.txt/);
    expect(pedidos.some((p) => p.url === '/privado/actas')).toBe(false);

    await ctx
      .http()
      .patch(`/v1/painel/conhecimento/fontes/${id}`)
      .set(chefe)
      .send({ ignorar_robots: true })
      .expect(200);
    await ler(id);
    expect(await fonte(id)).toMatchObject({
      estado: 'em_dia',
      falhas_seguidas: 0,
    });
  });

  it('PDF com texto lê-se sozinho (sem colar)', async () => {
    paginas['/tabela.pdf'] = {
      tipo: 'application/pdf',
      corpo: await pdf(
        'Tabela de taxas municipais. A emissao do alvara de licenca de obras custa 25 euros.',
      ),
    };
    const id = await novaFonte('/tabela.pdf');
    await ler(id);
    expect((await fonte(id)).estado).toBe('em_dia');
    const v = await linha(
      ctx.db,
      `SELECT texto FROM fonte_versoes WHERE fonte_id = $1`,
      [id],
    );
    expect(v.texto).toContain('alvara de licenca de obras custa 25 euros');
  });

  it('arquivar: sai da lista e deixa de vencer', async () => {
    paginas['/antiga'] = {
      tipo: 'text/html',
      corpo: html(
        'Antiga',
        'Página antiga do município, que deixou de ser atualizada há anos.',
      ),
    };
    const id = await novaFonte('/antiga', { leitura_automatica: true });
    await ctx
      .http()
      .patch(`/v1/painel/conhecimento/fontes/${id}`)
      .set(chefe)
      .send({ arquivada: true })
      .expect(200);
    const lista = await ctx
      .http()
      .get('/v1/painel/conhecimento/fontes')
      .set(chefe)
      .expect(200);
    expect(lista.body.itens.some((f: { id: string }) => f.id === id)).toBe(
      false,
    );
    const arq = await ctx
      .http()
      .get('/v1/painel/conhecimento/fontes?arquivadas=true')
      .set(chefe)
      .expect(200);
    expect(arq.body.itens.map((f: { id: string }) => f.id)).toContain(id);

    await ctx.db.query(
      `UPDATE fontes SET proxima_leitura_em = now() - interval '1 day' WHERE id = $1`,
      [id],
    );
    const vencidas = await linhas(
      ctx.db,
      `SELECT id FROM fontes fo WHERE fo.id = $1 AND fo.leitura_automatica AND fo.arquivada_em IS NULL
         AND coalesce(fo.proxima_leitura_em, '-infinity') <= now()`,
      [id],
    );
    expect(vencidas).toHaveLength(0);
  });

  it('site com sitemap: as páginas dentro do prefixo viram fontes, com o título da página na 1.ª leitura', async () => {
    paginas['/sitemap.xml'] = {
      tipo: 'application/xml',
      corpo: `<sitemapindex><sitemap><loc>${base}/sitemap-servicos.xml</loc></sitemap></sitemapindex>`,
    };
    paginas['/sitemap-servicos.xml'] = {
      tipo: 'application/xml',
      corpo: `<urlset>
        <url><loc>${base}/servicos/agua</loc></url>
        <url><loc>${base}/servicos/residuos</loc></url>
        <url><loc>${base}/noticias/festa</loc></url>
        <url><loc>${base}/servicos/logo.png</loc></url>
      </urlset>`,
    };
    paginas['/servicos/agua'] = {
      tipo: 'text/html',
      corpo: html(
        'Água e saneamento',
        'Para pedir uma ligação de água preencha o requerimento no balcão único.',
      ),
    };

    const r = await ctx
      .http()
      .post('/v1/painel/conhecimento/sites')
      .set(chefe)
      .send({
        entidade_id: entidade,
        titulo: 'Serviços (e2e)',
        url_inicial: `${base}/servicos/`,
      })
      .expect(201);
    const siteId = r.body.id as string;
    expect(await descoberta.descobrir(siteId)).toMatchObject({
      encontradas: 2,
    });

    const fontes = await linhas(
      ctx.db,
      `SELECT id, url, titulo, titulo_automatico FROM fontes WHERE site_id = $1 ORDER BY url`,
      [siteId],
    );
    expect(fontes.map((f) => f.url)).toEqual([
      `${base}/servicos/agua`,
      `${base}/servicos/residuos`,
    ]);
    expect(fontes[0]).toMatchObject({
      titulo: 'Agua',
      titulo_automatico: true,
    });

    await ler(fontes[0].id);
    expect((await fonte(fontes[0].id)).titulo).toBe('Água e saneamento');

    const sites = await ctx
      .http()
      .get('/v1/painel/conhecimento/sites')
      .set(chefe)
      .expect(200);
    expect(
      sites.body.find((s: { id: string }) => s.id === siteId),
    ).toMatchObject({
      paginas_encontradas: 2,
      fontes: 2,
      erro: null,
    });
  });

  it('site sem sitemap no prefixo: segue os links até à profundidade', async () => {
    paginas['/guia/'] = {
      tipo: 'text/html',
      corpo: html('Guia', 'Guia do munícipe.', [
        '/guia/a',
        '/guia/b',
        '/outra/c',
      ]),
    };
    paginas['/guia/a'] = {
      tipo: 'text/html',
      corpo: html('A', 'Página A.', ['/guia/a/funda']),
    };
    paginas['/guia/b'] = { tipo: 'text/html', corpo: html('B', 'Página B.') };
    paginas['/guia/a/funda'] = {
      tipo: 'text/html',
      corpo: html('Funda', 'Funda.', ['/guia/a/funda/demais']),
    };

    const r = await ctx
      .http()
      .post('/v1/painel/conhecimento/sites')
      .set(chefe)
      .send({
        entidade_id: entidade,
        titulo: 'Guia (e2e)',
        url_inicial: `${base}/guia/`,
        profundidade: 2,
      })
      .expect(201);
    await descoberta.descobrir(r.body.id);
    const urls = (
      await linhas(
        ctx.db,
        `SELECT url FROM fontes WHERE site_id = $1 ORDER BY url`,
        [r.body.id],
      )
    ).map((f) => f.url.replace(base, ''));
    expect(urls).toEqual(['/guia/', '/guia/a', '/guia/a/funda', '/guia/b']);
  });
});
