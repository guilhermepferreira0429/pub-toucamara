import { createHash } from 'crypto';

/*
 * Funções puras da ingestão (secção 6.2): HTML → texto limpo, partir em
 * trechos citáveis e diferença por linhas entre duas versões. Sem BD nem
 * rede, para se testarem sozinhas.
 */

// ---------------------------------------------------------------------------
// HTML → texto
// ---------------------------------------------------------------------------

/** Blocos que nunca são conteúdo: saem com tudo o que têm dentro. */
const LIXO = [
  'script',
  'style',
  'noscript',
  'svg',
  'nav',
  'header',
  'footer',
  'form',
  'iframe',
  'template',
  'aside',
  'button',
  'select',
];

/** Fecho destas etiquetas = fim de linha. */
const BLOCOS =
  'p|div|section|article|main|ul|ol|table|thead|tbody|tfoot|blockquote|pre|dl|dt|dd|figure|figcaption|address|caption';

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  euro: '€',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  sect: '§',
  copy: '©',
  shy: '',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  atilde: 'ã',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  iacute: 'í',
  oacute: 'ó',
  ocirc: 'ô',
  otilde: 'õ',
  uacute: 'ú',
  uuml: 'ü',
  ccedil: 'ç',
  Aacute: 'Á',
  Agrave: 'À',
  Acirc: 'Â',
  Atilde: 'Ã',
  Eacute: 'É',
  Ecirc: 'Ê',
  Iacute: 'Í',
  Oacute: 'Ó',
  Ocirc: 'Ô',
  Otilde: 'Õ',
  Uacute: 'Ú',
  Ccedil: 'Ç',
};

export function descodificarEntidades(s: string): string {
  return s.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (todo: string, e: string) => {
      if (e[0] === '#') {
        const n =
          e[1] === 'x' || e[1] === 'X'
            ? parseInt(e.slice(2), 16)
            : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000
          ? String.fromCodePoint(n)
          : todo;
      }
      return ENTIDADES[e] ?? todo;
    },
  );
}

/**
 * Texto limpo de uma página: tira scripts, estilos, navegação, cabeçalho e
 * rodapé; se houver `<main>` (ou um só `<article>`) usa só esse. Títulos
 * h1–h4 ficam numa linha própria começada por `## ` (o partidor usa-os como
 * secções), itens de lista com `- ` e células de tabela separadas por ` · `.
 */
export function htmlParaTexto(html: string): string {
  let h = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const t of LIXO) {
    h = h.replace(new RegExp(`<${t}\\b[\\s\\S]*?</${t}\\s*>`, 'gi'), ' ');
  }
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(h);
  const artigos = h.match(/<article\b[^>]*>[\s\S]*?<\/article\s*>/gi);
  if (main) h = main[1];
  else if (artigos?.length === 1) h = artigos[0];
  else {
    const body = /<body\b[^>]*>([\s\S]*?)(<\/body\s*>|$)/i.exec(h);
    if (body) h = body[1];
  }

  h = h
    .replace(/<h[1-4]\b[^>]*>/gi, '\n## ')
    .replace(/<\/h[1-6]\s*>/gi, '\n')
    .replace(/<h[56]\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' · ')
    .replace(new RegExp(`</(${BLOCOS})\\s*>`, 'gi'), '\n')
    .replace(new RegExp(`<(${BLOCOS})\\b[^>]*>`, 'gi'), '\n')
    .replace(/<[^>]+>/g, '');

  return normalizarTexto(descodificarEntidades(h));
}

const NBSP = String.fromCharCode(0xa0);

/**
 * Espaços e linhas: tira espaços repetidos, separadores soltos no fim das
 * linhas de tabela e deixa no máximo uma linha em branco seguida.
 */
export function normalizarTexto(s: string): string {
  const linhas = s
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]/g, ' ')
    .replaceAll(NBSP, ' ')
    .split('\n')
    .map((l) =>
      l
        .replace(/ {2,}/g, ' ')
        .replace(/(\s·)+\s*$/, '')
        .replace(/^\s*·\s*/, '')
        .trim(),
    )
    .filter((l) => l !== '##' && l !== '-');
  const fora: string[] = [];
  for (const l of linhas) {
    if (l === '' && (fora.length === 0 || fora[fora.length - 1] === ''))
      continue;
    fora.push(l);
  }
  while (fora.length && fora[fora.length - 1] === '') fora.pop();
  return fora.join('\n');
}

/**
 * Bytes descarregados → texto, pelo charset do Content-Type ou do `<meta>`
 * (muitos sites municipais ainda servem ISO-8859-1). Por defeito UTF-8.
 */
export function descodificarBytes(bytes: Uint8Array, contentType = ''): string {
  let charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (!charset) {
    const inicio = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
    charset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(inicio)?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/** É um PDF? Pelo tipo, pelo fim do URL ou pelos primeiros bytes (%PDF). */
export function ePdf(bytes: Uint8Array, contentType = '', url = ''): boolean {
  return (
    /application\/pdf/i.test(contentType) ||
    /\.pdf(\?|#|$)/i.test(url) ||
    Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-'
  );
}

/** sha256 em hex. O hash da fonte é do texto limpo, não do HTML. */
export function hashTexto(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

// ---------------------------------------------------------------------------
// Partir em trechos
// ---------------------------------------------------------------------------

export interface TrechoPartido {
  ordem: number;
  /** 'art. 6.º', 'art. 6.º, n.º 2' ou o título da secção. */
  referencia: string | null;
  texto: string;
}

export interface OpcoesPartir {
  /** Tamanho alvo de cada trecho, em caracteres (por defeito 800). */
  alvo?: number;
  /** Acima disto parte-se sempre (por defeito 1,5 × alvo). */
  maximo?: number;
  /** Sobreposição entre trechos seguidos da mesma secção (por defeito 120). */
  sobreposicao?: number;
}

// "Artigo 6.º", "ARTIGO 12.º-A", "Art. 3º", "Artigo 7.°"
const ARTIGO =
  /^(?:artigo|art\.)\s*(\d+)\s*\.?\s*[ºo°]?(?:\s*-\s*([A-Z]))?(?=$|[\s.:–—-])/i;
// "1 - ", "2 — ", "3. " no início de um parágrafo de artigo
const NUMERO = /^(\d+)\s*(?:[-–—]|\.(?!\d))\s+/;

interface Seccao {
  referencia: string | null;
  paragrafos: string[];
}

/**
 * Parte o texto limpo em trechos para citar. Com dois ou mais cabeçalhos
 * "Artigo N.º" parte-se por artigos (`referencia` = 'art. N.º'; se um artigo
 * for longo, cada pedaço que começa num número leva ', n.º X'). Sem artigos,
 * por títulos (`## `) e parágrafos. Junta parágrafos até ~alvo caracteres e
 * repete o fim do trecho anterior (sobreposição) dentro da mesma secção.
 */
export function partirEmTrechos(
  texto: string,
  opcoes: OpcoesPartir = {},
): TrechoPartido[] {
  const alvo = opcoes.alvo ?? 800;
  const maximo = opcoes.maximo ?? Math.round(alvo * 1.5);
  const sobreposicao = opcoes.sobreposicao ?? 120;

  const linhas = normalizarTexto(texto).split('\n');
  const nArtigos = linhas.filter((l) =>
    ARTIGO.test(l.replace(/^##\s*/, '')),
  ).length;
  const seccoes =
    nArtigos >= 2 ? seccoesPorArtigo(linhas) : seccoesPorTitulo(linhas);

  const fora: TrechoPartido[] = [];
  for (const s of seccoes) {
    const artigo = nArtigos >= 2 && s.referencia?.startsWith('art. ');
    for (const pedaco of juntar(s.paragrafos, alvo, maximo, sobreposicao)) {
      let referencia = s.referencia;
      if (artigo) {
        // O n.º só quando o pedaço começa num número e o artigo foi partido.
        const n = NUMERO.exec(pedaco.inicio);
        if (n && pedaco.partido) referencia = `${s.referencia}, n.º ${n[1]}`;
      }
      fora.push({ ordem: fora.length + 1, referencia, texto: pedaco.texto });
    }
  }
  return fora;
}

function seccoesPorArtigo(linhas: string[]): Seccao[] {
  const seccoes: Seccao[] = [];
  let atual: Seccao = { referencia: null, paragrafos: [] };
  for (const bruta of linhas) {
    const l = bruta.replace(/^##\s*/, '');
    const m = ARTIGO.exec(l);
    if (m) {
      if (atual.paragrafos.length) seccoes.push(atual);
      atual = {
        referencia: `art. ${m[1]}.º${m[2] ? `-${m[2].toUpperCase()}` : ''}`,
        paragrafos: [l],
      };
    } else if (l) {
      atual.paragrafos.push(l);
    }
  }
  if (atual.paragrafos.length) seccoes.push(atual);
  return seccoes;
}

function seccoesPorTitulo(linhas: string[]): Seccao[] {
  const seccoes: Seccao[] = [];
  let atual: Seccao = { referencia: null, paragrafos: [] };
  for (const l of linhas) {
    if (l.startsWith('## ')) {
      if (atual.paragrafos.length) seccoes.push(atual);
      const titulo = l.slice(3).trim();
      atual = {
        referencia: titulo.length > 120 ? `${titulo.slice(0, 117)}…` : titulo,
        paragrafos: [titulo],
      };
    } else if (l) {
      atual.paragrafos.push(l);
    }
  }
  if (atual.paragrafos.length) seccoes.push(atual);
  return seccoes;
}

interface Pedaco {
  texto: string;
  /** O parágrafo em que o pedaço começa (sem a sobreposição). */
  inicio: string;
  /** A secção deu mais de um pedaço. */
  partido: boolean;
}

function juntar(
  paragrafos: string[],
  alvo: number,
  maximo: number,
  sobreposicao: number,
): Pedaco[] {
  // Parágrafos maiores do que o máximo partem-se por frases (e, em último
  // caso, por palavras).
  const partes = paragrafos.flatMap((p) => partirLongo(p, maximo));
  const pedacos: { partes: string[] }[] = [];
  let atual: string[] = [];
  let tamanho = 0;
  for (const p of partes) {
    if (atual.length && tamanho + p.length + 1 > alvo) {
      pedacos.push({ partes: atual });
      atual = [];
      tamanho = 0;
    }
    atual.push(p);
    tamanho += p.length + 1;
  }
  if (atual.length) pedacos.push({ partes: atual });

  const partido = pedacos.length > 1;
  return pedacos.map((pd, i) => {
    const corpo = pd.partes.join('\n');
    const anterior = i > 0 ? pedacos[i - 1].partes.join('\n') : '';
    const cauda = sobreposicao > 0 ? fimDe(anterior, sobreposicao) : '';
    return {
      texto: cauda ? `… ${cauda}\n${corpo}` : corpo,
      inicio: pd.partes[0],
      partido,
    };
  });
}

/** O fim de um texto, a começar numa palavra inteira. */
function fimDe(s: string, n: number): string {
  if (!s || s.length <= n) return s;
  const corte = s.slice(s.length - n);
  const espaco = corte.search(/\s/);
  return (espaco >= 0 ? corte.slice(espaco + 1) : corte).trim();
}

function partirLongo(p: string, maximo: number): string[] {
  if (p.length <= maximo) return [p];
  const frases = p.match(/[^.!?;]+(?:[.!?;]+(?=\s|$)|$)\s*/g) ?? [p];
  const fora: string[] = [];
  let atual = '';
  for (const fr of frases) {
    if (fr.length > maximo) {
      if (atual) fora.push(atual.trim());
      atual = '';
      fora.push(...porPalavras(fr, maximo));
      continue;
    }
    if (atual && atual.length + fr.length > maximo) {
      fora.push(atual.trim());
      atual = '';
    }
    atual += fr;
  }
  if (atual.trim()) fora.push(atual.trim());
  return fora;
}

function porPalavras(s: string, maximo: number): string[] {
  const fora: string[] = [];
  let atual = '';
  for (const w of s.split(/\s+/).filter(Boolean)) {
    if (atual && atual.length + w.length + 1 > maximo) {
      fora.push(atual);
      atual = '';
    }
    atual = atual ? `${atual} ${w}` : w;
  }
  if (atual) fora.push(atual);
  return fora;
}

// ---------------------------------------------------------------------------
// Diferença por linhas
// ---------------------------------------------------------------------------

export interface BlocoDiff {
  /** Linha (1-based) do bloco na versão anterior. */
  linha_antes: number;
  linha_depois: number;
  antes: string[];
  depois: string[];
}

export interface Diff {
  /** Linhas mudadas: num bloco, o maior entre as que saíram e as que entraram. */
  linhas_mudadas: number;
  removidas: number;
  adicionadas: number;
  blocos: BlocoDiff[];
  /** Só os primeiros `maxBlocos` blocos ficam guardados. */
  truncado: boolean;
}

/** Acima disto (linhas × linhas, depois de tirar o início e o fim comuns) não se faz LCS. */
const MAX_CELULAS = 4_000_000;

/**
 * Diferença por linhas (LCS) entre duas versões do texto limpo. Linhas em
 * branco não contam. Para textos enormes cai para uma comparação por
 * conjuntos (o que saiu e o que entrou), sem ordem.
 */
export function diffLinhas(
  antes: string,
  depois: string,
  maxBlocos = 50,
): Diff {
  const a = antes.split('\n').filter((l) => l.trim());
  const b = depois.split('\n').filter((l) => l.trim());

  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fimA = a.length;
  let fimB = b.length;
  while (fimA > ini && fimB > ini && a[fimA - 1] === b[fimB - 1]) {
    fimA--;
    fimB--;
  }
  const ma = a.slice(ini, fimA);
  const mb = b.slice(ini, fimB);

  let blocos: BlocoDiff[];
  if (ma.length * mb.length > MAX_CELULAS) {
    const emB = new Set(mb);
    const emA = new Set(ma);
    const saiu = ma.filter((l) => !emB.has(l));
    const entrou = mb.filter((l) => !emA.has(l));
    blocos =
      saiu.length || entrou.length
        ? [
            {
              linha_antes: ini + 1,
              linha_depois: ini + 1,
              antes: saiu,
              depois: entrou,
            },
          ]
        : [];
  } else {
    blocos = blocosLcs(ma, mb, ini);
  }

  let removidas = 0;
  let adicionadas = 0;
  let linhasMudadas = 0;
  for (const bl of blocos) {
    removidas += bl.antes.length;
    adicionadas += bl.depois.length;
    linhasMudadas += Math.max(bl.antes.length, bl.depois.length);
  }
  return {
    linhas_mudadas: linhasMudadas,
    removidas,
    adicionadas,
    blocos: blocos.slice(0, maxBlocos),
    truncado: blocos.length > maxBlocos,
  };
}

function blocosLcs(a: string[], b: string[], desvio: number): BlocoDiff[] {
  const n = a.length;
  const m = b.length;
  // comp[i][j] = LCS de a[i..] e b[j..], numa tabela linear.
  const comp = new Uint32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      comp[i * w + j] =
        a[i] === b[j]
          ? comp[(i + 1) * w + j + 1] + 1
          : Math.max(comp[(i + 1) * w + j], comp[i * w + j + 1]);
    }
  }
  const blocos: BlocoDiff[] = [];
  let atual: BlocoDiff | null = null;
  let i = 0;
  let j = 0;
  const abrir = () =>
    (atual ??= {
      linha_antes: desvio + i + 1,
      linha_depois: desvio + j + 1,
      antes: [],
      depois: [],
    });
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      if (atual) blocos.push(atual);
      atual = null;
      i++;
      j++;
    } else if (
      j < m &&
      (i >= n || comp[i * w + j + 1] >= comp[(i + 1) * w + j])
    ) {
      abrir().depois.push(b[j++]);
    } else {
      abrir().antes.push(a[i++]);
    }
  }
  if (atual) blocos.push(atual);
  return blocos;
}

/** '1 linha mudou', '14 linhas mudaram', 'Sem diferenças no texto'. */
export function resumoDiff(d: Diff): string {
  if (d.linhas_mudadas === 0) return 'Sem diferenças no texto';
  return d.linhas_mudadas === 1
    ? '1 linha mudou'
    : `${d.linhas_mudadas} linhas mudaram`;
}
