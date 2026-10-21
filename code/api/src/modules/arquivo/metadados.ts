/*
 * Metadados de um processo antigo digitalizado, sem IA: expressões regulares
 * sobre o texto (camada de texto do PDF, OCR ou transcrição). Puro, para
 * testar à parte. Com IA, o ArquivoIaService preenche primeiro e isto só
 * completa o que ficou por ler.
 */

export const TIPOS_ARQUIVO = [
  'obras',
  'loteamento',
  'utilizacao',
  'demolicao',
  'ocupacao_via',
  'publicidade',
  'outro',
] as const;
export type TipoArquivo = (typeof TIPOS_ARQUIVO)[number];

export const NOMES_TIPO: Record<TipoArquivo, string> = {
  obras: 'Obras (licença de construção ou alteração)',
  loteamento: 'Loteamento',
  utilizacao: 'Licença de utilização / habitação',
  demolicao: 'Demolição',
  ocupacao_via: 'Ocupação da via pública',
  publicidade: 'Publicidade',
  outro: 'Outro',
};

export interface Metadados {
  numero_antigo: string | null;
  ano: number | null;
  tipo: TipoArquivo | null;
  requerente: string | null;
  morada: string | null;
  freguesia: string | null;
  artigo_matricial: string | null;
}

export const CAMPOS_METADADOS = [
  'numero_antigo',
  'ano',
  'tipo',
  'requerente',
  'morada',
  'freguesia',
  'artigo_matricial',
] as const satisfies readonly (keyof Metadados)[];

export const METADADOS_VAZIOS: Metadados = {
  numero_antigo: null,
  ano: null,
  tipo: null,
  requerente: null,
  morada: null,
  freguesia: null,
  artigo_matricial: null,
};

/** Minúsculas, sem acentos, espaços simples. Para comparar e pesquisar. */
export function semAcentos(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[º°ª]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ano de dois algarismos (processos dos anos 50 a 90) para quatro. */
export function anoCompleto(
  a: string,
  anoAtual = new Date().getFullYear(),
): number {
  const n = Number(a);
  if (a.length >= 4) return n;
  const seculo = n + 2000 <= anoAtual ? 2000 : 1900;
  return seculo + n;
}

function anoValido(n: number, anoAtual: number): boolean {
  return n >= 1850 && n <= anoAtual;
}

const LETRA = "[\\p{L}'’.-]";
const PALAVRA_NOME = `\\p{Lu}${LETRA}*`;
const LIGACAO_NOME = '(?:d[aeo]s?|e)';
/** "José da Silva Conceição": palavras com maiúscula, com "da/de/do/e" pelo meio. */
const NOME = `${PALAVRA_NOME}(?:\\s+(?:${LIGACAO_NOME}\\s+)?${PALAVRA_NOME}){1,7}`;

const TIPOS_DE_VIA =
  'Rua|R\\.|Avenida|Av\\.|Avª|Travessa|Trav\\.|Tv\\.|Largo|Lg\\.|Praça|Pç\\.|Praceta|Lugar|Estrada|Estr\\.|Caminho|Alameda|Bairro|Urbanização|Quinta|Calçada|Beco|Viela|Rotunda';

function limpar(s: string | undefined | null, max = 160): string | null {
  if (!s) return null;
  const t = s
    .replace(/\s+/g, ' ')
    .replace(/^[\s,:;.–—-]+|[\s,:;.–—-]+$/g, '')
    .trim();
  return t.length >= 2 ? t.slice(0, max) : null;
}

/** O texto numa só linha: as quebras do papel não querem dizer nada. */
function numaLinha(texto: string): string {
  return texto.replace(/-\n(?=\p{Ll})/gu, '').replace(/\s*\n\s*/g, ' ');
}

export function lerNumeroAntigo(texto: string): string | null {
  const t = numaLinha(texto);
  const re = new RegExp(
    '\\b(?:proc(?:esso)?\\.?º?|obra)' +
      '(?:\\s+(?:de|da|do)\\s+[\\p{L} ]{3,40}?)?' +
      '\\s*(?:n\\.?\\s*[º°o]\\.?|número|nr\\.?)?\\s*[:.]?\\s*' +
      '(\\d{1,6})\\s*[/-]\\s*(\\d{2}(?:\\d{2})?)\\b',
    'iu',
  );
  const m = re.exec(t);
  if (!m) return null;
  return `${Number(m[1])}/${m[2]}`;
}

const MESES =
  'janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';

export function lerAno(
  texto: string,
  numero: string | null,
  anoAtual = new Date().getFullYear(),
): number | null {
  if (numero) {
    const a = anoCompleto(numero.split('/')[1], anoAtual);
    if (anoValido(a, anoAtual)) return a;
  }
  const t = numaLinha(texto);
  const candidatos: number[] = [];
  const porExtenso = new RegExp(
    `\\b\\d{1,2}\\s+de\\s+(?:${MESES})\\s+de\\s+(\\d{4})\\b`,
    'giu',
  );
  for (const m of t.matchAll(porExtenso)) candidatos.push(Number(m[1]));
  for (const m of t.matchAll(/\b\d{1,2}[/.-]\d{1,2}[/.-](\d{4})\b/g)) {
    candidatos.push(Number(m[1]));
  }
  for (const m of t.matchAll(/\bano\s+de\s+(\d{4})\b/giu)) {
    candidatos.push(Number(m[1]));
  }
  const validos = candidatos.filter((a) => anoValido(a, anoAtual));
  return validos.length ? Math.min(...validos) : null;
}

/** Do mais específico para o mais geral: "licença de utilização" antes de "licença". */
const PALAVRAS_TIPO: [RegExp, TipoArquivo][] = [
  [/\bloteamento|\blotes?\s+de\s+terreno|\bdestaque\b/, 'loteamento'],
  [
    /\blicenca\s+de\s+(?:utilizacao|habitacao)|\balvara\s+de\s+(?:utilizacao|habitacao)|\bvistoria\s+(?:para|de)\s+habitacao/,
    'utilizacao',
  ],
  [/\bdemolicao|\bdemolir\b/, 'demolicao'],
  [/\bocupacao\s+(?:da|de)\s+via\s+publica|\btapume|\bandaime/, 'ocupacao_via'],
  [/\bpublicidade|\breclamo\s+luminoso|\bpainel\s+publicitario/, 'publicidade'],
  [
    /\blicenca\s+de\s+(?:construcao|obras?)|\balvara\s+de\s+(?:construcao|obras?|licenca)|\bconstrucao\s+de\b|\bconstruir\b|\bampliacao|\balteracao\s+d[ae]|\breconstrucao|\bobras?\s+de\b|\bprojecto\s+de\s+arquitectura|\bprojeto\s+de\s+arquitetura/,
    'obras',
  ],
];

export function lerTipo(texto: string): TipoArquivo | null {
  const t = semAcentos(texto);
  for (const [re, tipo] of PALAVRAS_TIPO) if (re.test(t)) return tipo;
  return null;
}

/** Palavras que antecedem o nome e não fazem parte dele. */
const ANTES_DO_NOME =
  /^(?:ex(?:cel[eê]nt[ií]ssim[oa]|\.?m[oa])\.?|senhor[a]?|sr\.?|sra\.?|presidente|c[aâ]mara|municipal|vereador[a]?|d[aeo]s?|e|dr\.?|dra\.?|eng\.?|.*\.)$/iu;

/** Tira tratamentos e instituições do início; pelo menos duas palavras. */
function limparNome(s: string): string | null {
  const palavras = (limpar(s, 160) ?? '').split(' ').filter(Boolean);
  while (palavras.length && ANTES_DO_NOME.test(palavras[0])) palavras.shift();
  while (
    palavras.length &&
    /^(?:d[aeo]s?|e)$/u.test(palavras[palavras.length - 1])
  ) {
    palavras.pop();
  }
  return palavras.length >= 2 ? palavras.join(' ').slice(0, 120) : null;
}

export function lerRequerente(texto: string): string | null {
  const t = numaLinha(texto);
  const padroes = [
    new RegExp(`\\brequerente\\s*[:\\-–]\\s*(${NOME})`, 'u'),
    new RegExp(`\\bRequerente\\s*[:\\-–]?\\s*(${NOME})`, 'u'),
    new RegExp(
      `\\b(?:requerido|requerida|apresentado|apresentada)\\s+por\\s+(${NOME})`,
      'u',
    ),
    new RegExp(`\\b(?:em\\s+nome\\s+de|titular)\\s*[:\\-–]?\\s*(${NOME})`, 'u'),
    // "José da Silva, casado, residente na Rua..." (o formato dos requerimentos)
    new RegExp(
      `(${NOME})\\s*,\\s*(?:[\\p{Ll}]+\\s*,\\s*){0,3}(?:residente|morador|moradora|contribuinte|portador|portadora)\\b`,
      'u',
    ),
  ];
  for (const re of padroes) {
    const m = re.exec(t);
    const nome = m && limparNome(m[1]);
    if (nome) return nome;
  }
  return null;
}

/** Fim de uma morada: pontuação forte ou o início do campo seguinte. */
const FIM_MORADA =
  '(?=\\s*(?:[;]|(?<!\\b(?:Dr|Dra|Eng|Prof|Sto|Sta|S|Av|R|Trav|Tv|Lg|D|N|Pe|Cel|Gen|Cap|Com|Pç|Estr))\\.(?:\\s|$)|,\\s*(?:(?:freguesia|concelho|distrito|deste|desta|com\\s+o|com\\s+a|vem|portador|portadora|contribuinte|nif|que|para|onde|sob)\\b|inscrit|requer)|\\s+(?:(?:freguesia|concelho|vem\\s+requerer|com\\s+a\\s+área)\\b|inscrit|requer))|$)';

export function lerMorada(texto: string): string | null {
  const t = numaLinha(texto);
  // O local da obra/prédio vale mais do que a residência do requerente.
  const prioridades = [
    `(?:local\\s+da\\s+obra|situad[oa]|sito|sita|prédio\\s+(?:urbano\\s+)?(?:sito|situado)?|localizad[oa]|terreno\\s+(?:sito|situado)?)\\s*(?:em|na|no|:)?\\s*`,
    `(?:morada|residente|morador|moradora|domiciliad[oa])\\s*(?:em|na|no|:)?\\s*`,
    '',
  ];
  for (const antes of prioridades) {
    const re = new RegExp(
      `${antes}((?:${TIPOS_DE_VIA})\\s+[^;]{2,120}?)${FIM_MORADA}`,
      'iu',
    );
    const m = re.exec(t);
    const morada = m && limpar(m[1], 160);
    if (morada) return morada.replace(/,\s*$/, '');
  }
  return null;
}

export function lerFreguesia(texto: string): string | null {
  const t = numaLinha(texto);
  const re = new RegExp(
    `\\bfreguesia\\s+(?:de\\s+|da\\s+|do\\s+|das\\s+|dos\\s+)?(${PALAVRA_NOME}(?:\\s+(?:${LIGACAO_NOME}\\s+)?${PALAVRA_NOME}){0,5})`,
    'u',
  );
  const m = re.exec(t) ?? new RegExp(re.source, 'iu').exec(t);
  return m ? limpar(m[1], 80) : null;
}

export function lerArtigoMatricial(texto: string): string | null {
  const t = numaLinha(texto);
  const re =
    /\b(?:artigo\s+matricial|inscrit[oa]\s+na\s+(?:respetiva\s+|respectiva\s+)?matriz[^.;]{0,80}?\bartigo|matriz\s+predial[^.;]{0,60}?\bartigo)\s*(?:urbano|rústico|rustico)?\s*(?:n\.?\s*[º°o]\.?\s*|número\s*)?(?:sob\s+o\s+)?((?:[UR]\s*-\s*)?\d{1,6}(?:\s*-\s*[A-Z])?)/iu;
  const m = re.exec(t);
  return m ? m[1].replace(/\s+/g, '').toUpperCase() : null;
}

/** Todos os metadados que se conseguem ler do texto. */
export function metadadosDoTexto(
  texto: string,
  anoAtual = new Date().getFullYear(),
): Metadados {
  const numero = lerNumeroAntigo(texto);
  return {
    numero_antigo: numero,
    ano: lerAno(texto, numero, anoAtual),
    tipo: lerTipo(texto),
    requerente: lerRequerente(texto),
    morada: lerMorada(texto),
    freguesia: lerFreguesia(texto),
    artigo_matricial: lerArtigoMatricial(texto),
  };
}

/** O que veio primeiro (IA) ganha; o resto completa (regras). */
export function juntarMetadados(
  primeiro: Metadados,
  depois: Metadados,
): Metadados {
  const fora = { ...METADADOS_VAZIOS };
  for (const c of CAMPOS_METADADOS) {
    (fora as unknown as Record<string, unknown>)[c] =
      primeiro[c] ?? depois[c] ?? null;
  }
  return fora;
}

// ---------------------------------------------------------------------------
// Moradas: "a mesma morada" entre o papel antigo e um processo novo
// ---------------------------------------------------------------------------

export interface ChaveMorada {
  /** 'rua santo antonio' (sem "de/da/do", abreviaturas por extenso). */
  rua: string;
  /** Número de polícia ('45', '12a'), se houver. */
  porta: string | null;
}

const ABREVIATURAS: [RegExp, string][] = [
  [/\br\.\s*/g, 'rua '],
  [/\bav(?:\.|a\b|\b)\s*/g, 'avenida '],
  [/\btrav\.\s*|\btv\.\s*/g, 'travessa '],
  [/\blg\.\s*/g, 'largo '],
  [/\bp[cç]\.\s*/g, 'praca '],
  [/\bestr\.\s*/g, 'estrada '],
  [/\bdr\.\s*/g, 'doutor '],
  [/\beng\.\s*/g, 'engenheiro '],
  [/\bsta\.\s*/g, 'santa '],
  [/\bsto\.\s*/g, 'santo '],
  [/\bs\.\s+/g, 'sao '],
];
const LIGACOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Chave de comparação de uma morada. "R. de Santo António, n.º 45, 1.º Esq."
 * e "Rua Santo Antonio 45" dão a mesma. null se não há rua que se perceba.
 */
export function chaveMorada(
  morada: string | null | undefined,
): ChaveMorada | null {
  if (!morada) return null;
  let t = morada
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[º°ª]/g, '');
  t = t.replace(/\b\d{4}\s*-\s*\d{3}\b.*$/, ''); // código postal e o resto
  for (const [re, por] of ABREVIATURAS) t = t.replace(re, por);
  t = t.replace(/\bn\.?\s*(?=\d)|\bnumero\s+|\bno\.\s*/g, ' ');
  const partes = t
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!partes.length) return null;
  let rua = partes[0];
  let porta: string | null = null;
  const noFim = /\s(\d{1,4}\s?[a-z]?)$/.exec(rua);
  if (noFim) {
    porta = noFim[1].replace(/\s/g, '');
    rua = rua.slice(0, noFim.index);
  } else if (partes[1]) {
    const m = /^(\d{1,4}\s?[a-z]?)\b/.exec(partes[1]);
    if (m) porta = m[1].replace(/\s/g, '');
  }
  const palavras = rua
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && !LIGACOES.has(p));
  const r = palavras.join(' ');
  if (r.replace(/\s/g, '').length < 3) return null;
  return { rua: r, porta };
}

/** Mesma rua e, se ambas tiverem número, o mesmo número. */
export function mesmaMorada(
  a: ChaveMorada | null,
  b: ChaveMorada | null,
): boolean {
  if (!a || !b || a.rua !== b.rua) return false;
  return !a.porta || !b.porta || a.porta === b.porta;
}

// ---------------------------------------------------------------------------
// Pesquisa pelo agente: o que a pessoa disse → termos a procurar
// ---------------------------------------------------------------------------

/** Palavras que não ajudam a distinguir um documento. */
const VAZIAS = new Set([
  ...LIGACOES,
  'rua',
  'avenida',
  'travessa',
  'largo',
  'praca',
  'lugar',
  'estrada',
  'caminho',
  'n',
  'numero',
  'casa',
  'predio',
  'o',
  'a',
  'os',
  'as',
  'em',
  'na',
  'no',
  'meu',
  'minha',
  'pai',
  'mae',
  'avo',
  'senhor',
  'senhora',
]);

export interface EntradaProcura {
  morada?: string | null;
  requerente?: string | null;
  numero_antigo?: string | null;
}

/**
 * Os termos (sem acentos) que um documento tem de ter todos para contar como
 * "provável". Da morada, a rua sem o tipo de via; do nome, cada palavra com
 * 3 letras ou mais; o número antigo tal como se normaliza nos documentos.
 */
export function termosProcura(e: EntradaProcura): string[] {
  const termos: string[] = [];
  const palavras = (s: string) =>
    semAcentos(s)
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((p) => p.length >= 3 && !VAZIAS.has(p));
  if (e.morada) {
    const k = chaveMorada(e.morada);
    termos.push(
      ...palavras(k?.rua ?? e.morada).filter((p) => !/^\d+$/.test(p)),
    );
  }
  if (e.requerente) termos.push(...palavras(e.requerente));
  if (e.numero_antigo) {
    const n = lerNumeroAntigo(`processo ${e.numero_antigo}`);
    if (n) termos.push(n);
    else termos.push(...palavras(e.numero_antigo));
  }
  return [...new Set(termos)].slice(0, 12);
}

/** Texto onde a pesquisa por termos procura: texto + metadados, sem acentos. */
export function textoPesquisa(texto: string | null, m: Metadados): string {
  return semAcentos(
    [
      m.numero_antigo,
      m.requerente,
      m.morada,
      m.freguesia,
      m.artigo_matricial,
      m.ano ? String(m.ano) : null,
      texto,
    ]
      .filter(Boolean)
      .join(' \n '),
  ).slice(0, 200_000);
}
