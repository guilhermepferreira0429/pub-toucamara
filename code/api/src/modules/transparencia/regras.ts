/*
 * Transparência (V3 · FUN §13, ponto 10): as regras puras dos dados abertos,
 * sem BD, para testar à parte. Supressão das contagens pequenas, CSV,
 * meses do período e o resumo por mês que alimenta os indicadores.
 */

/** Abaixo disto uma contagem não se publica: vira "<5". */
export const LIMIAR_SUPRESSAO = 5;
export const SUPRIMIDO = '<5';

export const REGRA_SUPRESSAO =
  `Para não se poder identificar ninguém, as contagens entre 1 e ${LIMIAR_SUPRESSAO - 1} aparecem como "${SUPRIMIDO}" ` +
  `e as médias e percentagens calculadas sobre menos de ${LIMIAR_SUPRESSAO} casos ficam em branco, tal como as percentagens que deixariam adivinhar uma contagem escondida. ` +
  'Os conjuntos só têm números agregados: nunca nomes, telefones, NIF, moradas ou textos escritos pelas pessoas.';

export const LICENCA = {
  id: 'CC-BY-4.0',
  nome: 'Creative Commons Atribuição 4.0 Internacional (CC BY 4.0)',
  url: 'https://creativecommons.org/licenses/by/4.0/deed.pt',
  /** O URI do vocabulário da UE que o DCAT-AP pede em dct:license. */
  uri: 'http://publications.europa.eu/resource/authority/licence/CC_BY_4_0',
} as const;

export const FREQUENCIAS = {
  diaria: {
    rotulo: 'Diária (os números são recalculados todas as noites)',
    uri: 'http://publications.europa.eu/resource/authority/frequency/DAILY',
  },
} as const;
export type Frequencia = keyof typeof FREQUENCIAS;

/**
 * - texto, mes ('AAAA-MM'), data ('AAAA-MM-DD'): dimensões, nunca suprimidas
 * - contagem: inteiro; 1 a 4 viram "<5"
 * - inteiro: inteiro que não conta pessoas (ex.: o prazo legal)
 * - decimal, percentagem: calculados sobre `base` (uma contagem); com a base
 *   abaixo do limiar ficam null
 */
export type TipoColuna =
  'texto' | 'mes' | 'data' | 'contagem' | 'inteiro' | 'decimal' | 'percentagem';

export interface Coluna {
  nome: string;
  tipo: TipoColuna;
  descricao: string;
  /** Para decimal e percentagem: a contagem (às vezes interna, com "_") de que depende. */
  base?: string;
  /**
   * Para percentagens: a contagem de cima. Se ela ou o que falta para a base
   * ficar entre 1 e 4, a percentagem também fica em branco (senão o "<5"
   * lia-se a partir da percentagem).
   */
  parte?: string;
}

export type Valor = string | number | null;
/** Uma linha antes da supressão; as chaves com "_" são internas e não saem. */
export type LinhaBruta = Record<string, Valor>;
/** Uma linha publicada: contagens como número ou "<5". */
export type Linha = Record<string, Valor>;

/** 0 e ≥ 5 publicam-se; de 1 a 4 vira "<5". */
export function suprimir(n: number): number | typeof SUPRIMIDO {
  return n > 0 && n < LIMIAR_SUPRESSAO ? SUPRIMIDO : n;
}

function numero(v: Valor | undefined): number {
  return typeof v === 'number' ? v : Number(v ?? 0) || 0;
}

/**
 * Aplica a regra a uma linha: as contagens pequenas viram "<5", os valores
 * calculados sobre poucos casos ficam null e as chaves internas ("_")
 * desaparecem. Só saem as colunas definidas, pela ordem definida.
 */
export function suprimirLinha(
  colunas: readonly Coluna[],
  bruta: LinhaBruta,
): Linha {
  const out: Linha = {};
  for (const c of colunas) {
    const v = bruta[c.nome];
    if (c.tipo === 'contagem') {
      out[c.nome] = suprimir(numero(v));
    } else if (c.tipo === 'decimal' || c.tipo === 'percentagem') {
      const base = c.base ? numero(bruta[c.base]) : LIMIAR_SUPRESSAO;
      const parte = c.parte ? numero(bruta[c.parte]) : null;
      const pequena =
        parte !== null &&
        (suprimir(parte) === SUPRIMIDO || suprimir(base - parte) === SUPRIMIDO);
      out[c.nome] =
        v === null || v === undefined || base < LIMIAR_SUPRESSAO || pequena
          ? null
          : numero(v);
    } else {
      out[c.nome] = v ?? null;
    }
  }
  return out;
}

export function suprimirLinhas(
  colunas: readonly Coluna[],
  linhas: readonly LinhaBruta[],
): Linha[] {
  return linhas.map((l) => suprimirLinha(colunas, l));
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180: vírgula, aspas, CRLF; UTF-8 sem BOM)
// ---------------------------------------------------------------------------

/** Um texto que uma folha de cálculo leria como fórmula ganha um apóstrofo. */
const FORMULA = /^[=+\-@\t\r]/;

export function celulaCsv(v: Valor): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : '';
  }
  let s = String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim()
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

export function paraCsv(
  colunas: readonly Coluna[],
  linhas: readonly Linha[],
): string {
  const cab = colunas.map((c) => celulaCsv(c.nome)).join(',');
  const corpo = linhas.map((l) =>
    colunas.map((c) => celulaCsv(l[c.nome] ?? null)).join(','),
  );
  return [cab, ...corpo].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------------

export const MESES_PUBLICADOS = 12;

/** 'AAAA-MM' n meses antes (negativo) ou depois de `mes`. */
export function somarMeses(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Os 12 meses publicados: do primeiro dia de há 11 meses até hoje. */
export function periodoPublicado(
  hoje: string,
  meses = MESES_PUBLICADOS,
): { de: string; ate: string; meses: string[] } {
  const atual = hoje.slice(0, 7);
  const lista = Array.from({ length: meses }, (_, i) =>
    somarMeses(atual, i - meses + 1),
  );
  return { de: `${lista[0]}-01`, ate: hoje, meses: lista };
}

export function mesValido(mes: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(mes);
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

const NOMES_MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** '2026-10' → 'outubro de 2026'. */
export function mesPorExtenso(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${NOMES_MESES[m - 1]} de ${a}`;
}

/** O último dia do mês 'AAAA-MM'. */
export function fimDoMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(Date.UTC(a, m, 0));
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Agrupar
// ---------------------------------------------------------------------------

const comparar = (a: Valor, b: Valor) =>
  typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a ?? '').localeCompare(String(b ?? ''), 'pt');

/**
 * Agrupa factos pelas dimensões e calcula as medidas de cada grupo. As
 * linhas saem ordenadas pelas dimensões (mês primeiro, se houver).
 */
export function tabelar<F extends Record<string, unknown>>(
  factos: readonly F[],
  dimensoes: readonly (keyof F & string)[],
  medidas: (grupo: readonly F[]) => LinhaBruta,
): LinhaBruta[] {
  const grupos = new Map<string, F[]>();
  for (const f of factos) {
    const k = JSON.stringify(dimensoes.map((d) => f[d] ?? null));
    const g = grupos.get(k);
    if (g) g.push(f);
    else grupos.set(k, [f]);
  }
  const linhas = [...grupos.entries()].map(([k, g]) => {
    const dims = JSON.parse(k) as Valor[];
    return {
      ...Object.fromEntries(dimensoes.map((d, i) => [d, dims[i]])),
      ...medidas(g),
    };
  });
  return linhas.sort((a, b) => {
    for (const d of dimensoes) {
      const c = comparar(a[d], b[d]);
      if (c) return c;
    }
    return 0;
  });
}

/** O total de cada mês (todas as outras dimensões juntas), para os indicadores. */
export function totaisPorMes<F extends { mes: string }>(
  factos: readonly F[],
  meses: readonly string[],
  medidas: (grupo: readonly F[]) => LinhaBruta,
): Record<string, LinhaBruta> {
  return Object.fromEntries(
    meses.map((m) => [m, medidas(factos.filter((f) => f.mes === m))]),
  );
}

export function pct(parte: number, total: number): number | null {
  return total ? Math.round((parte / total) * 1000) / 10 : null;
}
