import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { PagamentosService } from './pagamentos.service.js';

const quantidades = z
  .object({
    m2: z.number().positive().optional().describe('Metros quadrados.'),
    dia: z.number().int().positive().optional().describe('Número de dias.'),
    pagina: z.number().int().positive().optional().describe('Páginas.'),
    fogo: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Fogos (habitações).'),
    mesa: z.number().int().positive().optional().describe('Mesas.'),
  })
  .optional()
  .describe(
    'Quantidades ditas pelo munícipe, por unidade; aplicam-se a todas as taxas dessa unidade.',
  );

const taxas = z
  .array(
    z.object({
      codigo: z.string().trim().min(1).describe('Código da taxa na tabela.'),
      quantidade: z.number().positive().optional(),
    }),
  )
  .max(30)
  .optional()
  .describe('Taxas soltas pelo código, se não for um tipo de processo.');

const tipoProcesso = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .optional()
  .describe('Código do tipo de processo (ex.: "CP") ou o seu id.');

export function ferramentasPagamentos(pagamentos: PagamentosService) {
  return [
    ferramenta({
      nome: 'simular_taxa',
      descricao:
        'Calcula quanto o munícipe vai pagar de taxas, pela tabela de taxas em vigor hoje. ' +
        'Usa quando perguntarem "quanto custa" um pedido ou licença. Diz o total_por_extenso e a fonte (tabela e ano). ' +
        'Se vier em_falta, faz a pergunta que lá vem (ex.: quantos metros quadrados) e chama outra vez com a quantidade. ' +
        'É uma estimativa: o valor final é o da guia. Se der sem_tabela_taxas, diz que não tens a tabela e passa a um funcionário.',
      entrada: z.object({
        tipo_processo: tipoProcesso,
        taxas,
        quantidades,
      }),
      async executar(ctx, entrada) {
        const s = await pagamentos.simular(ctx.municipio, entrada);
        return {
          completa: s.completa,
          linhas: s.linhas.map((l) => ({
            codigo: l.codigo,
            descricao: l.descricao,
            unidade: l.unidade,
            quantidade: l.quantidade,
            valor_cent: l.valor_cent,
          })),
          total_cent: s.total_cent,
          total_por_extenso: s.total_por_extenso,
          em_falta: s.em_falta,
          desconhecidas: s.desconhecidas,
          fonte: s.fonte
            ? { ...s.fonte, ano: s.tabela.ano }
            : { titulo: `Tabela de taxas ${s.tabela.ano}`, url: null },
        };
      },
    }),
    ferramenta({
      nome: 'criar_pagamento',
      descricao:
        'Gera a referência Multibanco para pagar as taxas de um requerimento ou processo e manda-a por SMS. ' +
        'Usa depois de o requerimento estar entregue e de o munícipe aceitar pagar; sem ids, usa o requerimento desta conversa. ' +
        'O valor é recalculado aqui (passa as mesmas quantidades da simulação). ' +
        'Diz o valor_por_extenso, que a referência seguiu por SMS e o prazo (pagar_ate_dito). ' +
        'Diz SEMPRE que está em modo de teste e nada é cobrado (frase em "dizer"). ' +
        'Se der faltam_quantidades, pergunta o que falta; se der sem_objeto_a_pagar, preenche primeiro o requerimento.',
      entrada: z.object({
        requerimento_id: z.uuid().optional().describe('Id do requerimento.'),
        processo_id: z.uuid().optional().describe('Id do processo.'),
        tipo_processo: tipoProcesso,
        taxas,
        quantidades,
      }),
      executar: (ctx, entrada) => pagamentos.criar(ctx, entrada),
    }),
  ];
}
