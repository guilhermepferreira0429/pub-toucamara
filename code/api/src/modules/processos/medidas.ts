/*
 * Valores lidos, declarados e permitidos (V4 · análise de projetos de obras).
 * Regras puras, sem BD nem IA:
 *
 * - as grandezas que se comparam (área de implantação, pisos, afastamentos...),
 *   com a unidade e o intervalo plausível de cada uma;
 * - o número que a IA leu nos desenhos passa pela plausibilidade (unidade
 *   certa, dentro do intervalo, inteiro quando tem de ser);
 * - a comparação determinística: lido (desenhos, IA) × declarado
 *   (requerimento) × permitido (PDM) → ok / atenção / falha.
 *
 * Os elementos (casa das máquinas, amianto...) são perguntas de sim/não à IA.
 */

export const GRANDEZAS = {
  area_lote_m2: {
    rotulo: 'Área do lote',
    unidade: 'm2',
    min: 20,
    max: 1_000_000,
    inteiro: false,
  },
  area_obra_m2: {
    rotulo: 'Área da obra',
    unidade: 'm2',
    min: 0.5,
    max: 10_000,
    inteiro: false,
  },
  area_implantacao_m2: {
    rotulo: 'Área de implantação total',
    unidade: 'm2',
    min: 2,
    max: 100_000,
    inteiro: false,
  },
  area_construcao_m2: {
    rotulo: 'Área de construção total',
    unidade: 'm2',
    min: 2,
    max: 200_000,
    inteiro: false,
  },
  pisos: {
    rotulo: 'Pisos acima do solo',
    unidade: 'pisos',
    min: 1,
    max: 30,
    inteiro: true,
  },
  cercea_m: {
    rotulo: 'Cércea',
    unidade: 'm',
    min: 2,
    max: 80,
    inteiro: false,
  },
  afastamento_extremas_m: {
    rotulo: 'Afastamento às extremas (o menor)',
    unidade: 'm',
    min: 0,
    max: 500,
    inteiro: false,
  },
  afastamento_frente_m: {
    rotulo: 'Afastamento à via',
    unidade: 'm',
    min: 0,
    max: 500,
    inteiro: false,
  },
  altura_muro_m: {
    rotulo: 'Altura do muro',
    unidade: 'm',
    min: 0.2,
    max: 5,
    inteiro: false,
  },
  lugares_estacionamento: {
    rotulo: 'Lugares de estacionamento',
    unidade: 'lugares',
    min: 0,
    max: 500,
    inteiro: true,
  },
} as const;

export type Grandeza = keyof typeof GRANDEZAS;
export const CODIGOS_GRANDEZA = Object.keys(GRANDEZAS) as [
  Grandeza,
  ...Grandeza[],
];

export type Unidade = (typeof GRANDEZAS)[Grandeza]['unidade'];

/**
 * As unidades que a IA pode devolver: cm e mm convertem-se para m, ha para
 * m². Percentagens e índices não são medidas: não se aceitam.
 */
export const UNIDADES_LIDAS = [
  'm2',
  'm',
  'cm',
  'mm',
  'ha',
  'pisos',
  'lugares',
] as const;
export type UnidadeLida = (typeof UNIDADES_LIDAS)[number];

const UNIDADE_DITA: Record<Unidade, string> = {
  m2: 'm²',
  m: 'm',
  pisos: 'pisos',
  lugares: 'lugares',
};

/** 1.5 → '1,5'; 165 → '165'; 0.555 → '0,56'. */
export function numeroPt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(r).replace('.', ',');
}

export function valorDito(g: Grandeza, n: number): string {
  const u = GRANDEZAS[g].unidade;
  if (u === 'pisos') return `${numeroPt(n)} ${n === 1 ? 'piso' : 'pisos'}`;
  if (u === 'lugares') return `${numeroPt(n)} ${n === 1 ? 'lugar' : 'lugares'}`;
  return `${numeroPt(n)} ${UNIDADE_DITA[u]}`;
}

export function unidadeDita(g: Grandeza): string {
  return UNIDADE_DITA[GRANDEZAS[g].unidade];
}

/**
 * Um número escrito à portuguesa ou não: 1.5, '1,5', '1 234,5', '1.234,56'.
 * Ambíguo ('1.500': mil e quinhentos ou um e meio?) → null, para não
 * adivinhar.
 */
function numeroEscrito(t: string): number | null {
  const s = t.replace(/[\s\u00a0]/g, '');
  if (!/^-?\d[\d.,]*$/.test(s)) return null;
  let n: string;
  if (s.includes('.') && s.includes(',')) {
    // O último separador é o decimal; o outro, o dos milhares.
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const mil = dec === ',' ? '.' : ',';
    const [int, frac, ...resto] = s.split(dec);
    if (resto.length || !/^-?\d{1,3}(\d{3})*$/.test(int.split(mil).join('')))
      return null;
    if (
      !int
        .split(mil)
        .slice(1)
        .every((g) => g.length === 3)
    )
      return null;
    n = `${int.split(mil).join('')}.${frac}`;
  } else if (/^-?\d{1,3}([.,]\d{3}){2,}$/.test(s)) {
    n = s.replace(/[.,]/g, ''); // 1.234.567
  } else if (/^-?\d{1,3}\.\d{3}$/.test(s)) {
    return null; // '1.500': ambíguo
  } else if (/^-?\d+([.,]\d+)?$/.test(s)) {
    n = s.replace(',', '.');
  } else return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/** As unidades escritas no requerimento, normalizadas. */
const UNIDADE_ESCRITA: [RegExp, UnidadeLida][] = [
  [/^(m²|m2|metros?quadrados?)$/i, 'm2'],
  [/^(ha|hectares?)$/i, 'ha'],
  [/^(m|mts?|metros?)$/i, 'm'],
  [/^(cm|cent[ií]metros?)$/i, 'cm'],
  [/^(mm|mil[ií]metros?)$/i, 'mm'],
  [/^pisos?$/i, 'pisos'],
  [/^lugar(es)?$/i, 'lugares'],
];

/** O número e a unidade escrita ('1,5 m' → 1,5 e m); null se não se percebe. */
function numeroEUnidade(
  x: unknown,
): { n: number; unidade: UnidadeLida | null } | null {
  if (typeof x === 'number') {
    return Number.isFinite(x) ? { n: x, unidade: null } : null;
  }
  if (typeof x !== 'string') return null;
  const m =
    /^\s*(-?[\d][\d\s\u00a0.,]*?)\s*([a-zA-Z²%][a-zA-Z0-9²\s]*)?\s*$/.exec(x);
  if (!m) return null;
  const n = numeroEscrito(m[1]);
  if (n === null) return null;
  const u = m[2]?.replace(/\s+/g, '') ?? '';
  if (!u) return { n, unidade: null };
  const achada = UNIDADE_ESCRITA.find(([re]) => re.test(u));
  return achada ? { n, unidade: achada[1] } : null;
}

/**
 * Um número do requerimento: 1.5, '1,5', '1,5 m', '165 m²'. null se não é
 * um número.
 */
export function lerNumero(x: unknown): number | null {
  return numeroEUnidade(x)?.n ?? null;
}

/** Converte um valor na unidade lida para a unidade da grandeza (null se não dá). */
function converter(
  g: Grandeza,
  valor: number,
  unidade: UnidadeLida,
): number | null {
  const u = GRANDEZAS[g].unidade;
  const fator =
    unidade === u
      ? 1
      : u === 'm' && unidade === 'cm'
        ? 0.01
        : u === 'm' && unidade === 'mm'
          ? 0.001
          : u === 'm2' && unidade === 'ha'
            ? 10_000
            : null;
  if (fator === null) return null;
  // Sem restos de vírgula flutuante (125 cm → 1,25 m, não 1,2500000000000002).
  return Math.round(valor * fator * 1e6) / 1e6;
}

/**
 * Um valor declarado no requerimento para a grandeza, na unidade dela: '150
 * cm' → 1,5 m; '0,05 ha' → 500 m². Uma unidade que não é desta grandeza ('3
 * m²' num afastamento) ou um valor fora do intervalo plausível → null (fica
 * "por verificar", nunca se adivinha).
 */
export function lerMedida(g: Grandeza, x: unknown): number | null {
  const r = numeroEUnidade(x);
  if (!r) return null;
  const v = r.unidade ? converter(g, r.n, r.unidade) : r.n;
  if (v === null) return null;
  const def = GRANDEZAS[g];
  if (v < def.min || v > def.max) return null;
  if (def.inteiro && !Number.isInteger(v)) return null;
  return v;
}

export type Plausibilidade =
  { ok: true; valor: number } | { ok: false; motivo: string };

/**
 * O número que a IA leu, validado: a unidade tem de ser a da grandeza (cm
 * passa a m), dentro do intervalo plausível e inteiro quando é contagem.
 */
export function medicaoPlausivel(
  g: Grandeza,
  valor: number,
  unidade: UnidadeLida,
): Plausibilidade {
  const def = GRANDEZAS[g];
  const v = converter(g, valor, unidade);
  if (v === null) {
    return {
      ok: false,
      motivo: `${def.rotulo}: a IA leu em ${unidade === 'm2' ? 'm²' : unidade}, esperava-se ${UNIDADE_DITA[def.unidade]}`,
    };
  }
  if (!Number.isFinite(v) || v < def.min || v > def.max) {
    return {
      ok: false,
      motivo: `${def.rotulo}: ${numeroPt(v)} ${UNIDADE_DITA[def.unidade]} não é plausível`,
    };
  }
  if (def.inteiro && !Number.isInteger(v)) {
    return {
      ok: false,
      motivo: `${def.rotulo}: ${numeroPt(v)} não é um número inteiro`,
    };
  }
  return { ok: true, valor: v };
}

/** Diferença a partir da qual lido e declarado "não batem certo". */
export function tolerancia(g: Grandeza, referencia: number): number {
  switch (GRANDEZAS[g].unidade) {
    case 'm2':
      return Math.max(0.5, Math.abs(referencia) * 0.02);
    case 'm':
      return 0.05;
    default:
      return 0;
  }
}

export interface Permitido {
  valor: number;
  /** max: não pode passar; min: não pode ficar abaixo. */
  sentido: 'max' | 'min';
  /** De onde vem: 'Índice de implantação 0,5 × lote de 300 m²'. */
  origem: string;
}

export type EstadoComparacao = 'ok' | 'atencao' | 'falha' | 'nao_verificavel';

export interface Comparacao {
  estado: EstadoComparacao;
  /** ia: o resultado assenta no que a IA leu (a confirmar pelo técnico). */
  origem: 'regra' | 'ia';
  a_confirmar: boolean;
  detalhe: string;
  notas: string[];
}

function viola(v: number, p: Permitido): boolean {
  // Margem de arredondamento: 150,004 m² não "passa" 150 m².
  const eps = 1e-6;
  return p.sentido === 'max' ? v > p.valor + eps : v < p.valor - eps;
}

function limiteDito(g: Grandeza, p: Permitido): string {
  return `${p.sentido === 'max' ? 'máximo' : 'mínimo'} ${valorDito(g, p.valor)}`;
}

/**
 * Compara de forma determinística o lido, o declarado e o permitido:
 * - falha se o declarado (regra) ou o lido (IA, a confirmar) não cumpre o permitido;
 * - atenção se o lido e o declarado diferem mais do que a tolerância;
 * - ok se cumpre (ou, sem limite, se lido e declarado batem certo);
 * - não verificável se não há nada para comparar.
 */
export function compararValor(
  g: Grandeza,
  e: {
    lido: number | null;
    declarado: number | null;
    permitido: Permitido | null;
    /** A IA leu o projeto (para dizer "não se viu nos desenhos"). */
    ia_leu?: boolean;
  },
): Comparacao {
  const { lido, declarado, permitido } = e;
  const partes: string[] = [];
  if (declarado !== null) partes.push(`declarado ${valorDito(g, declarado)}`);
  if (lido !== null) partes.push(`desenhado ${valorDito(g, lido)}`);
  if (permitido) partes.push(limiteDito(g, permitido));
  const detalhe = partes.length
    ? partes.join(' · ').replace(/^./, (c) => c.toUpperCase())
    : '';
  const notas: string[] = [];
  if (permitido) notas.push(permitido.origem);
  if (lido === null && declarado !== null && e.ia_leu) {
    notas.push('A IA não encontrou este valor nos desenhos.');
  }

  if (lido === null && declarado === null) {
    return {
      estado: 'nao_verificavel',
      origem: 'regra',
      a_confirmar: false,
      detalhe: permitido
        ? `Sem valor declarado nem lido nos desenhos (${limiteDito(g, permitido)}).`
        : 'Sem valor declarado nem lido nos desenhos.',
      notas,
    };
  }
  if (permitido && declarado !== null && viola(declarado, permitido)) {
    return {
      estado: 'falha',
      origem: 'regra',
      a_confirmar: false,
      detalhe,
      notas: [
        `O valor declarado ${permitido.sentido === 'max' ? 'excede o' : 'fica abaixo do'} ${limiteDito(g, permitido)}.`,
        ...notas,
      ],
    };
  }
  if (permitido && lido !== null && viola(lido, permitido)) {
    return {
      estado: 'falha',
      origem: 'ia',
      a_confirmar: true,
      detalhe,
      notas: [
        `O valor desenhado ${permitido.sentido === 'max' ? 'excede o' : 'fica abaixo do'} ${limiteDito(g, permitido)}: a confirmar pelo técnico.`,
        ...notas,
      ],
    };
  }
  if (
    lido !== null &&
    declarado !== null &&
    Math.abs(lido - declarado) > tolerancia(g, declarado)
  ) {
    return {
      estado: 'atencao',
      origem: 'ia',
      a_confirmar: true,
      detalhe,
      notas: [
        'O valor desenhado não bate certo com o declarado: a confirmar pelo técnico.',
        ...notas,
      ],
    };
  }
  if (!permitido) {
    // Sem limite: só se diz "ok" quando o desenho confirma o declarado.
    if (lido !== null && declarado !== null) {
      return {
        estado: 'ok',
        origem: 'ia',
        a_confirmar: true,
        detalhe,
        notas: [
          'Desenhado e declarado batem certo (IA, a confirmar).',
          ...notas,
        ],
      };
    }
    return {
      estado: 'nao_verificavel',
      origem: lido !== null ? 'ia' : 'regra',
      a_confirmar: lido !== null,
      detalhe: `${detalhe}; sem limite a comparar.`,
      notas,
    };
  }
  // Cumpre o permitido.
  const soLido = declarado === null;
  if (lido !== null && declarado !== null) {
    notas.unshift('Confirmado nos desenhos (IA, a confirmar).');
  }
  return {
    estado: 'ok',
    origem: soLido ? 'ia' : 'regra',
    a_confirmar: soLido,
    detalhe,
    notas,
  };
}

// ---------------------------------------------------------------------------
// Elementos: perguntas de sim/não à IA, por tipo de operação
// ---------------------------------------------------------------------------

export const ELEMENTOS = {
  casa_maquinas: {
    rotulo: 'Casa das máquinas da piscina',
    pergunta:
      'Se a casa das máquinas (filtragem e bombagem) está desenhada, onde e com que dimensão.',
    esperado: 'sim',
  },
  confronta_via: {
    rotulo: 'Muro confinante com a via pública',
    pergunta:
      'Se o muro confronta com a via pública (arruamento ou passeio), pela planta.',
    esperado: null,
  },
  materiais_cores: {
    rotulo: 'Materiais e cores do exterior',
    pergunta:
      'Se os materiais, as cores e a caixilharia do exterior estão indicados, e quais.',
    esperado: 'sim',
  },
  plano_demolicao: {
    rotulo: 'Plano de demolição',
    pergunta:
      'Se há plano de demolição: o que se demole, por que ordem, com que meios e como se protege a via e os vizinhos.',
    esperado: 'sim',
  },
  amianto: {
    rotulo: 'Materiais com amianto',
    pergunta:
      'Se os documentos referem fibrocimento ou amianto (coberturas, tubagens, painéis).',
    esperado: 'nao',
  },
  acessibilidades: {
    rotulo: 'Acessibilidades',
    pergunta:
      'Se o projeto mostra entrada sem degraus (ou rampa) e instalação sanitária adaptada.',
    esperado: 'sim',
  },
} as const;

export type Elemento = keyof typeof ELEMENTOS;
export const CODIGOS_ELEMENTO = Object.keys(ELEMENTOS) as [
  Elemento,
  ...Elemento[],
];
