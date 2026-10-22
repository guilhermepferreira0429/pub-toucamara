/*
 * Ocupação da via pública por motivo de obras (andaime, contentor,
 * materiais, plataforma elevatória): as regras que o agente verifica na
 * chamada. Sem BD, para testar à parte.
 *
 * Os valores por omissão são de DEMONSTRAÇÃO: cada câmara põe os do seu
 * regulamento de ocupação do espaço público e da sua tabela de taxas. A
 * largura livre de 1,20 m para peões segue a regra geral de
 * acessibilidade (DL 163/2006), mas também está por confirmar.
 */
import { z } from 'zod';
import type { Feriados } from '../../common/dias-uteis.js';
import {
  AvaliacaoLicenca,
  camposAvisos,
  camposComuns,
  num,
  propostaDe,
  RegraAvaliada,
  regraDeData,
} from './comum.js';

export const EQUIPAMENTOS = {
  andaime: 'Andaime',
  contentor: 'Contentor de entulho',
  materiais: 'Depósito de materiais',
  plataforma: 'Plataforma elevatória',
} as const;
export type Equipamento = keyof typeof EQUIPAMENTOS;
const CHAVES_EQUIPAMENTO = Object.keys(EQUIPAMENTOS) as [
  Equipamento,
  ...Equipamento[],
];

/** Avisos antes de expirar (de demonstração): a ocupação dura dias, não meses. */
const AVISO_1 = 5;
const AVISO_2 = 2;

export const esquemaConfigOcupacao = z.object({
  /** O que se autoriza sem técnico. */
  equipamentos: z.array(z.enum(CHAVES_EQUIPAMENTO)).min(1),
  area_max_m2: z.number().positive().max(1000),
  dias_max: z.number().int().min(1).max(365),
  /** Largura de passeio que tem de ficar livre para peões. */
  passeio_livre_min_m: z.number().min(0).max(10),
  /** Ocupar a faixa de rodagem (a estrada) vai sempre a técnico. */
  estrada_vai_a_tecnico: z.boolean(),
  antecedencia_min_dias_uteis: z.number().int().min(0).max(30),
  antecedencia_max_dias: z.number().int().min(1).max(365),
  /** Taxa fixa de apreciação. */
  taxa_base_cent: z.number().int().min(0).max(100_000),
  /** Por m² e por dia. */
  taxa_m2_dia_cent: z.number().int().min(0).max(10_000),
  ...camposComuns,
  ...camposAvisos(AVISO_1, AVISO_2),
});
export type ConfigOcupacao = z.output<typeof esquemaConfigOcupacao>;

export const CONFIG_OCUPACAO_OMISSAO: ConfigOcupacao = {
  equipamentos: ['andaime', 'contentor', 'materiais'],
  area_max_m2: 20,
  dias_max: 30,
  passeio_livre_min_m: 1.2,
  estrada_vai_a_tecnico: true,
  antecedencia_min_dias_uteis: 5,
  antecedencia_max_dias: 90,
  taxa_base_cent: 1000,
  taxa_m2_dia_cent: 50,
  aprovacao: 'automatica',
  fonte: {
    titulo:
      'Regulamento municipal de ocupação do espaço público e tabela de taxas · ocupação da via pública por motivo de obras',
    url: null,
  },
  demonstracao: true,
  aviso_1_dias: AVISO_1,
  aviso_2_dias: AVISO_2,
  aviso_por_chamada: false,
};

export function lerConfigOcupacao(v: unknown): ConfigOcupacao {
  const r = esquemaConfigOcupacao.safeParse(v);
  return r.success ? r.data : CONFIG_OCUPACAO_OMISSAO;
}

/** O que o agente pergunta (a entrada da ferramenta). */
export const entradaOcupacao = z.object({
  equipamento: z
    .enum(CHAVES_EQUIPAMENTO)
    .describe(
      'andaime, contentor (de entulho), materiais (depósito na rua) ou plataforma (elevatória).',
    ),
  descricao: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('Para que obra, numa frase (ex.: "pintar a fachada do prédio").'),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('Onde: rua, número e freguesia.'),
  data_inicio: z.iso.date().describe('Primeiro dia da ocupação, AAAA-MM-DD.'),
  dias: z.number().int().min(1).max(365).describe('Quantos dias fica na rua.'),
  area_m2: z
    .number()
    .positive()
    .max(10_000)
    .describe('Quanto ocupa, em m² (comprimento × largura).'),
  passeio_livre_m: z
    .number()
    .min(0)
    .max(20)
    .describe(
      'Quantos metros de passeio ficam livres para as pessoas passarem (0 se tapa o passeio todo).',
    ),
  ocupa_estrada: z
    .boolean()
    .optional()
    .describe(
      'Se ocupa parte da estrada (faixa de rodagem) ou lugares de estacionamento.',
    ),
  nome: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Nome do titular (pessoa ou empresa), para a licença.'),
  metodo: z
    .enum(['mbway', 'multibanco'])
    .optional()
    .describe('Como quer pagar a taxa; por omissão MB WAY.'),
});
export type PedidoOcupacao = z.output<typeof entradaOcupacao>;

export function taxaOcupacao(p: PedidoOcupacao, c: ConfigOcupacao) {
  const quantidade = Math.round(p.area_m2 * p.dias * 100) / 100;
  const variavel = Math.round(quantidade * c.taxa_m2_dia_cent);
  const linhas = [
    {
      codigo: 'OVP',
      descricao: 'Ocupação da via pública · apreciação',
      unidade: 'fixo' as const,
      quantidade: 1,
      valor_unitario_cent: c.taxa_base_cent,
      valor_cent: c.taxa_base_cent,
    },
    {
      codigo: 'OVP-M2',
      descricao: `Ocupação da via pública · ${num(p.area_m2)} m² × ${p.dias} dias`,
      unidade: 'm2' as const,
      quantidade,
      valor_unitario_cent: c.taxa_m2_dia_cent,
      valor_cent: variavel,
    },
  ].filter((l) => l.valor_cent > 0);
  return {
    linhas,
    total_cent: linhas.reduce((s, l) => s + l.valor_cent, 0),
  };
}

export function avaliarOcupacao(
  p: PedidoOcupacao,
  c: ConfigOcupacao,
  hoje: string,
  feriados: Feriados,
): AvaliacaoLicenca {
  const regras: RegraAvaliada[] = [];
  const add = (id: string, ok: boolean, texto: string) =>
    regras.push({ id, ok, texto });

  regras.push(regraDeData(p.data_inicio, hoje, c, feriados));

  const permitido = c.equipamentos.includes(p.equipamento);
  add(
    'equipamento',
    permitido,
    permitido
      ? `${EQUIPAMENTOS[p.equipamento]}: autorizado pelas regras.`
      : `${EQUIPAMENTOS[p.equipamento]}: precisa sempre de um técnico.`,
  );
  add(
    'area',
    p.area_m2 <= c.area_max_m2,
    p.area_m2 <= c.area_max_m2
      ? `Ocupa ${num(p.area_m2)} m² (até ${num(c.area_max_m2)} m²).`
      : `Ocupa ${num(p.area_m2)} m²: acima de ${num(c.area_max_m2)} m² precisa de análise.`,
  );
  add(
    'dias',
    p.dias <= c.dias_max,
    p.dias <= c.dias_max
      ? `Fica ${p.dias} dias (até ${c.dias_max}).`
      : `Fica ${p.dias} dias: o máximo sem análise é ${c.dias_max}.`,
  );
  const passa = p.passeio_livre_m >= c.passeio_livre_min_m;
  add(
    'passeio',
    passa,
    passa
      ? `Ficam ${num(p.passeio_livre_m)} m de passeio livres (mínimo ${num(c.passeio_livre_min_m)} m).`
      : `Ficam só ${num(p.passeio_livre_m)} m de passeio para peões: o mínimo é ${num(c.passeio_livre_min_m)} m.`,
  );
  if (p.ocupa_estrada && c.estrada_vai_a_tecnico) {
    add(
      'estrada',
      false,
      'Ocupa a estrada: um técnico tem de ver o trânsito e a sinalização.',
    );
  }

  const condicoes = [
    `Deixar sempre ${num(c.passeio_livre_min_m)} m livres para peões, com um percurso seguro e sinalizado.`,
    'Sinalizar a ocupação de dia e iluminá-la à noite.',
  ];
  if (p.equipamento === 'andaime') {
    condicoes.push(
      'Andaime com rede de proteção e estrado de proteção à passagem de peões.',
    );
  }
  if (p.equipamento === 'contentor') {
    condicoes.push(
      'Contentor com refletores; não deixar entulho fora dele e retirá-lo quando estiver cheio.',
    );
  }
  condicoes.push(
    'No fim, deixar o espaço limpo e repor o pavimento se o estragar.',
  );

  return {
    regras,
    proposta: propostaDe(regras),
    condicoes,
    taxa: taxaOcupacao(p, c),
  };
}
