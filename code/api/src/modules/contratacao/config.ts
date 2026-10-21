import { z } from 'zod';

/*
 * Contratação pública (V3 · n.º 8): os limiares e as regras que o motor
 * aplica, por município (municipios.contratacao_config). Sem configuração
 * guardada usa-se CONFIG_DEMONSTRACAO.
 *
 * NADA DISTO ESTÁ CONFIRMADO COMO LEI. O valor de 75 000 € para o ajuste
 * direto de serviços vem do PRD do projeto ("desde 1 de outubro de 2026");
 * os restantes valores (bens, empreitadas, consulta prévia, concurso, o
 * limite acumulado e os prazos) são de demonstração. Tudo tem de ser
 * confirmado pelo jurista da câmara contra o Código dos Contratos Públicos
 * na versão em vigor antes de se usar a sério.
 */

export const TIPOS_CONTRATO = ['bens', 'servicos', 'empreitada'] as const;
export type TipoContrato = (typeof TIPOS_CONTRATO)[number];

/** Do menos ao mais exigente: o motor recomenda o primeiro admissível. */
export const PROCEDIMENTOS = [
  'ajuste_direto_simplificado',
  'ajuste_direto',
  'consulta_previa',
  'concurso_publico',
] as const;
export type Procedimento = (typeof PROCEDIMENTOS)[number];

/** Os que podem aparecer no registo (o portal BASE tem mais tipos). */
export const PROCEDIMENTOS_REGISTO = [...PROCEDIMENTOS, 'outro'] as const;
export type ProcedimentoRegisto = (typeof PROCEDIMENTOS_REGISTO)[number];

export const NOMES_PROCEDIMENTO: Record<ProcedimentoRegisto, string> = {
  ajuste_direto_simplificado: 'ajuste direto simplificado',
  ajuste_direto: 'ajuste direto',
  consulta_previa: 'consulta prévia',
  concurso_publico: 'concurso público',
  outro: 'outro procedimento',
};

export const NOMES_TIPO: Record<TipoContrato, string> = {
  bens: 'aquisição de bens',
  servicos: 'aquisição de serviços',
  empreitada: 'empreitada de obras públicas',
};

export const FONTE_CONTRATACAO =
  'Código dos Contratos Públicos (DL 18/2008) na versão em vigor — a confirmar pelo jurista; valores do PRD do projeto';

export const AVISO_RASCUNHO =
  'Rascunho para revisão jurídica: não é uma peça definitiva e não substitui o parecer do jurista.';

const cent = z.number().int().min(0).max(100_000_000_000);

const esquemaLimiares = z.object({
  /** Ajuste direto simplificado: até este valor, inclusive. */
  ajuste_direto_simplificado_cent: cent,
  /** Ajuste direto: abaixo deste valor. */
  ajuste_direto_cent: cent,
  /** Consulta prévia: abaixo deste valor. Daí para cima, concurso. */
  consulta_previa_cent: cent,
  /** A partir deste valor o concurso é publicado também no JOUE (null = não verificar). */
  europeu_cent: cent.nullable(),
  /** De onde vêm estes valores. */
  fonte: z.string().trim().min(1).max(500),
  demonstracao: z.boolean(),
});
export type Limiares = z.infer<typeof esquemaLimiares>;

export const esquemaConfigContratacao = z
  .object({
    demonstracao: z.boolean(),
    fonte: z.string().trim().min(1).max(500),
    tipos: z.object({
      bens: esquemaLimiares,
      servicos: esquemaLimiares,
      empreitada: esquemaLimiares,
    }),
    prazo_max_meses: z.object({
      /** Duração máxima do contrato no ajuste direto simplificado. */
      ajuste_direto_simplificado: z.number().int().min(1).max(240),
      /** Acima disto o contrato precisa de fundamentação (alerta). */
      geral: z.number().int().min(1).max(240),
    }),
    /**
     * Limite acumulado com a mesma entidade (no CCP é o art. 113.º): não se
     * convida quem já teve, neste ano e nos anteriores, contratos de
     * prestações do mesmo tipo cujo preço somado chega ao limite.
     */
    acumulado: z.object({
      /** Anos económicos a somar, contando com o atual (3 = este e os 2 anteriores). */
      anos: z.number().int().min(1).max(10),
      /** null = o limiar do próprio procedimento; um número = limite fixo. */
      limite_cent: cent.nullable(),
      /** Somar também o contrato que se está a preparar. */
      incluir_contrato_atual: z.boolean(),
      /** Que contratos anteriores contam para a soma. */
      contam: z.array(z.enum(PROCEDIMENTOS_REGISTO)).min(1),
      /** Em que procedimentos se aplica a regra. */
      aplica_a: z.array(z.enum(PROCEDIMENTOS)).min(1),
      /** Prestações do mesmo tipo: mesmos N primeiros dígitos do CPV (quando há CPV). */
      cpv_digitos: z.number().int().min(2).max(8),
      a_confirmar: z.boolean(),
      fonte: z.string().trim().min(1).max(500),
    }),
    /** Objetos semelhantes no mesmo ano (possível fracionamento da despesa). */
    fracionamento: z.object({
      /** Semelhança mínima entre as palavras do objeto (0 a 1). */
      semelhanca_minima: z.number().min(0.05).max(1),
      cpv_digitos: z.number().int().min(2).max(8),
      fonte: z.string().trim().min(1).max(500),
    }),
    /** Prazos das peças (dias de calendário). */
    prazos: z.object({
      propostas_ajuste_direto_dias: z.number().int().min(1).max(120),
      propostas_consulta_previa_dias: z.number().int().min(1).max(120),
      propostas_concurso_dias: z.number().int().min(1).max(120),
      propostas_concurso_empreitada_dias: z.number().int().min(1).max(120),
      propostas_concurso_europeu_dias: z.number().int().min(1).max(120),
      audiencia_previa_dias: z.number().int().min(1).max(60),
      publicacao_base_dias: z.number().int().min(1).max(120),
      demonstracao: z.boolean(),
    }),
  })
  .superRefine((c, ctx) => {
    for (const t of TIPOS_CONTRATO) {
      const l = c.tipos[t];
      if (
        l.ajuste_direto_simplificado_cent > l.ajuste_direto_cent ||
        l.ajuste_direto_cent > l.consulta_previa_cent
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['tipos', t],
          message:
            'Os limiares têm de subir: simplificado ≤ ajuste direto ≤ consulta prévia.',
        });
      }
      if (l.europeu_cent !== null && l.europeu_cent < l.consulta_previa_cent) {
        ctx.addIssue({
          code: 'custom',
          path: ['tipos', t, 'europeu_cent'],
          message:
            'O limiar europeu não pode ser inferior ao da consulta prévia.',
        });
      }
    }
  });
export type ConfigContratacao = z.infer<typeof esquemaConfigContratacao>;

const DEMO = 'valor de demonstração — a confirmar pelo jurista';

/** Os valores de partida (demonstração, com a fonte de cada um). */
export const CONFIG_DEMONSTRACAO: ConfigContratacao = {
  demonstracao: true,
  fonte: FONTE_CONTRATACAO,
  tipos: {
    servicos: {
      ajuste_direto_simplificado_cent: 500_000,
      // PRD do projeto: "para aquisição de serviços vai até 75 mil euros
      // desde 1 de outubro de 2026". Não confirmado como lei.
      ajuste_direto_cent: 7_500_000,
      consulta_previa_cent: 15_000_000,
      europeu_cent: 22_100_000,
      fonte:
        'Ajuste direto até 75 000 € citado do PRD do projeto (desde 1 de outubro de 2026); restantes limiares: ' +
        DEMO,
      demonstracao: true,
    },
    bens: {
      ajuste_direto_simplificado_cent: 500_000,
      ajuste_direto_cent: 2_000_000,
      consulta_previa_cent: 7_500_000,
      europeu_cent: 22_100_000,
      fonte: DEMO,
      demonstracao: true,
    },
    empreitada: {
      ajuste_direto_simplificado_cent: 1_000_000,
      ajuste_direto_cent: 3_000_000,
      consulta_previa_cent: 15_000_000,
      europeu_cent: 553_800_000,
      fonte: DEMO,
      demonstracao: true,
    },
  },
  prazo_max_meses: { ajuste_direto_simplificado: 12, geral: 36 },
  acumulado: {
    anos: 3,
    limite_cent: null,
    incluir_contrato_atual: true,
    contam: ['ajuste_direto', 'consulta_previa'],
    aplica_a: ['ajuste_direto', 'consulta_previa'],
    cpv_digitos: 3,
    a_confirmar: true,
    fonte:
      'CCP, art. 113.º (limite acumulado com a mesma entidade) — número de anos e limite a confirmar pelo jurista',
  },
  fracionamento: {
    semelhanca_minima: 0.5,
    cpv_digitos: 3,
    fonte:
      'CCP, art. 22.º (o valor a considerar é o de todas as prestações da mesma necessidade) — a confirmar pelo jurista',
  },
  prazos: {
    propostas_ajuste_direto_dias: 5,
    propostas_consulta_previa_dias: 5,
    propostas_concurso_dias: 9,
    propostas_concurso_empreitada_dias: 14,
    propostas_concurso_europeu_dias: 30,
    audiencia_previa_dias: 5,
    publicacao_base_dias: 20,
    demonstracao: true,
  },
};

/** A configuração guardada (jsonb) ou a de demonstração, se faltar ou for inválida. */
export function configDe(guardada: unknown): ConfigContratacao {
  if (guardada == null) return CONFIG_DEMONSTRACAO;
  const r = esquemaConfigContratacao.safeParse(guardada);
  return r.success ? r.data : CONFIG_DEMONSTRACAO;
}

/** O limiar de um procedimento (o que o define), para o acumulado e os textos. */
export function limiarDe(l: Limiares, p: Procedimento): number | null {
  switch (p) {
    case 'ajuste_direto_simplificado':
      return l.ajuste_direto_simplificado_cent;
    case 'ajuste_direto':
      return l.ajuste_direto_cent;
    case 'consulta_previa':
      return l.consulta_previa_cent;
    default:
      return null;
  }
}
