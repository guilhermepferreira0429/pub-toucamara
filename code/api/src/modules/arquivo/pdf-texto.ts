import { inflateSync, constants as zlib } from 'zlib';

/*
 * A camada de texto de um PDF, sem bibliotecas: os PDFs feitos por
 * computador (e os digitalizados que já passaram por OCR no scanner) trazem
 * o texto nos "content streams" das páginas. Lê-se o suficiente para
 * pesquisar: operadores de texto (Tj, TJ, ', "), as fontes com ToUnicode e
 * os streams comprimidos (FlateDecode, incluindo object streams).
 *
 * Um PDF só com imagens (digitalização "crua") devolve texto vazio ou quase:
 * `temCamadaTexto` decide se vale a pena ou se segue para OCR.
 */

interface Objeto {
  dic: string;
  stream: Buffer | null;
}

/** Mínimo de letras para considerar que há camada de texto. */
export const MIN_LETRAS = 40;

/** Se o texto extraído chega para pesquisar (senão: OCR ou por transcrever). */
export function temCamadaTexto(texto: string): boolean {
  return (texto.match(/\p{L}/gu)?.length ?? 0) >= MIN_LETRAS;
}

/** WinAnsi (cp1252) entre 0x80 e 0x9F; o resto é igual ao latin1. */
const CP1252: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ',
};

function winAnsi(bytes: number[]): string {
  return bytes
    .map(
      (b) =>
        CP1252[b] ?? (b >= 0x20 || b === 0x0a ? String.fromCharCode(b) : ' '),
    )
    .join('');
}

function inflar(b: Buffer): Buffer | null {
  try {
    return inflateSync(b);
  } catch {
    try {
      // Streams com lixo no fim (comum em scanners): lê o que der.
      return inflateSync(b, { finishFlush: zlib.Z_SYNC_FLUSH });
    } catch {
      return null;
    }
  }
}

/** Conteúdo de um stream, já descomprimido (null se não se sabe ler). */
function descomprimir(dic: string, bruto: Buffer): Buffer | null {
  const filtro = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dic)?.[1] ?? '';
  if (!filtro) return bruto;
  const filtros = filtro.match(/\/\w+/g) ?? [];
  let b: Buffer | null = bruto;
  for (const f of filtros) {
    if (!b) return null;
    if (f === '/FlateDecode' || f === '/Fl') b = inflar(b);
    else return null; // DCT (JPEG), CCITT, JBIG2...: imagens, não texto
  }
  return b;
}

/** Os objetos `n 0 obj ... endobj`, incluindo os de object streams. */
function lerObjetos(pdf: Buffer): Map<number, Objeto> {
  const s = pdf.toString('latin1');
  const objetos = new Map<number, Objeto>();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const inicio = m.index + m[0].length;
    const fim = s.indexOf('endobj', inicio);
    if (fim < 0) break;
    const corpo = s.slice(inicio, fim);
    const pos = /\bstream\r?\n/.exec(corpo);
    let dic = corpo;
    let stream: Buffer | null = null;
    if (pos) {
      dic = corpo.slice(0, pos.index);
      const ini = pos.index + pos[0].length;
      let fimStream = corpo.lastIndexOf('endstream');
      if (fimStream < ini) fimStream = corpo.length;
      const comprimento = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dic);
      const n = comprimento ? Number(comprimento[1]) : NaN;
      const bruto =
        Number.isFinite(n) && ini + n <= fimStream
          ? corpo.slice(ini, ini + n)
          : corpo.slice(ini, fimStream).replace(/\r?\n$/, '');
      stream = descomprimir(dic, Buffer.from(bruto, 'latin1'));
    }
    objetos.set(num, { dic, stream });
    re.lastIndex = fim;
  }
  // Object streams (PDF 1.5+): os dicionários das fontes costumam estar aqui.
  for (const o of [...objetos.values()]) {
    if (!/\/Type\s*\/ObjStm/.test(o.dic) || !o.stream) continue;
    const n = Number(/\/N\s+(\d+)/.exec(o.dic)?.[1] ?? 0);
    const primeiro = Number(/\/First\s+(\d+)/.exec(o.dic)?.[1] ?? 0);
    const txt = o.stream.toString('latin1');
    const cabeca = txt.slice(0, primeiro).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const num = cabeca[i * 2];
      const desde = primeiro + cabeca[i * 2 + 1];
      const ate = i + 1 < n ? primeiro + cabeca[(i + 1) * 2 + 1] : txt.length;
      if (!objetos.has(num)) {
        objetos.set(num, { dic: txt.slice(desde, ate), stream: null });
      }
    }
  }
  return objetos;
}

// ---------------------------------------------------------------------------
// ToUnicode
// ---------------------------------------------------------------------------

interface CMap {
  bytes: number;
  mapa: Map<number, string>;
}

function utf16(hex: string): string {
  const cps: number[] = [];
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    cps.push(parseInt(hex.slice(i, i + 4), 16));
  }
  return String.fromCharCode(...cps);
}

export function lerCMap(txt: string): CMap {
  const mapa = new Map<number, string>();
  const espaco = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(txt);
  const bytes = espaco ? Math.max(1, espaco[1].length / 2) : 2;
  for (const bloco of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of bloco[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      mapa.set(parseInt(p[1], 16), utf16(p[2]));
    }
  }
  for (const bloco of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const re =
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([^\]]*)\])/g;
    for (const p of bloco[1].matchAll(re)) {
      const de = parseInt(p[1], 16);
      const ate = parseInt(p[2], 16);
      if (ate - de > 65535) continue;
      if (p[3] !== undefined) {
        const base = p[3];
        const ultimo = parseInt(base.slice(-4), 16);
        for (let c = de; c <= ate; c++) {
          mapa.set(
            c,
            utf16(
              base.slice(0, -4) +
                (ultimo + c - de).toString(16).padStart(4, '0'),
            ),
          );
        }
      } else {
        const lista = [...(p[4] ?? '').matchAll(/<([0-9a-fA-F]*)>/g)];
        lista.forEach((l, i) => mapa.set(de + i, utf16(l[1])));
      }
    }
  }
  return { bytes, mapa };
}

/** Nome da fonte (/F1) → CMap, a partir dos /Resources de todos os objetos. */
function fontes(objetos: Map<number, Objeto>): Map<string, CMap | null> {
  const cmapDoObjeto = new Map<number, CMap | null>();
  const cmapDe = (num: number): CMap | null => {
    if (cmapDoObjeto.has(num)) return cmapDoObjeto.get(num)!;
    const f = objetos.get(num);
    const ref = f && /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(f.dic);
    const cm = ref ? objetos.get(Number(ref[1]))?.stream : null;
    const r = cm ? lerCMap(cm.toString('latin1')) : null;
    cmapDoObjeto.set(num, r);
    return r;
  };
  const porNome = new Map<string, CMap | null>();
  const juntar = (dic: string) => {
    for (const p of dic.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
      const obj = objetos.get(Number(p[2]));
      if (
        !obj ||
        !/\/Type\s*\/Font|\/Subtype\s*\/(Type[0-3]|TrueType)/.test(obj.dic)
      )
        continue;
      // O primeiro que aparece ganha (nomes repetidos entre páginas são raros).
      if (!porNome.has(p[1]) || porNome.get(p[1]) === null) {
        porNome.set(p[1], cmapDe(Number(p[2])));
      }
    }
  };
  for (const o of objetos.values()) {
    const direto = /\/Font\s*<<([\s\S]*?)>>/.exec(o.dic);
    if (direto) juntar(direto[1]);
    const indireto = /\/Font\s+(\d+)\s+\d+\s+R/.exec(o.dic);
    if (indireto) juntar(objetos.get(Number(indireto[1]))?.dic ?? '');
  }
  return porNome;
}

// ---------------------------------------------------------------------------
// Content streams
// ---------------------------------------------------------------------------

type Token =
  | { t: 'str'; bytes: number[] }
  | { t: 'num'; v: number }
  | { t: 'nome'; v: string }
  | { t: 'arr'; v: Token[] }
  | { t: 'op'; v: string };

function lerLiteral(s: string, i: number): [number[], number] {
  const bytes: number[] = [];
  let nivel = 1;
  i++;
  while (i < s.length && nivel > 0) {
    const c = s.charCodeAt(i);
    if (c === 0x5c) {
      const n = s[i + 1];
      const esc: Record<string, number> = {
        n: 10,
        r: 13,
        t: 9,
        b: 8,
        f: 12,
        '(': 40,
        ')': 41,
        '\\': 92,
      };
      if (n in esc) {
        bytes.push(esc[n]);
        i += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1, i + 4))![0];
        bytes.push(parseInt(oct, 8) & 0xff);
        i += 1 + oct.length;
      } else if (n === '\r' || n === '\n') {
        i += n === '\r' && s[i + 2] === '\n' ? 3 : 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (c === 0x28) nivel++;
    if (c === 0x29) {
      nivel--;
      if (nivel === 0) {
        i++;
        break;
      }
    }
    bytes.push(c);
    i++;
  }
  return [bytes, i];
}

function tokens(s: string): Token[] {
  const fora: Token[] = [];
  const pilha: Token[][] = [];
  const atual = () => pilha[pilha.length - 1] ?? fora;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '%') {
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    } else if (c === '(') {
      const [bytes, j] = lerLiteral(s, i);
      atual().push({ t: 'str', bytes });
      i = j;
    } else if (c === '<' && s[i + 1] === '<') {
      // Dicionário inline (BDC, imagens inline): salta até >>.
      const fim = s.indexOf('>>', i + 2);
      i = fim < 0 ? s.length : fim + 2;
    } else if (c === '<') {
      const fim = s.indexOf('>', i);
      const hex = s.slice(i + 1, fim < 0 ? s.length : fim).replace(/\s/g, '');
      const par = hex.length % 2 ? `${hex}0` : hex;
      const bytes: number[] = [];
      for (let k = 0; k < par.length; k += 2) {
        bytes.push(parseInt(par.slice(k, k + 2), 16));
      }
      atual().push({ t: 'str', bytes });
      i = fim < 0 ? s.length : fim + 1;
    } else if (c === '[') {
      pilha.push([]);
      i++;
    } else if (c === ']') {
      const arr = pilha.pop() ?? [];
      atual().push({ t: 'arr', v: arr });
      i++;
    } else if (c === '/') {
      const m = /^\/[^\s/<>[\]()%{}]*/.exec(s.slice(i, i + 128))![0];
      atual().push({ t: 'nome', v: m.slice(1) });
      i += m.length;
    } else if (/[-+.\d]/.test(c)) {
      const m = /^[-+]?(\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 32));
      if (m) {
        atual().push({ t: 'num', v: Number(m[0]) });
        i += m[0].length;
      } else {
        i++;
      }
    } else {
      const m = /^[^\s/<>[\]()%{}]+/.exec(s.slice(i, i + 32));
      const op = m ? m[0] : c;
      i += op.length;
      if (op === 'ID') {
        // Imagem inline: dados binários até EI.
        const fim = s.indexOf('EI', i);
        i = fim < 0 ? s.length : fim + 2;
        continue;
      }
      atual().push({ t: 'op', v: op });
    }
  }
  return fora;
}

function descodificar(bytes: number[], cmap: CMap | null): string {
  if (!cmap) return winAnsi(bytes);
  let fora = '';
  for (let i = 0; i < bytes.length; i += cmap.bytes) {
    let codigo = 0;
    for (let k = 0; k < cmap.bytes; k++)
      codigo = codigo * 256 + (bytes[i + k] ?? 0);
    fora +=
      cmap.mapa.get(codigo) ?? (cmap.bytes === 1 ? winAnsi([codigo]) : '');
  }
  return fora;
}

/** O texto de um content stream, com uma linha por linha do PDF. */
export function textoDoConteudo(
  conteudo: string,
  porNome: Map<string, CMap | null> = new Map(),
): string {
  let fonte: CMap | null = null;
  let y: number | null = null;
  let texto = '';
  const linha = () => {
    if (texto && !texto.endsWith('\n')) texto += '\n';
  };
  const espaco = () => {
    if (texto && !/[\s]$/.test(texto)) texto += ' ';
  };
  const args: Token[] = [];
  for (const tk of tokens(conteudo)) {
    if (tk.t !== 'op') {
      args.push(tk);
      continue;
    }
    const op = tk.v;
    const num = (i: number) => {
      const a = args[args.length - i];
      return a && a.t === 'num' ? a.v : 0;
    };
    switch (op) {
      case 'Tf': {
        const nome = args.find((a) => a.t === 'nome');
        fonte =
          nome && nome.t === 'nome' ? (porNome.get(nome.v) ?? null) : null;
        break;
      }
      case 'Tm': {
        const ny = num(1);
        if (y !== null && Math.abs(ny - y) > 0.5) linha();
        else espaco();
        y = ny;
        break;
      }
      case 'Td':
      case 'TD': {
        const dy = num(1);
        if (Math.abs(dy) > 0.5) linha();
        else if (num(2) > 0) espaco();
        if (y !== null) y += dy;
        break;
      }
      case 'T*':
        linha();
        break;
      case 'Tj':
      case "'":
      case '"': {
        if (op !== 'Tj') linha();
        const s = [...args].reverse().find((a) => a.t === 'str');
        if (s && s.t === 'str') texto += descodificar(s.bytes, fonte);
        break;
      }
      case 'TJ': {
        const arr = args.find((a) => a.t === 'arr');
        if (arr && arr.t === 'arr') {
          for (const el of arr.v) {
            if (el.t === 'str') texto += descodificar(el.bytes, fonte);
            else if (el.t === 'num' && el.v < -250) espaco();
          }
        }
        break;
      }
      case 'ET':
        break;
      default:
        break;
    }
    args.length = 0;
  }
  return texto;
}

/** As páginas pela ordem da árvore de páginas (ou pela ordem dos objetos). */
function conteudosDasPaginas(objetos: Map<number, Objeto>): Buffer[] {
  const paginas: number[] = [];
  const visitar = (num: number, profundidade = 0) => {
    const o = objetos.get(num);
    if (!o || profundidade > 50) return;
    if (/\/Type\s*\/Pages\b/.test(o.dic)) {
      const kids = /\/Kids\s*\[([^\]]*)\]/.exec(o.dic)?.[1] ?? '';
      for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) {
        visitar(Number(k[1]), profundidade + 1);
      }
    } else if (/\/Type\s*\/Page\b/.test(o.dic)) {
      paginas.push(num);
    }
  };
  const raiz = [...objetos.entries()].find(([, o]) =>
    /\/Type\s*\/Catalog/.test(o.dic),
  );
  const pagesRef = raiz && /\/Pages\s+(\d+)\s+\d+\s+R/.exec(raiz[1].dic);
  if (pagesRef) visitar(Number(pagesRef[1]));
  if (!paginas.length) {
    for (const [num, o] of objetos) {
      if (/\/Type\s*\/Page\b/.test(o.dic)) paginas.push(num);
    }
  }
  const fora: Buffer[] = [];
  for (const p of paginas) {
    const dic = objetos.get(p)!.dic;
    const c = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(dic)?.[1] ?? '';
    for (const r of c.matchAll(/(\d+)\s+\d+\s+R/g)) {
      const s = objetos.get(Number(r[1]))?.stream;
      if (s) fora.push(s);
    }
  }
  return fora;
}

export interface TextoPdf {
  texto: string;
  paginas: number;
}

/**
 * O texto de um PDF, página a página (separadas por uma linha em branco).
 * Nunca lança: um PDF que não se percebe dá texto vazio.
 */
export function textoDoPdf(pdf: Buffer): TextoPdf {
  try {
    const objetos = lerObjetos(pdf);
    const porNome = fontes(objetos);
    const conteudos = conteudosDasPaginas(objetos);
    const paginas = conteudos.map((c) =>
      textoDoConteudo(c.toString('latin1'), porNome)
        .split('\n')
        .map((l) => l.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n'),
    );
    const nPaginas = [...objetos.values()].filter((o) =>
      /\/Type\s*\/Page\b/.test(o.dic),
    ).length;
    return {
      texto: paginas.filter(Boolean).join('\n\n'),
      paginas: nPaginas || paginas.length,
    };
  } catch {
    return { texto: '', paginas: 0 };
  }
}
