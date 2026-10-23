/*
 * Dístico (cartão) de residente para estacionar na zona onde se mora: as
 * regras que o agente verifica na chamada. Sem BD, para testar à parte.
 *
 * Os valores por omissão são de DEMONSTRAÇÃO: cada câmara põe os do seu
 * regulamento de estacionamento (zonas de duração limitada) e da sua
 * tabela de taxas.
 */
import { z } from 'zod';
import {
  AvaliacaoLicenca,
  camposAvisos,
  camposComuns,
  euros,
  propostaDe,
  RegraAvaliada,
} from './comum.js';

/** Avisos antes de expirar (de demonstração). */
const AVISO_1 = 30;
const AVISO_2 = 7;

export const esquemaConfigDistico = z.object({
  /** Quantos dísticos por casa (fogo), no máximo, sem análise. */
  disticos_max_por_fogo: z.number().int().min(1).max(10),
  /** Taxa por ano do 1.º, 2.º, ... dístico da mesma casa (o último repete-se). */
  taxa_por_ordem_cent: z
    .array(z.number().int().min(0).max(100_000))
    .min(1)
    .max(10),
  validade_meses: z.number().int().min(1).max(36),
  /** A morada tem de estar no cartão de cidadão ou num atestado de residência. */
  exige_morada_comprovada: z.boolean(),
  /** O carro tem de estar em nome de quem pede (ou com declaração da empresa ou do leasing). */
  exige_viatura_em_nome: z.boolean(),
  ...camposComuns,
  ...camposAvisos(AVISO_1, AVISO_2),
});
export type ConfigDistico = z.output<typeof esquemaConfigDistico>;

export const CONFIG_DISTICO_OMISSAO: ConfigDistico = {
  disticos_max_por_fogo: 2,
  taxa_por_ordem_cent: [1200, 3000],
  validade_meses: 12,
  exige_morada_comprovada: true,
  exige_viatura_em_nome: true,
  aprovacao: 'automatica',
  fonte: {
    titulo:
      'Regulamento municipal de estacionamento · dístico de residente nas zonas de estacionamento de duração limitada',
    url: null,
  },
  demonstracao: true,
  aviso_1_dias: AVISO_1,
  aviso_2_dias: AVISO_2,
  aviso_por_chamada: false,
};

export function lerConfigDistico(v: unknown): ConfigDistico {
  const r = esquemaConfigDistico.safeParse(v);
  return r.success ? r.data : CONFIG_DISTICO_OMISSAO;
}

/** Matrículas portuguesas: AA-00-AA, 00-AA-00, 00-00-AA, AA-00-00. */
const MATRICULA =
  /^([A-Z]{2}-\d{2}-[A-Z]{2}|\d{2}-[A-Z]{2}-\d{2}|\d{2}-\d{2}-[A-Z]{2}|[A-Z]{2}-\d{2}-\d{2})$/;

export function normalizarMatricula(m: string): string {
  const s = m.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 6
    ? `${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4)}`
    : m.trim().toUpperCase();
}

export const entradaDistico = z.object({
  morada: z
    .string()
    .trim()
    .min(3)
    .max(300)
    .describe('Morada onde vive: rua, número, andar e freguesia.'),
  matricula: z
    .string()
    .trim()
    .min(6)
    .max(12)
    .transform(normalizarMatricula)
    .describe('Matrícula do carro (ex.: AA-12-BB).'),
  disticos_ja_tem: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(0)
    .describe(
      'Quantos dísticos de residente já há para esta casa (0 se nenhum).',
    ),
  morada_comprovada: z
    .boolean()
    .describe(
      'Se tem a certidão de domicílio fiscal com esta morada (Portal das Finanças).',
    ),
  viatura_em_nome: z
    .boolean()
    .describe(
      'Se o carro está em nome da pessoa (ou tem declaração da empresa ou do leasing).',
    ),
  nome: z
    .string()
    .trim()
    .max(120)
    .optional()
    .describe('Nome de quem pede, para o dístico.'),
  metodo: z
    .enum(['mbway', 'multibanco'])
    .optional()
    .describe('Como quer pagar a taxa; por omissão MB WAY.'),
});
export type PedidoDistico = z.output<typeof entradaDistico>;

export function taxaDistico(p: PedidoDistico, c: ConfigDistico) {
  const ordem = p.disticos_ja_tem + 1;
  const tabela = c.taxa_por_ordem_cent;
  const valor = tabela[Math.min(ordem, tabela.length) - 1];
  const linhas =
    valor > 0
      ? [
          {
            codigo: 'DRE',
            descricao: `Dístico de residente · ${ordem}.º da casa · ${c.validade_meses} meses`,
            unidade: 'fixo' as const,
            quantidade: 1,
            valor_unitario_cent: valor,
            valor_cent: valor,
          },
        ]
      : [];
  return { linhas, total_cent: valor };
}

/** Sem datas: o dístico vale a partir de quando é emitido. */
export function avaliarDistico(
  p: PedidoDistico,
  c: ConfigDistico,
): AvaliacaoLicenca {
  const regras: RegraAvaliada[] = [];
  const add = (id: string, ok: boolean, texto: string) =>
    regras.push({ id, ok, texto });

  const matricula = MATRICULA.test(p.matricula);
  add(
    'matricula',
    matricula,
    matricula
      ? `Matrícula ${p.matricula}.`
      : `A matrícula "${p.matricula}" não parece portuguesa: um técnico confirma.`,
  );
  if (c.exige_morada_comprovada) {
    add(
      'morada',
      p.morada_comprovada,
      p.morada_comprovada
        ? 'A morada está na certidão de domicílio fiscal.'
        : 'A morada não está comprovada: é preciso o atestado de residência da junta.',
    );
  }
  if (c.exige_viatura_em_nome) {
    add(
      'viatura',
      p.viatura_em_nome,
      p.viatura_em_nome
        ? 'O carro está em nome de quem pede.'
        : 'O carro não está em nome de quem pede: é preciso a declaração do dono (empresa ou leasing).',
    );
  }
  const ordem = p.disticos_ja_tem + 1;
  add(
    'por_fogo',
    ordem <= c.disticos_max_por_fogo,
    ordem <= c.disticos_max_por_fogo
      ? `Seria o ${ordem}.º dístico desta casa (até ${c.disticos_max_por_fogo}).`
      : `Seria o ${ordem}.º dístico desta casa: acima de ${c.disticos_max_por_fogo} precisa de análise.`,
  );

  const taxa = taxaDistico(p, c);
  return {
    regras,
    proposta: propostaDe(regras),
    condicoes: [
      `Válido por ${c.validade_meses} meses, só para o carro ${p.matricula} e só na zona da morada.`,
      'Deixar o dístico visível no para-brisas (ou mostrar o QR se lho pedirem).',
      'Não dá lugar reservado: estaciona-se onde houver lugar na zona.',
      ordem > 1
        ? `É o ${ordem}.º dístico da casa: paga ${euros(taxa.total_cent)} por ano.`
        : 'Avisar a câmara se mudar de casa ou de carro.',
    ],
    taxa,
  };
}
