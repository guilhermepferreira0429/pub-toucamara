import {
  aplicarSeletor,
  dentroDoSite,
  lerPagina,
  lerRobots,
  lerSitemap,
  permitido,
  tituloDoEndereco,
} from './recolha.js';

describe('robots.txt', () => {
  const txt = `
# comentário
User-agent: *
Disallow: /privado/
Allow: /privado/publico.html
Disallow: /*.php$
Crawl-delay: 5

User-agent: OutroBot
Disallow: /
`;

  it('aplica o grupo * quando não há um com o nosso nome', () => {
    const r = lerRobots(txt);
    expect(r.atraso).toBe(5);
    expect(permitido(r, 'https://cm.pt/servicos/agua')).toBe(true);
    expect(permitido(r, 'https://cm.pt/privado/actas')).toBe(false);
  });

  it('a regra mais comprida ganha (o Allow dentro de um Disallow)', () => {
    const r = lerRobots(txt);
    expect(permitido(r, 'https://cm.pt/privado/publico.html')).toBe(true);
  });

  it('* e $ nos padrões', () => {
    const r = lerRobots(txt);
    expect(permitido(r, 'https://cm.pt/index.php')).toBe(false);
    expect(permitido(r, 'https://cm.pt/index.php?id=3')).toBe(true);
  });

  it('o grupo com o nosso nome substitui o de *', () => {
    const r = lerRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: TouCamara\nUser-agent: Outro\nDisallow: /admin\n',
    );
    expect(permitido(r, 'https://cm.pt/regulamentos')).toBe(true);
    expect(permitido(r, 'https://cm.pt/admin/x')).toBe(false);
  });

  it('Disallow vazio deixa ler tudo', () => {
    const r = lerRobots('User-agent: *\nDisallow:\n');
    expect(permitido(r, 'https://cm.pt/qualquer')).toBe(true);
  });
});

describe('sitemaps', () => {
  it('lê as páginas (com entidades e CDATA)', () => {
    const s = lerSitemap(`<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://cm.pt/a?x=1&amp;y=2</loc></url>
  <url><loc><![CDATA[ https://cm.pt/b ]]></loc></url>
</urlset>`);
    expect(s).toEqual({
      paginas: ['https://cm.pt/a?x=1&y=2', 'https://cm.pt/b'],
      sitemaps: [],
    });
  });

  it('um índice aponta para outros sitemaps', () => {
    const s = lerSitemap(
      '<sitemapindex><sitemap><loc>https://cm.pt/s1.xml</loc></sitemap></sitemapindex>',
    );
    expect(s).toEqual({ paginas: [], sitemaps: ['https://cm.pt/s1.xml'] });
  });
});

describe('HTML', () => {
  const html = `<html><head><title> Taxas  municipais </title></head><body>
    <nav><a href="/">Início</a></nav>
    <div class="conteudo"><p>Licença: 10 €</p></div>
    <div class="conteudo"><p>Vistoria: 5 €</p></div>
    <a href="regulamento.pdf">PDF</a> <a href="#topo">topo</a>
    <a href="mailto:geral@cm.pt">email</a> <a href="https://outro.pt/x#y">fora</a>
  </body></html>`;

  it('o seletor junta todas as correspondências; null se não houver nenhuma', () => {
    const parte = aplicarSeletor(html, '.conteudo');
    expect(parte).toContain('Licença: 10 €');
    expect(parte).toContain('Vistoria: 5 €');
    expect(parte).not.toContain('Início');
    expect(aplicarSeletor(html, '#nao-existe')).toBeNull();
  });

  it('título e links absolutos, sem âncoras nem mailto', () => {
    const p = lerPagina(html, 'https://cm.pt/servicos/taxas');
    expect(p.titulo).toBe('Taxas municipais');
    expect(p.links).toEqual([
      'https://cm.pt/',
      'https://cm.pt/servicos/regulamento.pdf',
      'https://cm.pt/servicos/taxas',
      'https://outro.pt/x',
    ]);
  });

  it('título a partir do endereço', () => {
    expect(
      tituloDoEndereco('https://cm.pt/servicos/licenca-de-obras.html'),
    ).toBe('Licenca de obras');
    expect(tituloDoEndereco('https://cm.pt/')).toBe('Cm.pt');
  });
});

describe('dentroDoSite', () => {
  const site = {
    url_inicial: 'https://www.cm.pt/servicos/',
    incluir: [],
    excluir: ['/servicos/arquivo/'],
  };

  it('mesmo domínio (com ou sem www) e dentro da pasta inicial', () => {
    expect(dentroDoSite('https://cm.pt/servicos/agua', site)).toBe(
      'https://cm.pt/servicos/agua',
    );
    expect(dentroDoSite('https://www.cm.pt/noticias/x', site)).toBeNull();
    expect(dentroDoSite('https://outro.pt/servicos/agua', site)).toBeNull();
  });

  it('fora: excluídos, imagens e ficheiros que não são texto; PDFs ficam', () => {
    expect(dentroDoSite('https://cm.pt/servicos/arquivo/1', site)).toBeNull();
    expect(dentroDoSite('https://cm.pt/servicos/foto.jpg', site)).toBeNull();
    expect(dentroDoSite('https://cm.pt/servicos/tabela.pdf', site)).toBe(
      'https://cm.pt/servicos/tabela.pdf',
    );
  });

  it('tira #âncoras e parâmetros de rastreio', () => {
    expect(
      dentroDoSite('https://cm.pt/servicos/agua?utm_source=fb&id=2#topo', site),
    ).toBe('https://cm.pt/servicos/agua?id=2');
  });

  it('prefixos explícitos substituem a pasta inicial', () => {
    expect(
      dentroDoSite('https://cm.pt/regulamentos/x', {
        ...site,
        incluir: ['/regulamentos/'],
      }),
    ).toBe('https://cm.pt/regulamentos/x');
  });
});
