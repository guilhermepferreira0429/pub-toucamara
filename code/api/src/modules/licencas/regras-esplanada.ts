/*
 * Esplanada aberta (mesas e cadeiras no passeio, à frente de um café ou
 * restaurante): as regras que o agente verifica na chamada. Sem BD, para
 * testar à parte.
 *
 * O "Licenciamento Zero" (DL 48/2011) prevê que a esplanada aberta que
 * cumpre os critérios do município se faça por mera comunicação prévia.
 * Os critérios e as taxas por omissão são de DEMONSTRAÇÃO: cada câmara põe
 * os do seu regulamento de ocupação do espaço público.
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

const hora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora no formato HH:MM.');

/** Avisos antes de expirar (de demonstração). */
const AVISO_1 = 30;
const AVISO_2 = 7;

export const esquemaConfigEsplanada = z.object({
  area_max_m2: z.number().positive().max(1000),
  mesas_max: z.number().int().min(1).max(200),
  /** Largura de passeio que tem de ficar livre para peões. */
  passeio_livre_min_m: z.number().min(0).max(10),
  meses_max: z.number().int().min(1).max(12),
  /** Estrado ou estrutura fixa no chão: vai a técnico. */
  estrado_vai_a_tecnico: z.boolean(),
  /** Centro histórico (património): vai a técnico. */
  centro_historico_vai_a_tecnico: z.boolean(),
  /** Hora a que a esplanada recolhe (condição da licença). */
  hora_fecho: hora,
  antecedencia_min_dias_uteis: z.number().int().min(0).max(30),
  antecedencia_max_dias: z.number().int().min(1).max(365),
  /** Por m² e por mês. */
  taxa_m2_mes_cent: z.number().int().min(0).max(100_000),
  taxa_minima_cent: z.number().int().min(0).max(100_000),
  ...camposComuns,
  ...camposAvisos(AVISO_1, AVISO_2),
});
export type ConfigEsplanada = z.output<typeof esquemaConfigEsplanada>;

export const CONFIG_ESPLANADA_OMISSAO: ConfigEsplanada = {
  area_max_m2: 30,
  mesas_max: 10,
  passeio_livre_min_m: 1.5,
  meses_max: 12,
  estrado_vai_a_tecnico: true,
  centro_historico_vai_a_tecnico: true,
  hora_fecho: '23:00',
  antecedencia_min_dias_uteis: 5,
  antecedencia_max_dias: 90,
  taxa_m2_mes_cent: 300,
  taxa_minima_cent: 2000,
  aprovacao: 'funcionario',
  fonte: {
    titulo:
      'DL 48/2011 (Licenciamento Zero) e regulamento municipal de ocupação do espaço público · esplanada aberta',
    url: null,
  },
  demonstracao: true,
  aviso_1_dias: AVISO_1,
  aviso_2_dias: AVISO_2,
  aviso_por_chamada: false,
};

export function lerConfigEsplanada(v: unknown): ConfigEsplanada {
  const r = esquemaConfigEsplanada.safeParse(v);
  return r.success ? r.data : CONFIG_ESPLANADA_OMISSAO;
}

export const entradaEsplanada = z.object({
  estabelecimento: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .describe('Nome do café, restaurante ou bar.'),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('Morada do estabelecimento: rua, número e freguesia.'),
  data_inicio: z.iso.date().describe('A partir de que dia, AAAA-MM-DD.'),
  meses: z
    .number()
    .int()
    .min(1)
    .max(24)
    .describe('Por quantos meses (1 a 12).'),
  area_m2: z
    .number()
    .positive()
    .max(10_000)
    .describe('Área da esplanada em m² (comprimento × largura).'),
  mesas: z.number().int().min(1).max(1000).describe('Quantas mesas.'),
  passeio_livre_m: z
    .number()
    .min(0)
    .max(20)
    .describe(
      'Quantos metros de passeio ficam livres para as pessoas passarem.',
    ),
  estrado: z
    .boolean()
    .optional()
    .describe('Se leva estrado, toldo fixo ou outra estrutura presa ao chão.'),
  centro_historico: z
    .boolean()
    .optional()
    .describe('Se fica no centro histórico.'),
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
export type PedidoEsplanada = z.output<typeof entradaEsplanada>;

export function taxaEsplanada(p: PedidoEsplanada, c: ConfigEsplanada) {
  const quantidade = Math.round(p.area_m2 * p.meses * 100) / 100;
  const calculada = Math.round(quantidade * c.taxa_m2_mes_cent);
  const total = Math.max(calculada, c.taxa_minima_cent);
  const linhas =
    total <= 0
      ? []
      : [
          calculada >= c.taxa_minima_cent
            ? {
                codigo: 'ESP',
                descricao: `Esplanada aberta · ${num(p.area_m2)} m² × ${p.meses} ${p.meses === 1 ? 'mês' : 'meses'}`,
                unidade: 'm2' as const,
                quantidade,
                valor_unitario_cent: c.taxa_m2_mes_cent,
                valor_cent: calculada,
              }
            : {
                codigo: 'ESP',
                descricao: 'Esplanada aberta · taxa mínima',
                unidade: 'fixo' as const,
                quantidade: 1,
                valor_unitario_cent: c.taxa_minima_cent,
                valor_cent: c.taxa_minima_cent,
              },
        ];
  return { linhas, total_cent: total };
}

export function avaliarEsplanada(
  p: PedidoEsplanada,
  c: ConfigEsplanada,
  hoje: string,
  feriados: Feriados,
): AvaliacaoLicenca {
  const regras: RegraAvaliada[] = [];
  const add = (id: string, ok: boolean, texto: string) =>
    regras.push({ id, ok, texto });

  regras.push(regraDeData(p.data_inicio, hoje, c, feriados));
  add(
    'area',
    p.area_m2 <= c.area_max_m2,
    p.area_m2 <= c.area_max_m2
      ? `Ocupa ${num(p.area_m2)} m² (até ${num(c.area_max_m2)} m²).`
      : `Ocupa ${num(p.area_m2)} m²: acima de ${num(c.area_max_m2)} m² precisa de análise.`,
  );
  add(
    'mesas',
    p.mesas <= c.mesas_max,
    p.mesas <= c.mesas_max
      ? `${p.mesas} mesas (até ${c.mesas_max}).`
      : `${p.mesas} mesas: acima de ${c.mesas_max} precisa de análise.`,
  );
  const passa = p.passeio_livre_m >= c.passeio_livre_min_m;
  add(
    'passeio',
    passa,
    passa
      ? `Ficam ${num(p.passeio_livre_m)} m de passeio livres (mínimo ${num(c.passeio_livre_min_m)} m).`
      : `Ficam só ${num(p.passeio_livre_m)} m de passeio para peões: o mínimo é ${num(c.passeio_livre_min_m)} m.`,
  );
  add(
    'meses',
    p.meses <= c.meses_max,
    p.meses <= c.meses_max
      ? `Por ${p.meses} ${p.meses === 1 ? 'mês' : 'meses'} (até ${c.meses_max}).`
      : `Por ${p.meses} meses: o máximo é ${c.meses_max}.`,
  );
  if (p.estrado && c.estrado_vai_a_tecnico) {
    add(
      'estrado',
      false,
      'Leva estrado ou estrutura fixa: um técnico tem de ver o projeto.',
    );
  }
  if (p.centro_historico && c.centro_historico_vai_a_tecnico) {
    add(
      'centro_historico',
      false,
      'Fica no centro histórico: um técnico do património tem de ver o mobiliário.',
    );
  }

  return {
    regras,
    proposta: propostaDe(regras),
    condicoes: [
      `Deixar sempre ${num(c.passeio_livre_min_m)} m de passeio livres para peões e acesso às entradas dos prédios.`,
      `Recolher mesas e cadeiras até às ${c.hora_fecho.replace(':00', 'h').replace(':', 'h')}.`,
      'Mobiliário sem publicidade e sem fixação ao pavimento.',
      'Manter o espaço limpo durante e depois do horário.',
    ],
    taxa: taxaEsplanada(p, c),
  };
}
