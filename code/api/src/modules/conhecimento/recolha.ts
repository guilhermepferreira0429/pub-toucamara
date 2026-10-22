/*
 * Peças puras da recolha das fontes: robots.txt, sitemaps, links e título de
 * uma página, seletor CSS por fonte e o filtro dos endereços de um site.
 * O que faz pedidos está no DescarregadorService; o que grava, na ingestão e
 * na descoberta.
 */
import * as cheerio from 'cheerio';

/** O nome com que nos apresentamos (User-Agent e grupo do robots.txt). */
export const AGENTE = 'TouCamara';
export const USER_AGENT = `${AGENTE}/1.0 (leitura de fontes oficiais do concelho; +https://toucamara.pt)`;

/** Porque falhou uma leitura: decide se se tenta outra vez e o que se mostra. */
export type CodigoErroFonte =
  | 'robots'
  | 'bloqueado'
  | 'nao_existe'
  | 'http'
  | 'rede'
  | 'grande'
  | 'pdf'
  | 'vazio'
  | 'seletor';

/** Erro de uma fonte: fica em `fontes.erro` (a mensagem é para o painel) e não para as outras. */
export class ErroFonte extends Error {
  constructor(
    mensagem: string,
    readonly codigo: CodigoErroFonte = 'http',
  ) {
    super(mensagem);
  }
}

// --- robots.txt (RFC 9309) ---------------------------------------------------

interface Regra {
  permitir: boolean;
  padrao: string;
}

export interface Robots {
  regras: Regra[];
  /** Crawl-delay em segundos (não é do RFC, mas muitos sites usam). */
  atraso: number | null;
}

/**
 * As regras que se aplicam ao nosso agente: o grupo com o nosso nome, ou,
 * sem ele, o de `*`. Várias linhas User-agent seguidas formam um só grupo.
 */
export function lerRobots(txt: string, agente = AGENTE): Robots {
  const grupos: {
    agentes: string[];
    regras: Regra[];
    atraso: number | null;
  }[] = [];
  let atual: (typeof grupos)[number] | null = null;
  let aLerAgentes = false;
  for (const bruta of txt.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(bruta.replace(/#.*/, ''));
    if (!m) continue;
    const campo = m[1].toLowerCase();
    const valor = m[2];
    if (campo === 'user-agent') {
      if (!atual || !aLerAgentes) {
        atual = { agentes: [], regras: [], atraso: null };
        grupos.push(atual);
      }
      atual.agentes.push(valor.toLowerCase());
      aLerAgentes = true;
      continue;
    }
    if (!atual) continue;
    aLerAgentes = false;
    if ((campo === 'allow' || campo === 'disallow') && valor) {
      atual.regras.push({ permitir: campo === 'allow', padrao: valor });
    } else if (campo === 'crawl-delay') {
      const n = Number(valor);
      if (Number.isFinite(n) && n >= 0) atual.atraso = n;
    }
  }
  const nome = agente.toLowerCase();
  const nossos = grupos.filter((g) =>
    g.agentes.some((a) => a !== '*' && nome.includes(a)),
  );
  const escolhidos = nossos.length
    ? nossos
    : grupos.filter((g) => g.agentes.includes('*'));
  return {
    regras: escolhidos.flatMap((g) => g.regras),
    atraso: escolhidos.map((g) => g.atraso).find((a) => a != null) ?? null,
  };
}

/** A regra mais comprida que corresponde ganha; empatadas, ganha o Allow. */
export function permitido(r: Robots, url: string): boolean {
  const u = new URL(url);
  const caminho = u.pathname + u.search;
  let melhor: Regra | null = null;
  for (const regra of r.regras) {
    if (!corresponde(regra.padrao, caminho)) continue;
    if (
      !melhor ||
      regra.padrao.length > melhor.padrao.length ||
      (regra.padrao.length === melhor.padrao.length && regra.permitir)
    ) {
      melhor = regra;
    }
  }
  return melhor ? melhor.permitir : true;
}

function corresponde(padrao: string, caminho: string): boolean {
  const ancorado = padrao.endsWith('$');
  const corpo = ancorado ? padrao.slice(0, -1) : padrao;
  const re = corpo
    .split('*')
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${re}${ancorado ? '$' : ''}`).test(caminho);
}

// --- Sitemaps ----------------------------------------------------------------

export interface Sitemap {
  paginas: string[];
  /** Um índice de sitemaps aponta para outros sitemaps. */
  sitemaps: string[];
}

export function lerSitemap(xml: string): Sitemap {
  const locs = [
    ...xml.matchAll(
      /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi,
    ),
  ].map((m) => entidades(m[1]));
  return /<sitemapindex\b/i.test(xml)
    ? { paginas: [], sitemaps: locs }
    : { paginas: locs, sitemaps: [] };
}

function entidades(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// --- HTML --------------------------------------------------------------------

/**
 * Só a parte da página escolhida pelo seletor CSS da fonte (todas as
 * correspondências, por ordem). null = o seletor não encontrou nada, que é
 * o sinal de que o site mudou de estrutura.
 */
export function aplicarSeletor(html: string, seletor: string): string | null {
  const $ = cheerio.load(html);
  const partes = $(seletor)
    .toArray()
    .map((el) => $.html(el));
  return partes.length ? partes.join('\n') : null;
}

/** O título e os links absolutos (http/https, sem #) de uma página. */
export function lerPagina(
  html: string,
  base: string,
): { titulo: string | null; links: string[] } {
  const $ = cheerio.load(html);
  const titulo =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    null;
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || /^(mailto|tel|javascript):/i.test(href)) return;
    try {
      const u = new URL(href, base);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      u.hash = '';
      links.add(u.toString());
    } catch {
      // href inválido
    }
  });
  return {
    titulo: titulo ? titulo.replace(/\s+/g, ' ').slice(0, 200) : null,
    links: [...links],
  };
}

/** Um título enquanto a página não é lida: o fim do endereço, legível. */
export function tituloDoEndereco(url: string): string {
  const u = new URL(url);
  const fim = decodeURIComponent(
    u.pathname.replace(/\/+$/, '').split('/').pop() || u.hostname,
  )
    .replace(/\.(html?|php|aspx?|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
  const t = fim.charAt(0).toUpperCase() + fim.slice(1);
  return (t || u.hostname).slice(0, 200);
}

// --- Sites (descoberta) ------------------------------------------------------

export interface FiltroSite {
  url_inicial: string;
  /** Prefixos de caminho a seguir (vazio: a pasta do endereço inicial). */
  incluir: string[];
  excluir: string[];
}

/** Ficheiros que não são texto: nem se seguem, nem viram fonte. */
const NAO_TEXTO =
  /\.(jpe?g|png|gif|webp|svg|ico|bmp|tiff?|mp[34]|m4a|wav|avi|mov|zip|rar|7z|gz|tar|exe|dmg|apk|css|js|json|xml|rss|ics|woff2?|ttf|eot|docx?|xlsx?|pptx?|odt|ods)$/i;

/** O endereço é do site (mesmo domínio e dentro dos prefixos)? Devolve-o normalizado ou null. */
export function dentroDoSite(url: string, f: FiltroSite): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const inicial = new URL(f.url_inicial);
  if (
    u.hostname.replace(/^www\./, '') !== inicial.hostname.replace(/^www\./, '')
  )
    return null;
  if (NAO_TEXTO.test(u.pathname)) return null;
  const pasta = inicial.pathname.replace(/[^/]*$/, '');
  const incluir = f.incluir.length ? f.incluir : [pasta];
  if (!incluir.some((p) => u.pathname.startsWith(p))) return null;
  if (f.excluir.some((p) => u.pathname.startsWith(p))) return null;
  u.hash = '';
  // Parâmetros de rastreio não fazem uma página nova.
  for (const k of [...u.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k);
  }
  return u.toString();
}
