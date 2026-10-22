/*
 * Perguntas antigas de DEMONSTRAÇÃO ("o que posso fazer nesta morada"),
 * para a simulação das regras de uma zona ter com que trabalhar. Numa
 * câmara a sério são as perguntas que as pessoas fizeram ao agente; aqui
 * são inventadas, sempre as mesmas (gerador com semente), com moradas
 * dentro das quatro zonas de demonstração, e marcadas como demonstração.
 */
import { somarDias } from '../licencas/comum.js';
import { Obra, Ponto, ZONAS_DEMONSTRACAO, zonaDe } from './regras.js';

export interface ConsultaDemonstracao {
  morada: string;
  lat: number;
  lng: number;
  obra: Obra;
  medidas: { area_m2?: number; altura_m?: number };
  /** Instante da pergunta (ISO). */
  criada_em: string;
  /** A zona de demonstração onde o ponto cai (CH, ERC, EA, EF). */
  zona: string;
}

/** Gerador pseudo-aleatório com semente (mulberry32). */
function gerador(semente: number) {
  let s = semente >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const entre = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
  const um = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const pesado = <T>(xs: readonly (readonly [T, number])[]): T => {
    const total = xs.reduce((s2, [, p]) => s2 + p, 0);
    let x = r() * total;
    for (const [v, p] of xs) {
      if ((x -= p) < 0) return v;
    }
    return xs[xs.length - 1][0];
  };
  return { r, entre, um, pesado };
}

/** Ruas e freguesias de cada zona de demonstração (as moradas são inventadas). */
const RUAS: Record<string, { ruas: string[]; freguesia: string }> = {
  CH: {
    ruas: [
      'Rua de Santa Maria',
      'Largo da Oliveira',
      'Rua Rainha D. Maria II',
      'Praça de São Tiago',
      'Rua Egas Moniz',
      'Rua de Couros',
    ],
    freguesia: 'Oliveira, São Paio e São Sebastião',
  },
  ERC: {
    ruas: [
      'Avenida D. Afonso Henriques',
      'Rua de Camões',
      'Avenida Conde Margaride',
      'Rua Dr. Avelino Germano',
      'Rua Padre António Caldas',
      'Rua Francisco Agra',
      'Rua de Vila Flor',
      'Rua Gil Vicente',
    ],
    freguesia: 'Azurém',
  },
  EA: {
    ruas: [
      'Rua da Veiga',
      'Caminho do Agrinho',
      'Rua das Lameiras',
      'Rua de Silvares',
      'Rua da Quinta do Paço',
    ],
    freguesia: 'Creixomil',
  },
  EF: {
    ruas: ['Estrada da Penha', 'Rua do Monte', 'Caminho de Mesão Frio'],
    freguesia: 'Costa',
  },
};

const PESO_ZONA = [
  ['ERC', 45],
  ['EA', 25],
  ['CH', 15],
  ['EF', 15],
] as const;

const PESO_OBRA = [
  ['anexo', 30],
  ['muro', 20],
  ['ampliacao', 18],
  ['piscina', 12],
  ['fachada', 12],
  ['interior', 8],
] as const;

/** Medidas que as pessoas costumam dizer, à volta dos limites habituais. */
function medidas(
  obra: Obra,
  g: ReturnType<typeof gerador>,
): ConsultaDemonstracao['medidas'] {
  switch (obra) {
    case 'anexo':
      return {
        area_m2: g.um([6, 8, 9, 12, 15, 18, 20, 22, 25, 28, 35, 45]),
        altura_m: g.um([2, 2.2, 2.5, 2.8, 3.2]),
      };
    case 'muro':
      return { altura_m: g.um([1, 1.2, 1.5, 1.6, 1.8, 2, 2.2]) };
    case 'piscina':
      return { area_m2: g.um([20, 28, 32, 40, 45, 50, 55, 70]) };
    case 'ampliacao':
      return { area_m2: g.um([15, 25, 30, 35, 45, 50, 60, 80]) };
    default:
      return {};
  }
}

const arred = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * n perguntas espalhadas pelos últimos `anos` anos antes de `hoje`, cada
 * uma num ponto que cai mesmo na zona de demonstração escolhida (com as
 * zonas umas dentro das outras, a mais pequena ganha).
 */
export function gerarConsultasDemonstracao(
  hoje: string,
  n = 80,
  anos = 2,
): ConsultaDemonstracao[] {
  const g = gerador(1937);
  const lista: ConsultaDemonstracao[] = [];
  for (let i = 0; i < n; i++) {
    const codigo = g.pesado(PESO_ZONA);
    const zona = ZONAS_DEMONSTRACAO.find((z) => z.codigo === codigo)!;
    const lats = zona.poligono.map((p) => p[0]);
    const lngs = zona.poligono.map((p) => p[1]);
    // Um ponto ao acaso na caixa da zona, longe das bordas, que caia nela.
    let ponto: Ponto | null = null;
    for (let t = 0; t < 50 && !ponto; t++) {
      const p: Ponto = [
        arred(
          Math.min(...lats) +
            (0.1 + 0.8 * g.r()) * (Math.max(...lats) - Math.min(...lats)),
        ),
        arred(
          Math.min(...lngs) +
            (0.1 + 0.8 * g.r()) * (Math.max(...lngs) - Math.min(...lngs)),
        ),
      ];
      if (zonaDe(p, ZONAS_DEMONSTRACAO)?.codigo === codigo) ponto = p;
    }
    if (!ponto) continue;
    const obra = g.pesado(PESO_OBRA);
    const dia = somarDias(hoje, -g.entre(3, 365 * anos));
    const hora = String(g.entre(9, 19)).padStart(2, '0');
    const minuto = String(g.entre(0, 59)).padStart(2, '0');
    const { ruas, freguesia } = RUAS[codigo];
    lista.push({
      morada: `${g.um(ruas)} ${g.entre(1, 180)}, ${freguesia}, Guimarães`,
      lat: ponto[0],
      lng: ponto[1],
      obra,
      medidas: medidas(obra, g),
      criada_em: `${dia}T${hora}:${minuto}:00Z`,
      zona: codigo,
    });
  }
  return lista.sort((a, b) => a.criada_em.localeCompare(b.criada_em));
}
