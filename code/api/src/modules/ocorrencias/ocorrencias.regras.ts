/*
 * Regras puras das ocorrências (sem BD nem rede): distâncias, numeração,
 * escolher a categoria a partir do que o munícipe disse e o estado em
 * linguagem simples. Testadas em ocorrencias.regras.spec.ts.
 */

export type EstadoOcorrencia =
  'nova' | 'com_equipa' | 'resolvida' | 'duplicada' | 'rejeitada';

export const ESTADOS_OCORRENCIA = [
  'nova',
  'com_equipa',
  'resolvida',
  'duplicada',
  'rejeitada',
] as const satisfies readonly EstadoOcorrencia[];

/** Estados em que ainda se junta um aviso novo ao original. */
export const ESTADOS_ABERTOS: readonly EstadoOcorrencia[] = [
  'nova',
  'com_equipa',
];

/** "O mesmo buraco": raio e janela para detetar duplicados. */
export const RAIO_DUPLICADO_M = 50;
export const JANELA_DUPLICADO_DIAS = 7;

export const MAX_FOTOS = 5;

const RAIO_TERRA_M = 6_371_000;

/** Distância em metros entre dois pontos (haversine). */
export function distanciaMetros(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Caixa à volta de um ponto que contém o círculo de `metros`: filtra pelo
 * índice (lat, lng) antes de calcular a distância exata.
 */
export function caixaEnvolvente(
  p: { lat: number; lng: number },
  metros: number,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = (metros / RAIO_TERRA_M) * (180 / Math.PI);
  const dLng = dLat / Math.max(Math.cos((p.lat * Math.PI) / 180), 0.01);
  return {
    minLat: p.lat - dLat,
    maxLat: p.lat + dLat,
    minLng: p.lng - dLng,
    maxLng: p.lng + dLng,
  };
}

/** 381 → 'OC-0381'. */
export function formatarNumero(n: number): string {
  return `OC-${String(n).padStart(4, '0')}`;
}

/** 'oc 381', 'OC-0381', '381', 'o c três…' (só dígitos contam) → 'OC-0381'. */
export function normalizarNumero(texto: string): string | null {
  const digitos = texto.replace(/\D/g, '');
  if (!digitos || digitos.length > 9) return null;
  return formatarNumero(Number(digitos));
}

/** Minúsculas, sem acentos nem pontuação, espaços simples. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PALAVRAS_VAZIAS = new Set([
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
  'com',
  'sem',
  'para',
  'por',
  'ha',
  'tem',
  'esta',
  'muito',
  'outro',
  'outros',
]);

/*
 * Como as pessoas dizem ao telefone → palavras que costumam estar no nome das
 * categorias. É português, não é de nenhuma câmara: os nomes das categorias
 * vêm sempre dos dados de cada município.
 */
const SINONIMOS: Record<string, string[]> = {
  buraco: ['via', 'pavimento', 'estrada'],
  cova: ['buraco', 'via', 'pavimento'],
  alcatrao: ['pavimento', 'via'],
  estrada: ['via', 'pavimento'],
  rua: ['via'],
  passeio: ['via', 'pavimento'],
  calcada: ['passeio', 'via', 'pavimento'],
  candeeiro: ['iluminacao', 'publica'],
  poste: ['iluminacao'],
  lampada: ['iluminacao'],
  luz: ['iluminacao'],
  escuro: ['iluminacao'],
  apagado: ['iluminacao'],
  lixo: ['residuos', 'limpeza', 'contentor'],
  contentor: ['residuos', 'lixo'],
  ecoponto: ['residuos', 'contentor', 'reciclagem'],
  entulho: ['residuos', 'monos'],
  sofa: ['monos', 'residuos'],
  movel: ['monos', 'residuos'],
  colchao: ['monos', 'residuos'],
  arvore: ['espacos', 'verdes', 'arvores'],
  ramo: ['arvores', 'espacos', 'verdes'],
  relva: ['espacos', 'verdes', 'jardim'],
  jardim: ['espacos', 'verdes'],
  semaforo: ['sinalizacao'],
  sinal: ['sinalizacao'],
  placa: ['sinalizacao'],
  sarjeta: ['saneamento', 'esgoto', 'aguas'],
  esgoto: ['saneamento', 'aguas'],
  cheiro: ['saneamento', 'esgoto'],
  fuga: ['agua', 'aguas', 'abastecimento'],
  cano: ['agua', 'aguas', 'abastecimento'],
  inundacao: ['aguas', 'pluviais', 'saneamento'],
  grafiti: ['vandalismo', 'limpeza'],
  graffiti: ['vandalismo', 'limpeza'],
  carro: ['abandonado', 'veiculo', 'viaturas'],
  abandonado: ['veiculo', 'viaturas'],
  animal: ['animais'],
  cao: ['animais'],
  rato: ['pragas', 'animais'],
  ratos: ['pragas', 'animais'],
};

function palavras(texto: string): string[] {
  return normalizarTexto(texto)
    .split(' ')
    .filter((p) => p.length > 1 && !PALAVRAS_VAZIAS.has(p));
}

/** 'buracos' ≈ 'buraco', 'arvores' ≈ 'arvore': plural e variações curtas. */
function parecidas(a: string, b: string): boolean {
  if (a === b) return true;
  const [curta, longa] = a.length <= b.length ? [a, b] : [b, a];
  return (
    curta.length >= 4 &&
    longa.startsWith(curta) &&
    longa.length - curta.length <= 2
  );
}

export interface CategoriaBase {
  id: string;
  nome: string;
}

/**
 * A categoria que melhor corresponde ao que o munícipe disse ('há um buraco
 * enorme na estrada' → 'Buraco na via'). Palavras ditas valem mais do que
 * sinónimos. Sem correspondência ou com empate → null (o agente pergunta).
 */
export function melhorCategoria<C extends CategoriaBase>(
  texto: string,
  categorias: readonly C[],
): C | null {
  const alvo = normalizarTexto(texto);
  if (!alvo) return null;
  const exata = categorias.find((c) => normalizarTexto(c.nome) === alvo);
  if (exata) return exata;

  const ditas = palavras(texto);
  const expandidas = ditas.flatMap((p) => SINONIMOS[p] ?? []);

  let melhor: C | null = null;
  let melhorPontos = 0;
  let empate = false;
  for (const c of categorias) {
    const doNome = palavras(c.nome);
    if (!doNome.length) continue;
    let pontos = 0;
    for (const p of doNome) {
      if (ditas.some((d) => parecidas(d, p))) pontos += 2;
      else if (expandidas.some((s) => parecidas(s, p))) pontos += 1;
    }
    // Normalizar pelo tamanho do nome: 'Iluminação' não perde para
    // 'Iluminação pública e semáforos' só por ter menos palavras.
    const nota = pontos / Math.sqrt(doNome.length);
    if (nota > melhorPontos) {
      melhor = c;
      melhorPontos = nota;
      empate = false;
    } else if (nota > 0 && nota === melhorPontos) {
      empate = true;
    }
  }
  return empate ? null : melhor;
}

/** O estado como o agente o diz ao munícipe. */
export function estadoEmLinguagemSimples(o: {
  estado: EstadoOcorrencia;
  prevista_para: string | null;
  resolvida_em: Date | string | null;
}): string {
  const data = (d: Date | string) => {
    const iso = d instanceof Date ? d.toISOString() : d;
    const [a, m, dia] = iso.slice(0, 10).split('-');
    return `${dia}/${m}/${a}`;
  };
  switch (o.estado) {
    case 'nova':
      return 'Está registada e à espera de ser vista pela equipa responsável.';
    case 'com_equipa':
      return o.prevista_para
        ? `Já está com a equipa responsável, com intervenção prevista para ${data(o.prevista_para)}.`
        : 'Já está com a equipa responsável, ainda sem data prevista.';
    case 'resolvida':
      return o.resolvida_em
        ? `Foi resolvida a ${data(o.resolvida_em)}.`
        : 'Foi resolvida.';
    case 'rejeitada':
      return 'Foi analisada e não vai ter intervenção da câmara.';
    case 'duplicada':
      return 'Foi juntada a outra ocorrência igual no mesmo sítio.';
  }
}

/** Fotografias aceites e a extensão do ficheiro. */
export const MIME_FOTOS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};
