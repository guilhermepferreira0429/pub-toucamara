/*
 * Números ditos pelo agente que não estão na fonte.
 *
 * O agente responde só com informação oficial e cita a fonte. Um valor (taxa
 * em €, prazo em dias, horário, telefone, percentagem, área) que ele diz e
 * que não aparece nos trechos citados é uma alucinação perigosa em nome da
 * câmara. Aqui extraem-se os números com significado de um texto em PT-PT,
 * normalizados ("12,50 €" = "12.50 euros", "9h" = "09:00", "253 421 200" =
 * "253421200"), e vê-se se cada um aparece nas fontes (extraídas da mesma
 * maneira). Função pura: serve o painel (conversas, qualidade) e está
 * copiada no avaliador (code/avaliador/src/juiz/numeros.ts).
 *
 * Ficam de fora, de propósito: artigos e diplomas ("art. 12.º", "Lei n.º
 * 75/2013"), ordinais, números de processo ("2024/123"), marcadores de
 * lista, endereços web e emails, inteiros de um algarismo ("2 documentos") e
 * os números nacionais de emergência (112, SNS 24...), que não são da câmara.
 */

export type TipoNumero =
  | 'euros'
  | 'percentagem'
  | 'prazo'
  | 'hora'
  | 'telefone'
  | 'data'
  | 'area'
  | 'codigo_postal'
  | 'numero';

export interface NumeroDito {
  /** Como estava escrito ("12,50 €"). */
  texto: string;
  /**
   * Normalizado: "12.5" (euros, percentagem, prazo, área, número), "09:30"
   * (hora), "253421200" (telefone), "2026-03-15" ou "03-15" sem ano (data),
   * "4800-431" (código postal).
   */
  valor: string;
  tipo: TipoNumero;
  /** Só nos prazos: dia, semana, mes, ano, hora, minuto. */
  unidade?: string;
  naFonte: boolean;
}

export interface VerificacaoNumeros {
  numeros: NumeroDito[];
  semFonte: NumeroDito[];
}

/** Números nacionais que o agente pode dizer sem fonte da câmara. */
const NUMEROS_NACIONAIS = new Set([
  '112',
  '117',
  '144',
  '116111',
  '116000',
  '808242424',
  '808200520',
]);

const MESES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

/**
 * Um número em PT-PT: "1 234,56", "1.234,56", "12,50", "12.50", "30".
 * Milhares só com grupos de 3 algarismos (espaço ou ponto).
 */
const NUM = String.raw`\d{1,3}(?:[ .]\d{3})+(?:,\d+)?(?!\d)|\d+(?:[.,]\d+)?`;

/** Fronteira à esquerda: não a meio de outro número ou palavra. */
const ANTES = String.raw`(?<![\p{L}\p{N}_.,])`;
/** Fronteira à direita: não seguido de algarismo ou letra. */
const DEPOIS = String.raw`(?![\p{L}\p{N}])`;

/** "1 234,56" → 1234.56; "12.50" → 12.5; "1.234" → 1234. */
export function lerNumero(s: string): number {
  const t = s.replace(/ /g, '');
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  // Só pontos: milhares se todos os grupos depois do primeiro têm 3 algarismos.
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
}

function formatar(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

const dois = (n: number) => String(n).padStart(2, '0');

function semAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const UNIDADES: [RegExp, string][] = [
  [/^dias?/, 'dia'],
  [/^semanas?/, 'semana'],
  [/^(meses|mes)/, 'mes'],
  [/^anos?/, 'ano'],
  [/^(horas?|h)$/, 'hora'],
  [/^min/, 'minuto'],
];

function unidadeDe(s: string): string {
  const u = semAcentos(s.toLowerCase());
  return UNIDADES.find(([re]) => re.test(u))?.[1] ?? u;
}

function hora(h: number, m: number): string | null {
  if (h > 24 || m > 59) return null;
  return `${dois(h)}:${dois(m)}`;
}

function data(d: number, m: number, a: number | null): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (a !== null && a < 100) a += 2000;
  return a === null ? `${dois(m)}-${dois(d)}` : `${a}-${dois(m)}-${dois(d)}`;
}

interface Achado {
  inicio: number;
  texto: string;
  valor: string;
  tipo: TipoNumero;
  unidade?: string;
}

type Leitor = (m: RegExpExecArray) => Omit<Achado, 'inicio' | 'texto'>[] | null;

interface Passo {
  re: RegExp;
  /** null = ignorar (tapa o texto sem dar número). */
  ler: Leitor | null;
}

const UNIDADE_PRAZO = String.raw`dias?(?:\s+(?:úteis|uteis|seguidos|corridos|de calendário))?|semanas?|meses|mês|mes|anos?|horas?|minutos?|min`;
const MES_NOME = String.raw`janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro`;
/** O que faz de um número uma hora: "h", "h30", " h 30", ":30", ":30h". */
const SUFIXO_HORA = String.raw`\s?:\s?\d{2}(?:\s?h)?|\s?h(?:\s?\d{2})?`;

/** Os minutos de um sufixo de hora ("h30" → 30; "h" ou nada → 0). */
function minutos(sufixo: string | undefined): number {
  const m = /\d{2}/.exec(sufixo ?? '');
  return m ? +m[0] : 0;
}

/*
 * Os passos correm por ordem e cada um tapa o que encontrou, para o seguinte
 * não ver o mesmo número outra vez (o telefone não volta a ser "253").
 */
const PASSOS: Passo[] = [
  // Endereços web, emails e o nome "SNS 24".
  {
    re: /https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\bSNS\s?24\b/giu,
    ler: null,
  },
  // Artigos, números, alíneas e diplomas: "art. 12.º", "n.º 3", "Lei n.º 75/2013".
  {
    re: new RegExp(
      String.raw`(?:\b(?:art(?:igo)?s?\.?|al[ií]neas?|cap[ií]tulo|anexo|decreto[- ]lei|lei|portaria|despacho|regulamento|aviso|edital)\s*(?:n\.?\s?[º°]s?\.?\s*)?|\bn\.?\s?[º°]s?\.?\s*)\d+(?:[.\/-]\d+)*(?:\s?\.?\s?[ºª°])?(?:\s*,\s*n\.?\s?[º°]\.?\s*\d+)?`,
      'giu',
    ),
    ler: null,
  },
  // Datas: "15/03/2026", "15-03-26", "2026-03-15", "15 de março de 2026", "1.º de maio".
  {
    re: new RegExp(String.raw`${ANTES}(\d{4})-(\d{2})-(\d{2})${DEPOIS}`, 'gu'),
    ler: (m) => {
      const v = data(+m[3], +m[2], +m[1]);
      return v ? [{ valor: v, tipo: 'data' }] : null;
    },
  },
  {
    re: new RegExp(
      String.raw`${ANTES}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4}|\d{2})${DEPOIS}`,
      'gu',
    ),
    ler: (m) => {
      const v = data(+m[1], +m[2], +m[3]);
      return v ? [{ valor: v, tipo: 'data' }] : null;
    },
  },
  {
    re: new RegExp(
      String.raw`${ANTES}(\d{1,2})(?:\.?\s?[ºo°])?\s+de\s+(${MES_NOME})(?:\s+de\s+(\d{4}))?${DEPOIS}`,
      'giu',
    ),
    ler: (m) => {
      const v = data(
        +m[1],
        MESES[semAcentos(m[2].toLowerCase())],
        m[3] ? +m[3] : null,
      );
      return v ? [{ valor: v, tipo: 'data' }] : null;
    },
  },
  // Telefones portugueses (9 algarismos, 2xx, 3xx, 7xx, 8xx, 9xx), com ou sem +351.
  {
    re: new RegExp(
      String.raw`${ANTES}(?:\+\s?351[\s.-]?|00351[\s.-]?)?(?:([23789]\d{2})[\s.-]?(\d{3})[\s.-]?(\d{3})|([23789]\d{2})[\s.-](\d{2})[\s.-](\d{2})[\s.-](\d{2}))${DEPOIS}`,
      'gu',
    ),
    ler: (m) => [
      {
        valor: m
          .slice(1)
          .filter((g) => g !== undefined)
          .join(''),
        tipo: 'telefone',
      },
    ],
  },
  // Códigos postais.
  {
    re: new RegExp(String.raw`${ANTES}(\d{4})\s?-\s?(\d{3})${DEPOIS}`, 'gu'),
    ler: (m) => [{ valor: `${m[1]}-${m[2]}`, tipo: 'codigo_postal' }],
  },
  // Números de processo e semelhantes: "2024/123", "123/2024".
  {
    re: new RegExp(String.raw`${ANTES}\d+(?:\/\d+)+${DEPOIS}`, 'gu'),
    ler: null,
  },
  // Intervalos de horas: "das 9 às 16h", "entre as 9 e as 17 horas", "9-16h", "9h30 às 12h".
  {
    re: new RegExp(
      String.raw`(?:\b(das|entre\s+as|entre\s+às|entre)\s+)?${ANTES}(\d{1,2})(${SUFIXO_HORA})?(\s*[-–]\s*|\s+(?:às|as|a|e\s+as|e\s+às|e|até\s+às|até\s+as|até)\s+)(\d{1,2})(${SUFIXO_HORA}|\s+horas)${DEPOIS}`,
      'giu',
    ),
    ler: (m) => {
      // "3 a 5 horas" é uma duração; "das 9 às 16h", "9h às 16h" e "9-16h" são horas.
      const ehHorario = !!m[1] || !!m[3] || /[-–]/.test(m[4]);
      if (!ehHorario) return null;
      const a = hora(+m[2], minutos(m[3]));
      const b = hora(+m[5], minutos(m[6]));
      if (!a || !b) return null;
      return [
        { valor: a, tipo: 'hora' },
        { valor: b, tipo: 'hora' },
      ];
    },
  },
  // Horas soltas: "9h", "9h30", "09:30", "às 9", "às 18 horas".
  {
    re: new RegExp(
      String.raw`${ANTES}(\d{1,2})(${SUFIXO_HORA})${DEPOIS}`,
      'giu',
    ),
    ler: (m) => {
      const v = hora(+m[1], minutos(m[2]));
      return v ? [{ valor: v, tipo: 'hora' }] : null;
    },
  },
  {
    re: new RegExp(
      String.raw`(?<!\p{L})(?:às|pelas|até\s+às|a\s+partir\s+das)\s+(\d{1,2})(?:\s+horas)?(?![\p{L}\p{N}]|[.,]\d)`,
      'giu',
    ),
    ler: (m) => {
      const v = hora(+m[1], 0);
      return v ? [{ valor: v, tipo: 'hora' }] : null;
    },
  },
  // Euros: "12,50 €", "12.50 euros", "€ 12,50", "3,50€", "1 234,56 EUR".
  {
    re: new RegExp(
      String.raw`${ANTES}(${NUM})\s?(?:€|euros?\b|eur\b)|(?:€|\beur\b)\s?(${NUM})${DEPOIS}`,
      'giu',
    ),
    ler: (m) => [{ valor: formatar(lerNumero(m[1] ?? m[2])), tipo: 'euros' }],
  },
  // Percentagens.
  {
    re: new RegExp(String.raw`${ANTES}(${NUM})\s?(?:%|por\s+cento\b)`, 'giu'),
    ler: (m) => [{ valor: formatar(lerNumero(m[1])), tipo: 'percentagem' }],
  },
  // Áreas.
  {
    re: new RegExp(
      String.raw`${ANTES}(${NUM})\s?(?:m2|m²|metros\s+quadrados)${DEPOIS}`,
      'giu',
    ),
    ler: (m) => [{ valor: formatar(lerNumero(m[1])), tipo: 'area' }],
  },
  // Prazos e durações: "30 dias", "10 dias úteis", "2 meses", "48 horas".
  {
    re: new RegExp(
      String.raw`${ANTES}(${NUM})\s?(${UNIDADE_PRAZO})${DEPOIS}`,
      'giu',
    ),
    ler: (m) => [
      {
        valor: formatar(lerNumero(m[1])),
        tipo: 'prazo',
        unidade: unidadeDe(m[2]),
      },
    ],
  },
  // Ordinais e marcadores de lista: "1.º", "2.ª", "1." ou "1)" no início da linha.
  {
    re: new RegExp(
      String.raw`${ANTES}\d+\s?\.?\s?[ºª°]|^\s*\d+[.)](?=\s)`,
      'gmu',
    ),
    ler: null,
  },
  // O resto: números soltos com mais de um algarismo ou com decimais.
  {
    re: new RegExp(String.raw`${ANTES}(${NUM})${DEPOIS}`, 'gu'),
    ler: (m) => {
      if (/^\d$/.test(m[1])) return null;
      return [{ valor: formatar(lerNumero(m[1])), tipo: 'numero' }];
    },
  },
];

/** Espaços "esquisitos" (sem quebra, fino) passam a espaço normal. */
function limpar(texto: string): string {
  return texto.replace(/[    ]/g, ' ');
}

/** Todos os números com significado de um texto, pela ordem em que aparecem. */
export function extrairNumeros(texto: string): Omit<NumeroDito, 'naFonte'>[] {
  const original = limpar(texto);
  let resto = original;
  const achados: Achado[] = [];
  for (const passo of PASSOS) {
    passo.re.lastIndex = 0;
    const tapar: [number, number][] = [];
    for (const m of resto.matchAll(passo.re)) {
      const inicio = m.index;
      const lidos = passo.ler ? passo.ler(m) : [];
      if (lidos === null) continue;
      tapar.push([inicio, inicio + m[0].length]);
      for (const l of lidos)
        achados.push({
          ...l,
          inicio,
          texto: original.slice(inicio, inicio + m[0].length).trim(),
        });
    }
    // '#' não é algarismo, letra nem espaço: nada volta a bater ali.
    for (const [a, b] of tapar)
      resto = resto.slice(0, a) + '#'.repeat(b - a) + resto.slice(b);
  }
  return achados
    .filter((a) => !(a.tipo !== 'data' && NUMEROS_NACIONAIS.has(a.valor)))
    .sort((a, b) => a.inicio - b.inicio)
    .map(({ inicio: _, ...n }) => n);
}

function chave(n: Omit<NumeroDito, 'naFonte'>): string {
  return n.tipo === 'prazo'
    ? `prazo:${n.unidade}:${n.valor}`
    : `${n.tipo}:${n.valor}`;
}

/** O que há nas fontes, pronto a consultar. */
interface Indice {
  chaves: Set<string>;
  /** Valores de quantidades (euros, %, prazos, áreas, números soltos). */
  quantidades: Set<string>;
  /** Mês e dia de todas as datas ("03-15"). */
  diasDoAno: Set<string>;
}

const QUANTIDADES: TipoNumero[] = [
  'euros',
  'percentagem',
  'prazo',
  'area',
  'numero',
];

function indexar(fontes: string[]): Indice {
  const i: Indice = {
    chaves: new Set(),
    quantidades: new Set(),
    diasDoAno: new Set(),
  };
  for (const f of fontes)
    for (const n of extrairNumeros(f)) {
      i.chaves.add(chave(n));
      if (QUANTIDADES.includes(n.tipo)) i.quantidades.add(n.valor);
      if (n.tipo === 'data') i.diasDoAno.add(n.valor.slice(-5));
    }
  return i;
}

/**
 * Está na fonte? A unidade conta ("15 €" não bate com "15 dias"), mas um
 * número sem unidade na fonte (uma tabela de taxas: "Licença ... 15,00")
 * vale para qualquer unidade, e um número solto na resposta vale se o
 * valor aparece na fonte com qualquer unidade.
 */
function naFonte(n: Omit<NumeroDito, 'naFonte'>, i: Indice): boolean {
  if (i.chaves.has(chave(n))) return true;
  switch (n.tipo) {
    case 'numero':
      return (
        i.quantidades.has(n.valor) ||
        (/^\d{1,2}$/.test(n.valor) && i.chaves.has(`hora:${dois(+n.valor)}:00`))
      );
    case 'euros':
    case 'percentagem':
    case 'area':
    case 'prazo':
      return i.chaves.has(`numero:${n.valor}`);
    case 'hora': {
      // "9h" na resposta, "9 horas" (ou "às 9") na fonte.
      const [h, m] = n.valor.split(':');
      return m === '00' && i.chaves.has(`prazo:hora:${+h}`);
    }
    case 'data':
      // "15 de março" na resposta bate com "15/03/2026" na fonte e vice-versa.
      return (
        i.diasDoAno.has(n.valor.slice(-5)) &&
        (n.valor.length === 5 || i.chaves.has(`data:${n.valor.slice(-5)}`))
      );
    default:
      return false;
  }
}

/**
 * Os números de `texto` (a resposta do agente) e, para cada um, se aparece
 * em algum dos textos de `fontes` (trechos citados, gabarito, a pergunta).
 * Repetidos contam uma vez.
 */
export function verificarNumeros(
  texto: string,
  fontes: string[],
): VerificacaoNumeros {
  const indice = indexar(fontes);
  const vistos = new Set<string>();
  const numeros: NumeroDito[] = [];
  for (const n of extrairNumeros(texto)) {
    const k = chave(n);
    if (vistos.has(k)) continue;
    vistos.add(k);
    numeros.push({ ...n, naFonte: naFonte(n, indice) });
  }
  return { numeros, semFonte: numeros.filter((n) => !n.naFonte) };
}

export interface ResumoNumeros {
  respostas: number;
  /** Respostas que dizem pelo menos um número. */
  com_numeros: number;
  /** Respostas com pelo menos um número que não está na fonte. */
  com_numeros_sem_fonte: number;
  /** Total de números sem fonte (repetidos numa resposta contam uma vez). */
  numeros_sem_fonte: number;
  /** % de respostas com ≥1 número sem fonte; null sem respostas. */
  percentagem: number | null;
}

/** Agregado de várias respostas, cada uma com as suas fontes. */
export function resumirNumeros(
  respostas: { texto: string | null; fontes: string[] }[],
): ResumoNumeros & { porResposta: VerificacaoNumeros[] } {
  const porResposta = respostas.map((r) =>
    verificarNumeros(r.texto ?? '', r.fontes),
  );
  const comSemFonte = porResposta.filter((v) => v.semFonte.length).length;
  return {
    respostas: respostas.length,
    com_numeros: porResposta.filter((v) => v.numeros.length).length,
    com_numeros_sem_fonte: comSemFonte,
    numeros_sem_fonte: porResposta.reduce((s, v) => s + v.semFonte.length, 0),
    percentagem: respostas.length
      ? Math.round((1000 * comSemFonte) / respostas.length) / 10
      : null,
    porResposta,
  };
}

/**
 * Numa conversa: os turnos do agente que citam fontes e dizem números que
 * não estão nos trechos citados. O que o munícipe disse também conta como
 * fonte (o agente pode repetir o telefone ou a data que a pessoa deu).
 * Turnos sem citações ficam de fora: aí o agente não afirma ter fonte
 * (confirmações de pedidos, números de processo vindos das ferramentas).
 */
export function numerosSemFonteNaConversa(
  turnos: { id: string; papel: string; texto: string }[],
  citacoes: { turno_id: string; texto: string }[],
): { turno_id: string; numeros: Omit<NumeroDito, 'naFonte'>[] }[] {
  const doMunicipe = turnos
    .filter((t) => t.papel === 'municipe')
    .map((t) => t.texto);
  const out: { turno_id: string; numeros: Omit<NumeroDito, 'naFonte'>[] }[] =
    [];
  for (const t of turnos) {
    if (t.papel !== 'agente') continue;
    const trechos = citacoes
      .filter((c) => c.turno_id === t.id)
      .map((c) => c.texto);
    if (!trechos.length) continue;
    const { semFonte } = verificarNumeros(t.texto, [...trechos, ...doMunicipe]);
    if (semFonte.length)
      out.push({
        turno_id: t.id,
        numeros: semFonte.map(({ naFonte: _, ...n }) => n),
      });
  }
  return out;
}
