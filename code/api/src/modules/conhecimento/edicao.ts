import type { Perfil } from '../auth/permissoes.js';

/*
 * Edição das respostas curadas pela câmara (V2, secção 12 das
 * funcionalidades). Na V1 só a equipa interna escrevia; agora o chefe de
 * divisão também, com dupla verificação:
 *
 * 1. Toda a versão escrita pela câmara fica 'em_revisao' até ir para o ar.
 * 2. Publicar exige sempre o gate do avaliador (`avaliacao.ts`: execução da
 *    versão atual do agente com taxa ≥ 80%), tal como para a equipa.
 * 3. Se a versão da câmara mudar factos (números, prazos, telefones, emails)
 *    face à versão no ar (ou à anterior, se nenhuma estiver no ar), precisa
 *    ainda da aprovação da equipa interna OU de uma execução do avaliador
 *    iniciada depois de a versão ser escrita.
 *
 * `precisaDe` diz o que falta: 'avaliacao' (o gate não deixa) e/ou
 * 'revisao_interna' (factos mudados sem revisão nem avaliação posterior; uma
 * avaliação nova que passe resolve as duas). Lista vazia: pode publicar.
 */

export type Origem = 'equipa' | 'camara';
export type Requisito = 'avaliacao' | 'revisao_interna';
export type Revisao = 'aprovada' | 'rejeitada';

export function interno(perfil: Perfil): boolean {
  return perfil === 'admin' || perfil === 'equipa_toucamara';
}

/** Quem escreveu a versão: a equipa interna ou a câmara. */
export function origemDe(perfil: Perfil): Origem {
  return interno(perfil) ? 'equipa' : 'camara';
}

// ---------------------------------------------------------------------------
// Factos: números (com horas e números por extenso), telefones e emails
// ---------------------------------------------------------------------------

export interface Factos {
  numeros: string[];
  telefones: string[];
  emails: string[];
}

export interface DiffFactos {
  muda: boolean;
  adicionados: Factos;
  removidos: Factos;
}

const EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu;
// Telefones portugueses: 9 algarismos a começar por 2, 3, 8 ou 9, com ou sem
// +351 e espaços/pontos/hífens aos grupos de 3 (253 000 000, 800-111-222).
const TELEFONE =
  /(?<![\d,.])(?:(?:\+|00)351[\s.-]?)?([2389]\d{2})[\s.-]?(\d{3})[\s.-]?(\d{3})(?![\d])/g;
// 9:00, 9h00, 9h30, 9h (depois dos telefones, antes dos números soltos).
const HORA = /(?<![\d,.])(\d{1,2})(?::(\d{2})|h(\d{2})?)(?![\p{L}\d])/giu;
const NUMERO = /\d+(?:[.,]\d+)*/g;

const POR_EXTENSO: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  três: 3,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  catorze: 14,
  quatorze: 14,
  quinze: 15,
  dezasseis: 16,
  dezesseis: 16,
  dezassete: 17,
  dezessete: 17,
  dezoito: 18,
  dezanove: 19,
  dezenove: 19,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
  mil: 1000,
};

/** '1.500' → '1500'; '4,50' fica; zeros à esquerda saem ('09' → '9'). */
function normalizarNumero(n: string): string {
  let s = /^\d{1,3}(?:\.\d{3})+$/.test(n) ? n.replace(/\./g, '') : n;
  s = s.replace(/^0+(?=\d)/, '');
  return s;
}

/**
 * Números por extenso ("vinte e cinco dias", "às nove"), em algarismos. Um
 * "um"/"uma" sozinho é artigo, não conta.
 */
function numerosPorExtenso(texto: string): string[] {
  const palavras = texto.toLowerCase().split(/[^\p{L}\d]+/u);
  const r: string[] = [];
  let i = 0;
  while (i < palavras.length) {
    if (!(palavras[i] in POR_EXTENSO)) {
      i++;
      continue;
    }
    let total = 0;
    let atual = 0;
    let n = 0;
    let soArtigo = true;
    while (i < palavras.length) {
      const p = palavras[i];
      if (p in POR_EXTENSO) {
        const v = POR_EXTENSO[p];
        if (p !== 'um' && p !== 'uma') soArtigo = false;
        if (v === 1000) {
          total += (atual || 1) * 1000;
          atual = 0;
        } else {
          atual += v;
        }
        n++;
        i++;
      } else if (
        p === 'e' &&
        n > 0 &&
        i + 1 < palavras.length &&
        palavras[i + 1] in POR_EXTENSO
      ) {
        i++;
      } else {
        break;
      }
    }
    if (n === 1 && soArtigo) continue;
    r.push(String(total + atual));
  }
  return r;
}

function unicos(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

/** Os factos de um texto, normalizados (sem repetidos, por ordem). */
export function extrairFactos(texto: string | null | undefined): Factos {
  let resto = texto ?? '';
  const emails: string[] = [];
  resto = resto.replace(EMAIL, (e) => {
    emails.push(e.toLowerCase());
    return ' ';
  });
  const telefones: string[] = [];
  resto = resto.replace(TELEFONE, (_t, a: string, b: string, c: string) => {
    telefones.push(`${a}${b}${c}`);
    return ' ';
  });
  const numeros: string[] = [];
  resto = resto.replace(
    HORA,
    (_h, hh: string, m1: string | undefined, m2: string | undefined) => {
      numeros.push(`${Number(hh)}h${m1 ?? m2 ?? '00'}`);
      return ' ';
    },
  );
  for (const n of resto.match(NUMERO) ?? []) numeros.push(normalizarNumero(n));
  numeros.push(...numerosPorExtenso(resto));
  return {
    numeros: unicos(numeros),
    telefones: unicos(telefones),
    emails: unicos(emails),
  };
}

/** O que entra e sai de factos de `antes` para `depois` (sem base: tudo entra). */
export function diffFactos(
  antes: string | null | undefined,
  depois: string,
): DiffFactos {
  const a = extrairFactos(antes);
  const d = extrairFactos(depois);
  const menos = (x: string[], y: string[]) => x.filter((v) => !y.includes(v));
  const adicionados: Factos = {
    numeros: menos(d.numeros, a.numeros),
    telefones: menos(d.telefones, a.telefones),
    emails: menos(d.emails, a.emails),
  };
  const removidos: Factos = {
    numeros: menos(a.numeros, d.numeros),
    telefones: menos(a.telefones, d.telefones),
    emails: menos(a.emails, d.emails),
  };
  const muda = [adicionados, removidos].some(
    (f) => f.numeros.length + f.telefones.length + f.emails.length > 0,
  );
  return { muda, adicionados, removidos };
}

/** Texto de uma versão para comparar factos: voz e SMS juntos. */
export function textoDaVersao(v: {
  texto_voz: string;
  texto_sms?: string | null;
}): string {
  return v.texto_sms ? `${v.texto_voz}\n${v.texto_sms}` : v.texto_voz;
}

// ---------------------------------------------------------------------------
// Diferenças por frase (histórico de versões)
// ---------------------------------------------------------------------------

export type PassoDiff =
  | { tipo: 'igual'; frase: string }
  | { tipo: 'alterada'; antes: string; depois: string }
  | { tipo: 'removida'; antes: string }
  | { tipo: 'adicionada'; depois: string };

/** Frases de um texto: corta depois de . ! ? … e nas mudanças de linha. */
export function dividirFrases(texto: string | null | undefined): string[] {
  return (texto ?? '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((f) => f.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Diferença por frase entre duas versões (LCS). Uma frase removida seguida
 * de uma adicionada no mesmo sítio é uma 'alterada' (antes/depois).
 */
export function diffFrases(
  antes: string | null | undefined,
  depois: string | null | undefined,
): PassoDiff[] {
  const a = dividirFrases(antes);
  const b = dividirFrases(depois);
  // lcs[i][j] = maior subsequência comum de a[i..] e b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const passos: PassoDiff[] = [];
  let removidas: string[] = [];
  let adicionadas: string[] = [];
  const despejar = () => {
    const pares = Math.min(removidas.length, adicionadas.length);
    for (let k = 0; k < pares; k++) {
      passos.push({
        tipo: 'alterada',
        antes: removidas[k],
        depois: adicionadas[k],
      });
    }
    for (const x of removidas.slice(pares))
      passos.push({ tipo: 'removida', antes: x });
    for (const x of adicionadas.slice(pares))
      passos.push({ tipo: 'adicionada', depois: x });
    removidas = [];
    adicionadas = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      despejar();
      passos.push({ tipo: 'igual', frase: a[i] });
      i++;
      j++;
    } else if (
      j < b.length &&
      (i >= a.length || lcs[i][j + 1] >= lcs[i + 1][j])
    ) {
      adicionadas.push(b[j++]);
    } else {
      removidas.push(a[i++]);
    }
  }
  despejar();
  return passos;
}

// ---------------------------------------------------------------------------
// O que falta para publicar
// ---------------------------------------------------------------------------

export interface VersaoRevisao {
  origem: Origem;
  muda_factos: boolean;
  revisao: Revisao | null;
  criada_em: Date | string;
}

export interface GateAtual {
  /** O gate do avaliador deixa publicar (`decidirPublicacao`). */
  permitir: boolean;
  /** Início da execução que o deixa (só conta com `permitir`). */
  execucao_iniciada_em: Date | string | null;
}

/** O que falta para a versão poder ir para o ar (vazio: pode). */
export function precisaDe(v: VersaoRevisao, gate: GateAtual): Requisito[] {
  const r: Requisito[] = [];
  if (!gate.permitir) r.push('avaliacao');
  if (v.origem === 'camara' && v.muda_factos && v.revisao !== 'aprovada') {
    const avaliadaDepois =
      gate.permitir &&
      gate.execucao_iniciada_em !== null &&
      new Date(gate.execucao_iniciada_em).getTime() >
        new Date(v.criada_em).getTime();
    if (!avaliadaDepois) r.push('revisao_interna');
  }
  return r;
}

export type EstadoVersao =
  'no_ar' | 'publicada' | 'rejeitada' | 'em_revisao' | 'rascunho';

/**
 * no_ar: é a versão no ar; publicada: já esteve; rejeitada: a equipa
 * recusou-a; em_revisao: escrita pela câmara, à espera de ir para o ar;
 * rascunho: escrita pela equipa (ou proposta automática), por publicar.
 */
export function estadoVersao(
  v: {
    origem: Origem;
    revisao: Revisao | null;
    publicada_em: Date | string | null;
  },
  noAr: boolean,
): EstadoVersao {
  if (noAr) return 'no_ar';
  if (v.publicada_em) return 'publicada';
  if (v.revisao === 'rejeitada') return 'rejeitada';
  return v.origem === 'camara' ? 'em_revisao' : 'rascunho';
}
