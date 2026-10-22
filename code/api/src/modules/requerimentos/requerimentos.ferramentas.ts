import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RequerimentosService } from './requerimentos.service.js';

const idOpcional = z
  .uuid()
  .optional()
  .describe('De iniciar_requerimento (sem ele, o desta conversa).');

export function ferramentasRequerimentos(requerimentos: RequerimentosService) {
  return [
    ferramenta({
      nome: 'iniciar_requerimento',
      descricao:
        'Quando quer fazer um pedido à câmara e o conhecimento confirmou o procedimento (ex.: comunicação prévia): devolve os campos. ' +
        'Diz a frase_do_agente, faz a proxima_pergunta (uma de cada vez) e grava cada resposta com preencher_campo.',
      entrada: z.object({
        tipo: z
          .string()
          .trim()
          .min(2)
          .max(200)
          .describe('O código do tipo (ex.: "CP") ou o pedido por palavras.'),
        idioma: z
          .string()
          .trim()
          .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Código BCP 47.')
          .optional()
          .describe('A língua da conversa (BCP 47), se não for português.'),
      }),
      executar: (ctx, { tipo, idioma }) =>
        requerimentos.iniciar(ctx, tipo, idioma),
    }),

    ferramenta({
      nome: 'preencher_campo',
      descricao:
        'A cada resposta do requerimento: grava os campos pelas chaves de iniciar_requerimento (corrigir: manda outra vez; null apaga). Erros → pede de novo esse campo, explicando. ' +
        'Depois a proxima_pergunta; quando vier null, confirma os dados e concluir_requerimento.',
      entrada: z.object({
        requerimento_id: idOpcional,
        campos: z
          .record(
            z.string(),
            z.union([z.string(), z.number(), z.boolean(), z.null()]),
          )
          .refine(
            (c) => Object.keys(c).length > 0,
            'Indique pelo menos um campo.',
          )
          .describe(
            'Campos por chave, ex.: { "area_m2": "18,5" }. Datas como dia/mês/ano.',
          ),
      }),
      executar: (ctx, { requerimento_id, campos }) =>
        requerimentos.preencher(ctx, requerimento_id, campos),
    }),

    ferramenta({
      nome: 'concluir_requerimento',
      descricao:
        'Quando todos os campos estão confirmados: fecha o requerimento (PDF e SMS para rever, assinar e juntar documentos). Erro campos_em_falta → pergunta e grava com preencher_campo antes.',
      entrada: z.object({ requerimento_id: idOpcional }),
      executar: (ctx, { requerimento_id }) =>
        requerimentos.concluir(ctx, requerimento_id),
    }),
  ];
}
