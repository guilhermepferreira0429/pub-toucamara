/*
 * Regras puras da fonte "todas as pessoas na zona" (operadores móveis) e do
 * cell broadcast, na versão SIMULADA: quantas pessoas há na zona, quantos
 * números se geram e quais (sempre os mesmos para a mesma zona), em páginas.
 * Sem BD nem rede. Testadas em operadores.regras.spec.ts.
 *
 * Os números gerados são FALSOS mas têm a forma de telemóveis portugueses:
 * podem coincidir com números reais de pessoas. Por isso cada um vai marcado
 * `simulado` e a barreira no envio (MensagensService, ChamadasSaidaService)
 * nunca os deixa sair para o Twilio nem para o ElevenLabs.
 */
import { createHash } from 'crypto';
import type { Geometria } from '../avisos-zona/avisos-zona.regras.js';
import { normalizarTexto } from '../ocorrencias/ocorrencias.regras.js';
import { freguesiaNaLista, GeometriaEmergencia } from './emergencias.regras.js';

// ---------------------------------------------------------------------
// População (VALORES DE DEMONSTRAÇÃO)
// ---------------------------------------------------------------------

/**
 * População por freguesia: VALORES DE DEMONSTRAÇÃO, arredondados, para a
 * simulação dar números proporcionais à zona. NÃO são os Censos 2021: para a
 * versão real substituir pelos resultados definitivos dos Censos 2021 do INE
 * por freguesia (quadro "População residente" por freguesia, CAOP 2013), ou
 * usar a contagem que o operador devolve.
 */
export const POPULACAO_DEMONSTRACAO = {
  demonstracao: true,
  fonte:
    'Valores de demonstração arredondados (não são os Censos 2021). Substituir pelos Censos 2021 do INE por freguesia.',
  /** Freguesia que não está na tabela. */
  por_omissao_freguesia: 3_000,
  /** Zona desenhada no mapa: pessoas por km². */
  densidade_por_km2: 650,
  /** Fração das pessoas com telemóvel ligado na zona. */
  fracao_com_telemovel: 0.9,
  freguesias: {
    Azurém: 9_500,
    Creixomil: 9_000,
    Urgezes: 4_500,
    Fermentões: 5_000,
    Ponte: 4_000,
    Silvares: 2_500,
    Polvoreira: 3_000,
    Caldelas: 4_500,
    Brito: 4_000,
    Serzedelo: 3_500,
    Lordelo: 4_000,
    'Moreira de Cónegos': 4_500,
    Ronfe: 4_500,
    Pinheiro: 2_000,
    Costa: 3_500,
    'Mesão Frio': 2_500,
    'São Torcato': 2_500,
    'União das Freguesias de Oliveira, São Paio e São Sebastião': 6_000,
  } as Record<string, number>,
} as const;

/** Escala por omissão da simulação: gera 2 em cada 100 números estimados. */
export const ESCALA_OMISSAO = 0.02;
/** Páginas pedidas à fonte de cada vez. */
export const TAMANHO_PAGINA = 500;
/** Tentativas por página antes de dar a fonte como em erro. */
export const TENTATIVAS_PAGINA = 3;

export interface ZonaEstimada {
  /** Freguesia, ou "Área do mapa". */
  zona: string;
  pessoas: number;
  com_telemovel: number;
  /** A freguesia não está na tabela: usou-se o valor por omissão. */
  valor_por_omissao: boolean;
}

export interface EstimativaZona {
  pessoas: number;
  com_telemovel: number;
  por_zona: ZonaEstimada[];
  demonstracao: true;
  fonte: string;
}

const R_TERRA_KM = 6_371;

/** Área (km²) de um polígono em lat/lng (projeção local: escala de cidade). */
export function areaPoligonoKm2(
  pontos: readonly { lat: number; lng: number }[],
): number {
  if (pontos.length < 3) return 0;
  const lat0 =
    (pontos.reduce((s, p) => s + p.lat, 0) / pontos.length) * (Math.PI / 180);
  const kmLat = (Math.PI / 180) * R_TERRA_KM;
  const kmLng = kmLat * Math.cos(lat0);
  let soma = 0;
  for (let i = 0; i < pontos.length; i++) {
    const a = pontos[i];
    const b = pontos[(i + 1) % pontos.length];
    soma += a.lng * kmLng * (b.lat * kmLat) - b.lng * kmLng * (a.lat * kmLat);
  }
  return Math.abs(soma) / 2;
}

/** Área (km²) da zona desenhada (polígono e/ou círculos). */
export function areaKm2(g: Geometria): number {
  const circulos = g.circulos.reduce(
    (s, c) => s + Math.PI * (c.raio_m / 1000) ** 2,
    0,
  );
  return circulos + (g.poligono ? areaPoligonoKm2(g.poligono) : 0);
}

/** A população da freguesia na tabela de demonstração (ou null). */
export function populacaoFreguesia(nome: string): number | null {
  for (const [f, n] of Object.entries(POPULACAO_DEMONSTRACAO.freguesias)) {
    if (freguesiaNaLista(nome, [f])) return n;
  }
  return null;
}

/**
 * Quantas pessoas (e telemóveis) há na zona: por freguesia, pela tabela de
 * demonstração; no mapa, pela área × densidade de demonstração.
 */
export function estimarZona(z: GeometriaEmergencia): EstimativaZona {
  const p = POPULACAO_DEMONSTRACAO;
  const por_zona: ZonaEstimada[] = [];
  if (z.freguesias) {
    for (const f of z.freguesias) {
      const n = populacaoFreguesia(f);
      const pessoas = n ?? p.por_omissao_freguesia;
      por_zona.push({
        zona: f,
        pessoas,
        com_telemovel: Math.round(pessoas * p.fracao_com_telemovel),
        valor_por_omissao: n === null,
      });
    }
  } else if (z.geo) {
    const pessoas = Math.round(areaKm2(z.geo) * p.densidade_por_km2);
    por_zona.push({
      zona: 'Área do mapa',
      pessoas,
      com_telemovel: Math.round(pessoas * p.fracao_com_telemovel),
      valor_por_omissao: false,
    });
  }
  return {
    pessoas: por_zona.reduce((s, x) => s + x.pessoas, 0),
    com_telemovel: por_zona.reduce((s, x) => s + x.com_telemovel, 0),
    por_zona,
    demonstracao: true,
    fonte: p.fonte,
  };
}

// ---------------------------------------------------------------------
// Números gerados (determinísticos)
// ---------------------------------------------------------------------

/**
 * Formato dos números simulados: +351 9X 99N NNNN (X = 1, 2, 3 ou 6). O
 * "99" depois do indicativo do operador é a marca. São números com a forma
 * de telemóveis reais: o que os protege é a marca `simulado` em cada
 * registo, não o formato.
 */
export const FORMATO_SIMULADO = /^\+3519[1236]99\d{5}$/;
const OPERADORES = ['1', '2', '3', '6'] as const;
/** Quantos números diferentes o formato permite. */
export const ESPACO_SIMULADO = OPERADORES.length * 100_000;

function hash32(texto: string, sal = ''): number {
  return createHash('sha256')
    .update(`${sal}|${texto}`)
    .digest()
    .readUInt32BE(0);
}

function mdc(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Semente da zona: o município e a zona (freguesia ou geometria). */
export function semente(municipioId: string, zona: string): string {
  return `${municipioId}|${zona}`;
}

/**
 * O i-ésimo número da semente (0 ≤ i < ESPACO_SIMULADO). Uma permutação
 * afim do espaço (a·i + b mod N, com a primo com N): a mesma semente dá
 * sempre os mesmos números e nunca o mesmo número duas vezes.
 */
export function numeroSimulado(seed: string, i: number): string {
  const N = ESPACO_SIMULADO;
  let a = (hash32(seed, 'a') % (N - 1)) + 1;
  while (mdc(a, N) !== 1) a = (a % (N - 1)) + 1;
  const b = hash32(seed, 'b') % N;
  const v = (((a * i) % N) + b) % N;
  const op = OPERADORES[v % OPERADORES.length];
  const resto = String(Math.floor(v / OPERADORES.length)).padStart(5, '0');
  return `+3519${op}99${resto}`;
}

/** Quantos números a simulação gera para `comTelemovel` pessoas. */
export function quantosGerar(comTelemovel: number, escala: number): number {
  const e = Number.isFinite(escala) ? Math.min(Math.max(escala, 0), 1) : 0;
  return Math.min(Math.round(comTelemovel * e), ESPACO_SIMULADO);
}

/** Um pedaço da zona com a sua semente e quantos números tem. */
export interface Segmento {
  zona: string;
  seed: string;
  total: number;
}

/** Os segmentos da zona (um por freguesia, ou um para o mapa). */
export function segmentos(
  municipioId: string,
  z: GeometriaEmergencia,
  escala: number,
): Segmento[] {
  const e = estimarZona(z);
  // Forma canónica (a geometria volta da BD em jsonb: não confiar na ordem
  // das chaves nem nas casas decimais).
  const p6 = (x: number) => x.toFixed(6);
  const chaveMapa = z.geo
    ? [
        ...z.geo.circulos.map((c) => `c${p6(c.lat)},${p6(c.lng)},${c.raio_m}`),
        ...(z.geo.poligono ?? []).map((p) => `p${p6(p.lat)},${p6(p.lng)}`),
      ].join(';')
    : '';
  return e.por_zona.map((x) => ({
    zona: x.zona,
    seed: semente(
      municipioId,
      z.freguesias
        ? `freguesia:${normalizarTexto(x.zona).replace(/^freguesia d[aeo]s? /, '')}`
        : `mapa:${chaveMapa}`,
    ),
    total: quantosGerar(x.com_telemovel, escala),
  }));
}

export interface NumeroGerado {
  telefone_e164: string;
  zona_aproximada: string;
}

/**
 * Uma página do fluxo: os números a partir de `inicio` (índice global sobre
 * os segmentos, por ordem), no máximo `tamanho`. `seguinte` é null no fim.
 */
export function paginaSimulada(
  segs: readonly Segmento[],
  inicio: number,
  tamanho: number,
): { numeros: NumeroGerado[]; seguinte: number | null } {
  const numeros: NumeroGerado[] = [];
  const total = segs.reduce((s, x) => s + x.total, 0);
  let i = Math.max(0, inicio);
  while (i < total && numeros.length < tamanho) {
    let resto = i;
    let k = 0;
    while (resto >= segs[k].total) {
      resto -= segs[k].total;
      k++;
    }
    numeros.push({
      telefone_e164: numeroSimulado(segs[k].seed, resto),
      zona_aproximada: segs[k].zona,
    });
    i++;
  }
  return { numeros, seguinte: i < total ? i : null };
}

/**
 * A página `n` falha de propósito na tentativa `t`? Determinístico (mesma
 * zona, mesma página e tentativa → mesmo resultado), para o plano e o envio
 * darem o mesmo número; `taxa` entre 0 e 1.
 */
export function falhaSimulada(
  seed: string,
  pagina: number,
  tentativa: number,
  taxa: number,
): boolean {
  if (!(taxa > 0)) return false;
  if (taxa >= 1) return true;
  return hash32(`${seed}|${pagina}|${tentativa}`, 'falha') / 2 ** 32 < taxa;
}

// ---------------------------------------------------------------------
// Cell broadcast (simulado)
// ---------------------------------------------------------------------

export const ESTADOS_DIFUSAO = [
  'por_pedir',
  'pedida',
  'em_difusao',
  'concluida',
  'recusada',
  'erro',
  'cancelada',
] as const;
export type EstadoDifusao = (typeof ESTADOS_DIFUSAO)[number];

/** Duração da difusão simulada: VALORES DE DEMONSTRAÇÃO. */
export const DIFUSAO_DEMONSTRACAO = {
  segundos_ate_difundir: 10,
  minutos_em_difusao: 30,
  demonstracao: true,
} as const;

/**
 * O estado da difusão simulada pelo tempo passado desde o pedido: pedida →
 * em difusão (depois de uns segundos) → concluída (depois da duração).
 */
export function estadoDifusaoSimulada(
  pedidaEm: Date,
  agora: Date,
): {
  estado: EstadoDifusao;
  iniciada_em: Date | null;
  concluida_em: Date | null;
} {
  const d = DIFUSAO_DEMONSTRACAO;
  const inicio = new Date(pedidaEm.getTime() + d.segundos_ate_difundir * 1000);
  const fim = new Date(inicio.getTime() + d.minutos_em_difusao * 60_000);
  if (agora < inicio)
    return { estado: 'pedida', iniciada_em: null, concluida_em: null };
  if (agora < fim)
    return { estado: 'em_difusao', iniciada_em: inicio, concluida_em: null };
  return { estado: 'concluida', iniciada_em: inicio, concluida_em: fim };
}

/** Referência de demonstração do pedido de difusão: CB-DEMO-XXXXXXXX. */
export function referenciaDifusaoDemo(emergenciaId: string): string {
  return `CB-DEMO-${emergenciaId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
