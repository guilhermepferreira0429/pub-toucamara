/*
 * Publicidade (afixação ou inscrição de mensagens publicitárias: placa,
 * tabuleta, letras, toldo, lona na fachada, bandeirola, cavalete): as
 * regras que o agente verifica na chamada. Sem BD, para testar à parte.
 *
 * A Lei 97/88 (afixação e inscrição de mensagens de publicidade), na
 * redação do "Licenciamento Zero" (DL 48/2011), dispensa de licença a
 * mensagem que publicita o próprio estabelecimento, no próprio edifício,
 * desde que cumpra os critérios do município (art. 1.º, n.º 3): fica uma
 * mera comunicação. O resto precisa de licença e vai a um técnico.
 *
 * Os critérios, as áreas e as taxas por omissão são de DEMONSTRAÇÃO: cada
 * câmara põe os do seu regulamento de publicidade e da sua tabela de taxas.
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

export const SUPORTES = {
  placa: 'Placa ou chapa na fachada',
  letras: 'Letras soltas ou reclamo na fachada',
  tabuleta: 'Tabuleta (perpendicular à fachada)',
  toldo: 'Inscrição no toldo',
  lona: 'Lona ou tela na fachada',
  bandeirola: 'Bandeirola em poste',
  cavalete: 'Cavalete ou expositor no passeio',
} as const;
export type Suporte = keyof typeof SUPORTES;
const CHAVES_SUPORTE = Object.keys(SUPORTES) as [Suporte, ...Suporte[]];

/** Avisos antes de expirar (de demonstração). */
const AVISO_1 = 30;
const AVISO_2 = 7;

export const esquemaConfigPublicidade = z.object({
  /** Suportes que se aceitam sem técnico (os outros vão sempre a técnico). */
  suportes: z.array(z.enum(CHAVES_SUPORTE)).min(1),
  /** Até esta área, no próprio estabelecimento: isenta (mera comunicação). */
  area_isenta_m2: z.number().min(0).max(100),
  /** Acima desta área precisa de licença e vai a técnico. */
  area_max_m2: z.number().positive().max(1000),
  /** Publicidade fora do próprio estabelecimento: precisa de licença. */
  alheia_vai_a_tecnico: z.boolean(),
  /** Centro histórico (zona de proteção do património): vai a técnico. */
  centro_historico_vai_a_tecnico: z.boolean(),
  /** Iluminada: vai a técnico (ex.: zonas residenciais sensíveis). */
  iluminado_vai_a_tecnico: z.boolean(),
  meses_max: z.number().int().min(1).max(36),
  antecedencia_min_dias_uteis: z.number().int().min(0).max(30),
  antecedencia_max_dias: z.number().int().min(1).max(365),
  /** Por m² e por mês. */
  taxa_m2_mes_cent: z.number().int().min(0).max(100_000),
  /** Por m² e por mês, se for iluminada. */
  taxa_iluminado_m2_mes_cent: z.number().int().min(0).max(100_000),
  taxa_minima_cent: z.number().int().min(0).max(100_000),
  ...camposComuns,
  ...camposAvisos(AVISO_1, AVISO_2),
});
export type ConfigPublicidade = z.output<typeof esquemaConfigPublicidade>;

export const CONFIG_PUBLICIDADE_OMISSAO: ConfigPublicidade = {
  suportes: ['placa', 'letras', 'tabuleta', 'toldo', 'lona'],
  area_isenta_m2: 1,
  area_max_m2: 6,
  alheia_vai_a_tecnico: true,
  centro_historico_vai_a_tecnico: true,
  iluminado_vai_a_tecnico: false,
  meses_max: 12,
  antecedencia_min_dias_uteis: 3,
  antecedencia_max_dias: 90,
  taxa_m2_mes_cent: 150,
  taxa_iluminado_m2_mes_cent: 250,
  taxa_minima_cent: 1000,
  aprovacao: 'funcionario',
  fonte: {
    titulo:
      'Lei 97/88 (afixação e inscrição de mensagens de publicidade), DL 48/2011 (Licenciamento Zero) e regulamento municipal de publicidade',
    url: null,
  },
  demonstracao: true,
  aviso_1_dias: AVISO_1,
  aviso_2_dias: AVISO_2,
  aviso_por_chamada: false,
};

export function lerConfigPublicidade(v: unknown): ConfigPublicidade {
  const r = esquemaConfigPublicidade.safeParse(v);
  return r.success ? r.data : CONFIG_PUBLICIDADE_OMISSAO;
}

/** O que o agente pergunta (a entrada da ferramenta). */
export const entradaPublicidade = z.object({
  suporte: z
    .enum(CHAVES_SUPORTE)
    .describe(
      'placa (chapa na fachada), letras (letras soltas ou reclamo), tabuleta (perpendicular à fachada), toldo (inscrição no toldo), lona (tela na fachada), bandeirola (em poste) ou cavalete (no passeio).',
    ),
  estabelecimento: z
    .string()
    .trim()
    .min(2)
    .max(120)
    .describe('Nome do estabelecimento ou da marca que aparece.'),
  mensagem: z
    .string()
    .trim()
    .min(2)
    .max(300)
    .describe(
      'O que diz o anúncio, numa frase (ex.: "nome da loja e horário").',
    ),
  morada: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('Onde fica: rua, número e freguesia.'),
  largura_m: z
    .number()
    .positive()
    .max(100)
    .describe('Largura do anúncio, em metros.'),
  altura_m: z
    .number()
    .positive()
    .max(100)
    .describe('Altura do anúncio, em metros.'),
  iluminado: z.boolean().describe('Se é iluminado ou luminoso.'),
  no_proprio_estabelecimento: z
    .boolean()
    .describe(
      'Se fica no edifício do próprio estabelecimento e anuncia esse estabelecimento (e não outra marca ou outro sítio).',
    ),
  centro_historico: z
    .boolean()
    .optional()
    .describe('Se fica no centro histórico.'),
  data_inicio: z.iso.date().describe('A partir de que dia, AAAA-MM-DD.'),
  meses: z
    .number()
    .int()
    .min(1)
    .max(36)
    .describe('Por quantos meses (1 a 12).'),
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
export type PedidoPublicidade = z.output<typeof entradaPublicidade>;

export function areaPublicidade(p: PedidoPublicidade): number {
  return Math.round(p.largura_m * p.altura_m * 100) / 100;
}

/** Isenta: no próprio estabelecimento e pequena (mera comunicação). */
export function isentaPublicidade(
  p: PedidoPublicidade,
  c: ConfigPublicidade,
): boolean {
  return p.no_proprio_estabelecimento && areaPublicidade(p) <= c.area_isenta_m2;
}

export function taxaPublicidade(p: PedidoPublicidade, c: ConfigPublicidade) {
  if (isentaPublicidade(p, c)) return { linhas: [], total_cent: 0 };
  const area = areaPublicidade(p);
  const quantidade = Math.round(area * p.meses * 100) / 100;
  const unitario = p.iluminado
    ? c.taxa_iluminado_m2_mes_cent
    : c.taxa_m2_mes_cent;
  const calculada = Math.round(quantidade * unitario);
  const total = Math.max(calculada, c.taxa_minima_cent);
  if (total <= 0) return { linhas: [], total_cent: 0 };
  const linha =
    calculada >= c.taxa_minima_cent
      ? {
          codigo: 'PUB',
          descricao: `Publicidade${p.iluminado ? ' iluminada' : ''} · ${num(area)} m² × ${p.meses} ${p.meses === 1 ? 'mês' : 'meses'}`,
          unidade: 'm2' as const,
          quantidade,
          valor_unitario_cent: unitario,
          valor_cent: calculada,
        }
      : {
          codigo: 'PUB',
          descricao: 'Publicidade · taxa mínima',
          unidade: 'fixo' as const,
          quantidade: 1,
          valor_unitario_cent: c.taxa_minima_cent,
          valor_cent: c.taxa_minima_cent,
        };
  return { linhas: [linha], total_cent: total };
}

export function avaliarPublicidade(
  p: PedidoPublicidade,
  c: ConfigPublicidade,
  hoje: string,
  feriados: Feriados,
): AvaliacaoLicenca {
  const regras: RegraAvaliada[] = [];
  const add = (id: string, ok: boolean, texto: string) =>
    regras.push({ id, ok, texto });
  const area = areaPublicidade(p);
  const isenta = isentaPublicidade(p, c);

  regras.push(regraDeData(p.data_inicio, hoje, c, feriados));
  const aceite = c.suportes.includes(p.suporte);
  add(
    'suporte',
    aceite,
    aceite
      ? `${SUPORTES[p.suporte]}: aceite pelas regras.`
      : `${SUPORTES[p.suporte]}: precisa sempre de um técnico.`,
  );
  if (!p.no_proprio_estabelecimento && c.alheia_vai_a_tecnico) {
    add(
      'proprio',
      false,
      'Não é no próprio estabelecimento: precisa de licença e um técnico tem de a ver (Lei 97/88).',
    );
  }
  add(
    'area',
    area <= c.area_max_m2,
    area <= c.area_max_m2
      ? isenta
        ? `${num(area)} m² no próprio estabelecimento (até ${num(c.area_isenta_m2)} m²): não precisa de licença, fica uma mera comunicação.`
        : `${num(area)} m² (até ${num(c.area_max_m2)} m²).`
      : `${num(area)} m²: acima de ${num(c.area_max_m2)} m² precisa de licença e de um técnico.`,
  );
  add(
    'meses',
    p.meses <= c.meses_max,
    p.meses <= c.meses_max
      ? `Por ${p.meses} ${p.meses === 1 ? 'mês' : 'meses'} (até ${c.meses_max}).`
      : `Por ${p.meses} meses: o máximo é ${c.meses_max}.`,
  );
  if (p.centro_historico && c.centro_historico_vai_a_tecnico) {
    add(
      'centro_historico',
      false,
      'Fica no centro histórico: um técnico do património tem de ver o anúncio.',
    );
  }
  if (p.iluminado && c.iluminado_vai_a_tecnico) {
    add(
      'iluminado',
      false,
      'É iluminado: um técnico tem de ver a luz e o consumo.',
    );
  }

  const condicoes = [
    isenta
      ? 'Mera comunicação: o anúncio do próprio estabelecimento não precisa de licença, mas tem de cumprir estas condições.'
      : 'Licença só para o anúncio, o local e as medidas indicadas.',
    'Não tapar janelas, varandas, placas de rua, números de polícia nem sinais de trânsito.',
    'Manter o anúncio limpo e seguro; retirá-lo no fim do prazo.',
  ];
  if (p.iluminado) {
    condicoes.push(
      'Luz sem encandear quem passa nem os vizinhos; desligar entre a 1h e as 7h.',
    );
  }
  if (p.suporte === 'tabuleta' || p.suporte === 'toldo') {
    condicoes.push('Pelo menos 2,20 m livres entre o passeio e o anúncio.');
  }
  if (p.suporte === 'cavalete') {
    condicoes.push('Deixar sempre 1,20 m de passeio livres para peões.');
  }

  return {
    regras,
    proposta: propostaDe(regras),
    condicoes,
    taxa: taxaPublicidade(p, c),
  };
}
