/*
 * Regras puras do turismo: língua, secções do texto das fontes e o roteiro
 * sugerido (tempo disponível, interesses, mobilidade). Sem BD.
 */
import { z } from 'zod';

export const LINGUAS = ['pt', 'en', 'es', 'fr'] as const;
export type Lingua = (typeof LINGUAS)[number];

export const INTERESSES = [
  'historia',
  'museus',
  'natureza',
  'gastronomia',
  'eventos',
] as const;
export type Interesse = (typeof INTERESSES)[number];

export type Acessibilidade = 'boa' | 'parcial' | 'dificil';

/** Um ponto do mapa (guardado em `fontes.turismo.pontos`, na língua da fonte). */
export interface Ponto {
  chave: string;
  nome: string;
  categoria: 'monumento' | 'museu' | 'natureza' | 'transporte';
  lat: number;
  lng: number;
  /** Tempo de visita estimado (demonstração). */
  minutos: number;
  /** Estimativa de demonstração, a confirmar com o turismo da câmara. */
  acessibilidade: Acessibilidade;
  interesses: Interesse[];
  /** Ordem a pé (do Toural ao castelo, depois museus, depois Penha). */
  ordem: number;
  /** Precisa de carro ou táxi (fora do centro). */
  fora_do_centro?: boolean;
  /** Imperdível: entra primeiro nos roteiros. */
  destaque?: boolean;
}

export const esquemaPonto = z.object({
  chave: z.string().min(1).max(60),
  nome: z.string().min(1).max(200),
  categoria: z.enum(['monumento', 'museu', 'natureza', 'transporte']),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  minutos: z.number().int().min(5).max(480),
  acessibilidade: z.enum(['boa', 'parcial', 'dificil']),
  interesses: z.array(z.enum(INTERESSES)),
  ordem: z.number().int(),
  fora_do_centro: z.boolean().optional(),
  destaque: z.boolean().optional(),
});

/** `fontes.turismo`: o tema e, nos temas com mapa, os pontos. */
export const esquemaMetaTurismo = z.object({
  tema: z.string().min(1).max(60),
  ordem: z.number().int().default(99),
  pontos: z.array(esquemaPonto).default([]),
});
export type MetaTurismo = z.output<typeof esquemaMetaTurismo>;

/** 'en-US' → 'en'; 'pt-PT' → 'pt'. Língua sem conteúdo → null. */
export function linguaDe(idioma: string | null | undefined): Lingua | null {
  const base = (idioma ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (LINGUAS as readonly string[]).includes(base)
    ? (base as Lingua)
    : null;
}

export interface Seccao {
  titulo: string | null;
  texto: string;
}

/** Parte o texto da fonte pelas secções "## Título" (a introdução vem sem título). */
export function seccoes(texto: string): Seccao[] {
  const fora: Seccao[] = [];
  let atual: { titulo: string | null; linhas: string[] } = {
    titulo: null,
    linhas: [],
  };
  const fechar = () => {
    const t = atual.linhas.join('\n').trim();
    if (t || atual.titulo) fora.push({ titulo: atual.titulo, texto: t });
  };
  for (const l of texto.replace(/\r\n?/g, '\n').split('\n')) {
    if (l.startsWith('## ')) {
      fechar();
      atual = { titulo: l.slice(3).trim(), linhas: [] };
    } else {
      atual.linhas.push(l);
    }
  }
  fechar();
  return fora;
}

/** Comparar nomes de secções e pontos sem acentos nem maiúsculas. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function linkMapa(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

// ---------------------------------------------------------------------
// Roteiro
// ---------------------------------------------------------------------

/** Tempos de deslocação estimados (demonstração). */
export const DESLOCACAO = {
  /** Entre dois pontos do centro, a pé. */
  centro_min: 5,
  /** Mais devagar com mobilidade reduzida. */
  centro_mobilidade_min: 10,
  /** Ida e volta de carro ou táxi a um ponto fora do centro. */
  fora_do_centro_min: 60,
  /** Só se propõe um ponto fora do centro com pelo menos este tempo. */
  minimo_fora_do_centro_min: 300,
} as const;

export interface PedidoRoteiro {
  minutos: number;
  interesses: Interesse[];
  mobilidade_reduzida: boolean;
}

export interface Paragem extends Ponto {
  /** Minutos desde o início do passeio até chegar aqui. */
  chegada_min: number;
}

export interface Roteiro {
  paragens: Paragem[];
  minutos_total: number;
  sobra_min: number;
  /** Pontos que ficaram de fora por causa da mobilidade. */
  excluidos_mobilidade: string[];
}

/**
 * 0 = não entra. Conta os interesses que o ponto tem (sem interesses, todos
 * valem 1); os imperdíveis e, com mobilidade reduzida, os de acesso fácil
 * passam à frente.
 */
function pontuacao(x: Ponto, p: PedidoRoteiro): number {
  if (x.categoria === 'transporte') return 0;
  const base = p.interesses.length
    ? x.interesses.filter((i) => p.interesses.includes(i)).length
    : 1;
  if (base === 0) return 0;
  return (
    base +
    (x.destaque ? 1 : 0) +
    (p.mobilidade_reduzida && x.acessibilidade === 'boa' ? 2 : 0)
  );
}

/**
 * Escolhe os pontos que cabem no tempo, os dos interesses primeiro, e
 * devolve-os pela ordem a pé. A Penha leva o teleférico antes. Com
 * mobilidade reduzida ficam de fora os de acesso difícil.
 */
export function sugerirRoteiro(pontos: Ponto[], p: PedidoRoteiro): Roteiro {
  const passo = p.mobilidade_reduzida
    ? DESLOCACAO.centro_mobilidade_min
    : DESLOCACAO.centro_min;
  const excluidos = p.mobilidade_reduzida
    ? pontos.filter((x) => x.acessibilidade === 'dificil').map((x) => x.nome)
    : [];
  const porChave = new Map(pontos.map((x) => [x.chave, x]));
  const custo = (x: Ponto) =>
    x.minutos + (x.fora_do_centro ? DESLOCACAO.fora_do_centro_min : passo);

  const candidatos = pontos
    .filter((x) => !(p.mobilidade_reduzida && x.acessibilidade === 'dificil'))
    .filter(
      (x) =>
        !x.fora_do_centro || p.minutos >= DESLOCACAO.minimo_fora_do_centro_min,
    )
    // O teleférico (transporte) entra com a Penha, não sozinho.
    .map((x) => ({ x, s: pontuacao(x, p) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || a.x.ordem - b.x.ordem);

  const escolhidos: Ponto[] = [];
  let usado = 0;
  for (const { x } of candidatos) {
    const extras: Ponto[] = [];
    if (x.chave === 'penha') {
      const t = porChave.get('teleferico');
      if (t && !(p.mobilidade_reduzida && t.acessibilidade === 'dificil'))
        extras.push(t);
    }
    const c = [x, ...extras].reduce((s, y) => s + custo(y), 0);
    if (usado + c > p.minutos) continue;
    escolhidos.push(x, ...extras);
    usado += c;
  }

  escolhidos.sort((a, b) => a.ordem - b.ordem);
  let relogio = 0;
  const paragens = escolhidos.map((x, i) => {
    if (i > 0)
      relogio += x.fora_do_centro ? DESLOCACAO.fora_do_centro_min / 2 : passo;
    const par = { ...x, chegada_min: relogio };
    relogio += x.minutos;
    return par;
  });
  return {
    paragens,
    minutos_total: usado,
    sobra_min: Math.max(0, p.minutos - usado),
    excluidos_mobilidade: excluidos,
  };
}

/** Roteiros prontos da página /visitar (os mesmos da ferramenta). */
export const ROTEIROS_PRONTOS: {
  chave: string;
  pedido: PedidoRoteiro;
}[] = [
  {
    chave: 'duas_horas',
    pedido: {
      minutos: 120,
      interesses: ['historia'],
      mobilidade_reduzida: false,
    },
  },
  {
    chave: 'meio_dia',
    pedido: {
      minutos: 240,
      interesses: ['historia', 'museus'],
      mobilidade_reduzida: false,
    },
  },
  {
    chave: 'dia_inteiro',
    pedido: {
      minutos: 420,
      interesses: ['historia', 'natureza', 'museus'],
      mobilidade_reduzida: false,
    },
  },
  {
    chave: 'sem_degraus',
    pedido: { minutos: 180, interesses: [], mobilidade_reduzida: true },
  },
];
