/*
 * "O que posso fazer nesta morada": o ponto no mapa → a zona do PDM → o
 * controlo que a obra precisa. Sem BD, para testar à parte.
 *
 * Cada obra tem degraus: o primeiro cujos limites a obra cumpre decide o
 * controlo (ex.: anexo até 10 m² isento, até 30 m² comunicação prévia);
 * acima de todos, `acima`. Os valores das zonas de demonstração são de
 * DEMONSTRAÇÃO: cada câmara carrega os do seu PDM e regulamentos.
 */
import { z } from 'zod';

export const OBRAS = {
  anexo: 'Anexo, telheiro ou arrumos no terreno',
  muro: 'Muro de vedação',
  piscina: 'Piscina',
  ampliacao: 'Ampliação da casa',
  fachada: 'Mudar a fachada (abrir porta ou janela, pintar de outra cor)',
  interior: 'Obras dentro de casa',
} as const;
export type Obra = keyof typeof OBRAS;

export const CONTROLOS = [
  'isento',
  'comunicacao_previa',
  'licenca',
  'nao_permitido',
] as const;
export type Controlo = (typeof CONTROLOS)[number];

export const CONTROLO_DITO: Record<Controlo, string> = {
  isento: 'não precisa de pedir nada à câmara',
  comunicacao_previa: 'precisa de uma comunicação prévia',
  licenca: 'precisa de licença',
  nao_permitido: 'não é permitido nesta zona',
};

const degrau = z.object({
  controlo: z.enum(CONTROLOS),
  area_max_m2: z.number().positive().optional(),
  altura_max_m: z.number().positive().optional(),
});

export const esquemaRegraObra = z.object({
  degraus: z.array(degrau).max(5),
  acima: z.enum(CONTROLOS),
  notas: z.array(z.string()).default([]),
});
export type RegraObra = z.output<typeof esquemaRegraObra>;

export type RegrasZona = Partial<Record<Obra, RegraObra>>;

export type Ponto = [number, number]; // [lat, lng]

/** Ray casting: o ponto está dentro do polígono? */
export function dentro(p: Ponto, poligono: Ponto[]): boolean {
  const [y, x] = p;
  let d = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [yi, xi] = poligono[i];
    const [yj, xj] = poligono[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      d = !d;
    }
  }
  return d;
}

/** Área aproximada (graus²): serve só para ordenar, a mais pequena ganha. */
export function area(poligono: Ponto[]): number {
  let s = 0;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    s += (poligono[j][1] + poligono[i][1]) * (poligono[j][0] - poligono[i][0]);
  }
  return Math.abs(s / 2);
}

/** A zona do ponto; com zonas umas dentro das outras, a mais pequena. */
export function zonaDe<Z extends { poligono: Ponto[] }>(
  p: Ponto,
  zonas: Z[],
): Z | null {
  return (
    zonas
      .filter((z) => dentro(p, z.poligono))
      .sort((a, b) => area(a.poligono) - area(b.poligono))[0] ?? null
  );
}

export interface Avaliacao {
  controlo: Controlo | null;
  /** O que falta perguntar para decidir (ex.: a área). */
  em_falta: ('area_m2' | 'altura_m')[];
  limites: string[];
  notas: string[];
}

function n(v: number): string {
  return String(v).replace('.', ',');
}

export function avaliarObra(
  regra: RegraObra | undefined,
  medidas: { area_m2?: number; altura_m?: number },
): Avaliacao {
  if (!regra) {
    return { controlo: null, em_falta: [], limites: [], notas: [] };
  }
  const limites = regra.degraus
    .filter((d) => d.area_max_m2 || d.altura_max_m)
    .map(
      (d) =>
        `${CONTROLO_DITO[d.controlo].replace(/^./, (c) => c.toUpperCase())} até ${[
          d.area_max_m2 ? `${n(d.area_max_m2)} m²` : null,
          d.altura_max_m ? `${n(d.altura_max_m)} m de altura` : null,
        ]
          .filter(Boolean)
          .join(' e ')}.`,
    );
  // Só se pergunta a medida se ela mudar a resposta.
  const controlos = new Set([
    ...regra.degraus.map((d) => d.controlo),
    regra.acima,
  ]);
  const precisaArea =
    controlos.size > 1 &&
    regra.degraus.some((d) => d.area_max_m2) &&
    medidas.area_m2 === undefined;
  const precisaAltura =
    controlos.size > 1 &&
    regra.degraus.some((d) => d.altura_max_m) &&
    medidas.altura_m === undefined;
  if (precisaArea || precisaAltura) {
    return {
      controlo: null,
      em_falta: [
        ...(precisaArea ? (['area_m2'] as const) : []),
        ...(precisaAltura ? (['altura_m'] as const) : []),
      ],
      limites,
      notas: regra.notas,
    };
  }
  const cabe = regra.degraus.find(
    (d) =>
      (!d.area_max_m2 || (medidas.area_m2 ?? 0) <= d.area_max_m2) &&
      (!d.altura_max_m || (medidas.altura_m ?? 0) <= d.altura_max_m),
  );
  return {
    controlo: cabe?.controlo ?? regra.acima,
    em_falta: [],
    limites,
    notas: regra.notas,
  };
}

/** O que a pessoa faz a seguir, por controlo. */
export function passos(c: Controlo): string[] {
  switch (c) {
    case 'isento':
      return [
        'Não precisa de pedir nada à câmara.',
        'Tem de cumprir os limites desta zona e as regras de construção.',
        'Se tiver dúvidas, guarde esta página: diz o que foi verificado e quando.',
      ];
    case 'comunicacao_previa':
      return [
        'Entrega uma comunicação prévia à câmara: o agente pode preenchê-la consigo agora.',
        'Junta a caderneta predial, a certidão do registo predial e o termo de responsabilidade do técnico.',
        'Pode começar a obra se a câmara não se opuser no prazo legal.',
      ];
    case 'licenca':
      return [
        'Precisa de um projeto feito por um técnico (arquiteto ou engenheiro).',
        'O técnico entrega o pedido de licença na câmara, com os documentos do terreno.',
        'Só pode começar a obra depois de a licença ser emitida.',
      ];
    case 'nao_permitido':
      return [
        'Nesta zona o plano diretor municipal não permite esta obra.',
        'Se quiser, um técnico da câmara analisa o seu caso: pode haver exceções.',
      ];
  }
}

// ---------------------------------------------------------------------
// Zonas de demonstração (Guimarães), para a câmara substituir pelas do PDM
// ---------------------------------------------------------------------

export interface ZonaNova {
  codigo: string;
  nome: string;
  categoria: 'urbano' | 'protecao' | 'agricola' | 'florestal';
  descricao: string;
  poligono: Ponto[];
  regras: RegrasZona;
  fonte: { titulo: string; artigo: string | null; url: string | null };
}

const so = (controlo: Controlo, notas: string[] = []): RegraObra => ({
  degraus: [],
  acima: controlo,
  notas,
});

const caixa = (
  latMin: number,
  latMax: number,
  lngMin: number,
  lngMax: number,
): Ponto[] => [
  [latMin, lngMin],
  [latMin, lngMax],
  [latMax, lngMax],
  [latMax, lngMin],
];

const FONTE = {
  titulo: 'PDM de Guimarães · regulamento (valores de demonstração)',
  artigo: null,
  url: null,
};

export const ZONAS_DEMONSTRACAO: ZonaNova[] = [
  {
    codigo: 'CH',
    nome: 'Centro Histórico',
    categoria: 'protecao',
    descricao:
      'Zona classificada como Património Mundial: qualquer mudança no exterior precisa de licença e de parecer do património.',
    poligono: caixa(41.4405, 41.4462, -8.2985, -8.2915),
    regras: {
      anexo: so('nao_permitido'),
      muro: so('licenca', ['Com parecer da entidade do património.']),
      piscina: so('nao_permitido'),
      ampliacao: so('licenca', ['Com parecer da entidade do património.']),
      fachada: so('licenca', [
        'Cores, caixilharia e materiais têm de seguir a carta de cores do centro histórico.',
      ]),
      interior: so('comunicacao_previa', [
        'Mesmo dentro de casa, num edifício classificado a câmara tem de saber.',
      ]),
    },
    fonte: FONTE,
  },
  {
    codigo: 'ERC',
    nome: 'Espaço residencial consolidado',
    categoria: 'urbano',
    descricao: 'Bairros já construídos à volta do centro.',
    poligono: caixa(41.432, 41.456, -8.312, -8.278),
    regras: {
      anexo: {
        degraus: [
          { controlo: 'isento', area_max_m2: 10, altura_max_m: 2.2 },
          { controlo: 'comunicacao_previa', area_max_m2: 30, altura_max_m: 3 },
        ],
        acima: 'licenca',
        notas: ['Não pode confinar com a via pública.'],
      },
      muro: {
        degraus: [{ controlo: 'isento', altura_max_m: 1.8 }],
        acima: 'comunicacao_previa',
        notas: [
          'Se confinar com a via pública, precisa de comunicação prévia.',
        ],
      },
      piscina: {
        degraus: [{ controlo: 'comunicacao_previa', area_max_m2: 50 }],
        acima: 'licenca',
        notas: [],
      },
      ampliacao: {
        degraus: [{ controlo: 'comunicacao_previa', area_max_m2: 50 }],
        acima: 'licenca',
        notas: ['A área de construção total não pode passar o índice da zona.'],
      },
      fachada: so('comunicacao_previa'),
      interior: so('isento', [
        'Desde que não mexa na estrutura nem na fachada.',
      ]),
    },
    fonte: FONTE,
  },
  {
    codigo: 'EA',
    nome: 'Espaço agrícola',
    categoria: 'agricola',
    descricao: 'Terrenos de cultivo; parte está na Reserva Agrícola Nacional.',
    poligono: caixa(41.41, 41.432, -8.335, -8.29),
    regras: {
      anexo: {
        degraus: [{ controlo: 'comunicacao_previa', area_max_m2: 20 }],
        acima: 'nao_permitido',
        notas: [
          'Só para apoio à agricultura (arrumos de alfaias, por exemplo).',
        ],
      },
      muro: {
        degraus: [{ controlo: 'isento', altura_max_m: 1.5 }],
        acima: 'comunicacao_previa',
        notas: [],
      },
      piscina: so('nao_permitido'),
      ampliacao: so('licenca', [
        'Em Reserva Agrícola Nacional precisa também de parecer da entidade da RAN.',
      ]),
      fachada: so('comunicacao_previa'),
      interior: so('isento'),
    },
    fonte: FONTE,
  },
  {
    codigo: 'EF',
    nome: 'Espaço florestal (Penha)',
    categoria: 'florestal',
    descricao: 'Encosta da Penha: floresta e risco de incêndio.',
    poligono: caixa(41.432, 41.455, -8.278, -8.255),
    regras: {
      anexo: so('nao_permitido'),
      muro: so('comunicacao_previa'),
      piscina: so('nao_permitido'),
      ampliacao: so('nao_permitido', [
        'Em espaço florestal com risco de incêndio não se aumenta a construção.',
      ]),
      fachada: so('comunicacao_previa'),
      interior: so('isento'),
    },
    fonte: FONTE,
  },
];
