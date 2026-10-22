/*
 * Excertos da pesquisa: os bocados do texto onde aparecem as palavras
 * procuradas, com as posições a destacar. Compara sem acentos nem
 * maiúsculas e aceita variações no fim da palavra ("licença" encontra
 * "licenças"; "constru" encontra "construção"). Puro.
 */

export interface Excerto {
  texto: string;
  /** [início, fim) dentro de `texto`, para destacar. */
  destaques: [number, number][];
  /** Se o excerto começa/acaba a meio do texto (para pôr "…"). */
  corta_inicio: boolean;
  corta_fim: boolean;
}

const VAZIAS = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'na',
  'no',
  'nas',
  'nos',
  'um',
  'uma',
  'para',
  'por',
  'com',
  'que',
  'ao',
  'aos',
]);

/** Uma letra de cada vez, sem acento: o comprimento fica igual ao original. */
function dobrar(s: string): string {
  let fora = '';
  for (const c of s) {
    const d = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    // Ligaduras e afins que mudam de tamanho: fica o carácter original.
    fora += d.length === c.length ? d : c.toLowerCase().slice(0, c.length);
  }
  return fora;
}

/** As palavras da pesquisa, sem acentos, sem palavras vazias, sem repetidas. */
export function termosDaPesquisa(q: string): string[] {
  const palavras = dobrar(q)
    .split(/[^\p{L}\p{N}/]+/u)
    .filter((p) => p.length >= 2 && !VAZIAS.has(p));
  return [...new Set(palavras)].slice(0, 10);
}

/** Fins de palavra (plural, género, -ção/-ções) que não contam. */
const SUFIXOS = [
  'coes',
  'cao',
  'soes',
  'sao',
  'oes',
  'aes',
  'ao',
  'ais',
  'eis',
  'as',
  'os',
  'es',
  'a',
  'o',
  'e',
  's',
];

/** Raiz para comparar: "construções" e "construção" dão "constru". */
export function raiz(t: string): string {
  if (/\d/.test(t) || t.length <= 4) return t;
  for (const s of SUFIXOS) {
    if (t.endsWith(s) && t.length - s.length >= 4) return t.slice(0, -s.length);
  }
  return t;
}

interface Ocorrencia {
  inicio: number;
  fim: number;
  termo: number;
}

function ocorrencias(texto: string, termos: string[]): Ocorrencia[] {
  const dobrado = dobrar(texto);
  const fora: Ocorrencia[] = [];
  termos.forEach((t, i) => {
    const r = raiz(t);
    let pos = dobrado.indexOf(r);
    while (pos >= 0) {
      const antes = pos === 0 ? '' : dobrado[pos - 1];
      if (!antes || !/[\p{L}\p{N}]/u.test(antes)) {
        let fim = pos + r.length;
        while (fim < dobrado.length && /[\p{L}\p{N}]/u.test(dobrado[fim]))
          fim++;
        fora.push({ inicio: pos, fim, termo: i });
      }
      pos = dobrado.indexOf(r, pos + r.length);
    }
  });
  return fora.sort((a, b) => a.inicio - b.inicio);
}

/**
 * Até `max` excertos de ~`largura` caracteres, a começar pelas janelas com
 * mais palavras diferentes. Sem ocorrências: o início do texto.
 */
export function excertos(
  texto: string | null,
  q: string,
  opcoes: { max?: number; largura?: number } = {},
): Excerto[] {
  const max = opcoes.max ?? 3;
  const largura = opcoes.largura ?? 180;
  if (!texto) return [];
  const limpo = texto.replace(/\s+/g, ' ').trim();
  const termos = termosDaPesquisa(q);
  const occ = termos.length ? ocorrencias(limpo, termos) : [];
  if (!occ.length) {
    if (!limpo) return [];
    const corte = cortarPalavra(limpo, 0, Math.min(limpo.length, largura));
    return [
      {
        texto: limpo.slice(corte[0], corte[1]),
        destaques: [],
        corta_inicio: false,
        corta_fim: corte[1] < limpo.length,
      },
    ];
  }

  // Uma janela por ocorrência, com os termos que tem lá dentro.
  const janelas = occ.map((o) => {
    const meio = Math.floor((o.inicio + o.fim) / 2);
    let ini = Math.max(0, meio - Math.floor(largura / 2));
    const fim = Math.min(limpo.length, ini + largura);
    ini = Math.max(0, fim - largura);
    const dentro = occ.filter((x) => x.inicio >= ini && x.fim <= fim);
    return {
      ini,
      fim,
      termos: new Set(dentro.map((x) => x.termo)),
      n: dentro.length,
    };
  });

  // Guloso: primeiro as janelas que trazem termos ainda não mostrados.
  const escolhidas: { ini: number; fim: number }[] = [];
  const vistos = new Set<number>();
  while (escolhidas.length < max) {
    let melhor: (typeof janelas)[number] | null = null;
    let melhorPontos = -1;
    for (const j of janelas) {
      if (escolhidas.some((e) => j.ini < e.fim && j.fim > e.ini)) continue;
      const novos = [...j.termos].filter((t) => !vistos.has(t)).length;
      const pontos = novos * 10_000 + j.termos.size * 100 + j.n;
      if (pontos > melhorPontos) {
        melhor = j;
        melhorPontos = pontos;
      }
    }
    if (!melhor) break;
    escolhidas.push(melhor);
    for (const t of melhor.termos) vistos.add(t);
  }
  escolhidas.sort((a, b) => a.ini - b.ini);

  return escolhidas.map(({ ini, fim }) => {
    const [a, b] = cortarPalavra(limpo, ini, fim);
    const destaques = occ
      .filter((o) => o.inicio >= a && o.fim <= b)
      .map((o) => [o.inicio - a, o.fim - a] as [number, number]);
    return {
      texto: limpo.slice(a, b),
      destaques,
      corta_inicio: a > 0,
      corta_fim: b < limpo.length,
    };
  });
}

/** Não cortar palavras a meio: alarga até ao espaço mais próximo. */
function cortarPalavra(s: string, ini: number, fim: number): [number, number] {
  let a = ini;
  let b = fim;
  if (a > 0) {
    const espaco = s.lastIndexOf(' ', a);
    a = espaco >= 0 && a - espaco < 20 ? espaco + 1 : a;
  }
  if (b < s.length) {
    const espaco = s.indexOf(' ', b);
    b = espaco >= 0 && espaco - b < 20 ? espaco : b;
  }
  return [a, b];
}
