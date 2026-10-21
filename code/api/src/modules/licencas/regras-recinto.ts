/*
 * Recinto improvisado (arraial, festa, espetáculo ao ar livre com uma
 * estrutura temporária: palco, tenda, bancadas, barracas): as regras que o
 * agente verifica na chamada. Sem BD, para testar à parte.
 *
 * Base: DL 309/2002 (instalação e funcionamento dos recintos de espetáculos
 * e divertimentos públicos) e DL 268/2009 (recintos itinerantes e
 * improvisados), que pedem a licença à câmara e uma vistoria quando o
 * recinto o justifica. A música precisa também da licença especial de
 * ruído (Regulamento Geral do Ruído, DL 9/2007).
 *
 * A lotação sem vistoria, a antecedência e as taxas por omissão são de
 * DEMONSTRAÇÃO: cada câmara põe as do seu regulamento e tabela de taxas.
 */
import { z } from 'zod';
import type { Feriados } from '../../common/dias-uteis.js';
import {
  AvaliacaoLicenca,
  camposComuns,
  propostaDe,
  RegraAvaliada,
  regraDeData,
} from './comum.js';

export const ESTRUTURAS = {
  palco: 'Palco',
  tenda: 'Tenda',
  barracas: 'Barracas de comes e bebes',
  bancadas: 'Bancadas',
} as const;
export type Estrutura = keyof typeof ESTRUTURAS;
const CHAVES_ESTRUTURA = Object.keys(ESTRUTURAS) as [Estrutura, ...Estrutura[]];

export const esquemaConfigRecinto = z.object({
  /** Estruturas que se aceitam sem vistoria (as outras vão a técnico). */
  estruturas: z.array(z.enum(CHAVES_ESTRUTURA)),
  /** Acima desta lotação há vistoria (técnico). */
  lotacao_max: z.number().int().min(1).max(100_000),
  dias_max: z.number().int().min(1).max(60),
  antecedencia_min_dias_uteis: z.number().int().min(0).max(60),
  antecedencia_max_dias: z.number().int().min(1).max(365),
  taxa_base_cent: z.number().int().min(0).max(1_000_000),
  taxa_dia_cent: z.number().int().min(0).max(1_000_000),
  ...camposComuns,
});
export type ConfigRecinto = z.output<typeof esquemaConfigRecinto>;

export const CONFIG_RECINTO_OMISSAO: ConfigRecinto = {
  estruturas: ['palco', 'tenda', 'barracas'],
  lotacao_max: 300,
  dias_max: 5,
  antecedencia_min_dias_uteis: 10,
  antecedencia_max_dias: 180,
  taxa_base_cent: 2500,
  taxa_dia_cent: 1000,
  aprovacao: 'funcionario',
  fonte: {
    titulo:
      'DL 309/2002 e DL 268/2009 (recintos itinerantes e improvisados) e regulamento municipal · licença de recinto improvisado',
    url: null,
  },
  demonstracao: true,
};

export function lerConfigRecinto(v: unknown): ConfigRecinto {
  const r = esquemaConfigRecinto.safeParse(v);
  return r.success ? r.data : CONFIG_RECINTO_OMISSAO;
}

/** O que o agente pergunta (a entrada da ferramenta). */
export const entradaRecinto = z.object({
  descricao: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe(
      'O evento, numa frase (ex.: "arraial de São João da associação").',
    ),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('Onde: largo, rua ou terreno, e freguesia.'),
  data_inicio: z.iso.date().describe('Primeiro dia do evento, AAAA-MM-DD.'),
  dias: z.number().int().min(1).max(60).describe('Quantos dias dura.'),
  lotacao: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .describe('Quantas pessoas, no máximo, ao mesmo tempo.'),
  estruturas: z
    .array(z.enum(CHAVES_ESTRUTURA))
    .max(4)
    .describe(
      'As estruturas que monta: palco, tenda, barracas (de comes e bebes), bancadas. Lista vazia se não houver.',
    ),
  musica: z
    .boolean()
    .describe('Se vai haver música, colunas ou som amplificado.'),
  nome: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe(
      'Nome do titular (pessoa, associação ou empresa), para a licença.',
    ),
  metodo: z
    .enum(['mbway', 'multibanco'])
    .optional()
    .describe('Como quer pagar a taxa; por omissão MB WAY.'),
});
export type PedidoRecinto = z.output<typeof entradaRecinto>;

export function taxaRecinto(p: PedidoRecinto, c: ConfigRecinto) {
  const linhas = [
    {
      codigo: 'LRI',
      descricao: 'Recinto improvisado · licença',
      unidade: 'fixo' as const,
      quantidade: 1,
      valor_unitario_cent: c.taxa_base_cent,
      valor_cent: c.taxa_base_cent,
    },
    {
      codigo: 'LRI-DIA',
      descricao: `Recinto improvisado · ${p.dias} ${p.dias === 1 ? 'dia' : 'dias'}`,
      unidade: 'dia' as const,
      quantidade: p.dias,
      valor_unitario_cent: c.taxa_dia_cent,
      valor_cent: p.dias * c.taxa_dia_cent,
    },
  ].filter((l) => l.valor_cent > 0);
  return { linhas, total_cent: linhas.reduce((s, l) => s + l.valor_cent, 0) };
}

export function avaliarRecinto(
  p: PedidoRecinto,
  c: ConfigRecinto,
  hoje: string,
  feriados: Feriados,
): AvaliacaoLicenca {
  const regras: RegraAvaliada[] = [];
  const add = (id: string, ok: boolean, texto: string) =>
    regras.push({ id, ok, texto });

  regras.push(regraDeData(p.data_inicio, hoje, c, feriados));
  add(
    'lotacao',
    p.lotacao <= c.lotacao_max,
    p.lotacao <= c.lotacao_max
      ? `Até ${p.lotacao} pessoas (sem vistoria até ${c.lotacao_max}).`
      : `Até ${p.lotacao} pessoas: acima de ${c.lotacao_max} o recinto tem de ser vistoriado por um técnico.`,
  );
  add(
    'dias',
    p.dias <= c.dias_max,
    p.dias <= c.dias_max
      ? `Dura ${p.dias} ${p.dias === 1 ? 'dia' : 'dias'} (até ${c.dias_max}).`
      : `Dura ${p.dias} dias: o máximo sem análise é ${c.dias_max}.`,
  );
  const fora = p.estruturas.filter((e) => !c.estruturas.includes(e));
  add(
    'estruturas',
    fora.length === 0,
    fora.length === 0
      ? p.estruturas.length
        ? `Estruturas aceites sem vistoria: ${p.estruturas.map((e) => ESTRUTURAS[e].toLowerCase()).join(', ')}.`
        : 'Sem estruturas montadas.'
      : `${fora.map((e) => ESTRUTURAS[e]).join(', ')}: precisa de vistoria de um técnico.`,
  );

  const condicoes = [
    `Lotação máxima de ${p.lotacao} pessoas ao mesmo tempo.`,
    'Saídas de emergência livres e sinalizadas, extintores à mão e acesso para ambulâncias e bombeiros.',
    'Seguro de responsabilidade civil para o evento.',
  ];
  if (p.estruturas.length) {
    condicoes.push(
      'Estruturas montadas por quem esteja habilitado, com termo de responsabilidade pela montagem.',
    );
  }
  if (p.musica) {
    condicoes.push(
      'A música precisa também da licença especial de ruído (Regulamento Geral do Ruído).',
    );
  }
  condicoes.push('No fim, desmontar tudo e deixar o espaço limpo.');

  return {
    regras,
    proposta: propostaDe(regras),
    condicoes,
    taxa: taxaRecinto(p, c),
  };
}
