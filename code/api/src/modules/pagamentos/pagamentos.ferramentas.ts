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
  .describe('Quantidades ditas, por unidade.');

const taxas = z
  .array(
    z.object({
      codigo: z.string().trim().min(1).describe('Código na tabela.'),
      quantidade: z.number().positive().optional().describe('Quantidade.'),
    }),
  )
  .max(30)
  .optional()
  .describe('Taxas soltas, se não for um tipo de processo.');

const tipoProcesso = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .optional()
  .describe('Código do tipo de processo (ex.: "CP").');

export function ferramentasPagamentos(pagamentos: PagamentosService) {
  return [
    ferramenta({
      nome: 'simular_taxa',
      descricao:
        'Quando pergunta quanto custa um pedido ou licença: as taxas pela tabela em vigor. Diz o total_por_extenso e a fonte (tabela e ano); é uma estimativa (vale a guia). ' +
        'sem_tabela_taxas → passa a um funcionário.',
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
        'Quando aceita pagar as taxas de um requerimento entregue ou processo: referência Multibanco (ou MB WAY para o telemóvel de onde liga) por SMS. Passa as mesmas quantidades da simulação. ' +
        'Diz o valor_por_extenso e o prazo (pagar_ate_dito). falta_telemovel/telemovel_invalido → pergunta o número do MB WAY; sem_objeto_a_pagar → preenche primeiro o requerimento.',
      entrada: z.object({
        requerimento_id: z.uuid().optional().describe('Id do requerimento.'),
        processo_id: z.uuid().optional().describe('Id do processo.'),
        tipo_processo: tipoProcesso,
        taxas,
        quantidades,
        metodo: z
          .enum(['multibanco', 'mbway'])
          .optional()
          .describe('Por omissão multibanco.'),
        telemovel: z
          .string()
          .trim()
          .min(9)
          .max(20)
          .optional()
          .describe('Do MB WAY, se não for o de onde liga.'),
      }),
      executar: (ctx, entrada) => pagamentos.criar(ctx, entrada),
    }),
  ];
}
