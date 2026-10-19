import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RequerimentosService } from './requerimentos.service.js';

const idOpcional = z
  .uuid()
  .optional()
  .describe(
    'O requerimento_id devolvido por iniciar_requerimento. Sem ele usa o requerimento aberto nesta conversa.',
  );

export function ferramentasRequerimentos(requerimentos: RequerimentosService) {
  return [
    ferramenta({
      nome: 'iniciar_requerimento',
      descricao:
        'Começa a preencher um requerimento à câmara durante a conversa (ex.: comunicação prévia de obras). ' +
        'Usa quando o munícipe quer fazer o pedido e o conhecimento confirmou que é este o procedimento. ' +
        'Devolve os campos e a pergunta a fazer para cada um: diga a frase_do_agente, depois faça a proxima_pergunta, uma de cada vez, e grave cada resposta com preencher_campo. ' +
        'Se vier encontrado: false, pergunte ao munícipe qual das opcoes é a dele e volte a chamar com o código.',
      entrada: z.object({
        tipo: z
          .string()
          .trim()
          .min(2)
          .max(200)
          .describe(
            'O código do tipo de processo (ex.: "CP") ou o pedido por palavras do munícipe (ex.: "obras de alteração na cozinha").',
          ),
      }),
      executar: (ctx, { tipo }) => requerimentos.iniciar(ctx, tipo),
    }),

    ferramenta({
      nome: 'preencher_campo',
      descricao:
        'Grava no requerimento um ou mais campos que o munícipe acabou de dizer (o ecrã da câmara mostra-o ao vivo). ' +
        'Usa a chave de cada campo de iniciar_requerimento. Para corrigir, volte a mandar o campo com o valor certo (ou null para apagar). ' +
        'Se vierem erros, peça de novo esse campo explicando o problema. Depois faça a proxima_pergunta; quando for null, confirme os dados e chame concluir_requerimento. ' +
        'O NIF do requerente fica guardado cifrado: não o repita em voz alta.',
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
            'Campos por chave, ex.: { "morada_obra": "Rua de Santo António, 12", "area_m2": "18,5", "tem_tecnico": "sim" }. Datas como dia/mês/ano.',
          ),
      }),
      executar: (ctx, { requerimento_id, campos }) =>
        requerimentos.preencher(ctx, requerimento_id, campos),
    }),

    ferramenta({
      nome: 'concluir_requerimento',
      descricao:
        'Fecha o preenchimento depois de o munícipe confirmar os dados: o requerimento fica pronto, gera-se o PDF e vai um SMS com o link para rever, assinar e enviar os documentos que faltam. ' +
        'Diga ao munícipe o texto de o_que_dizer. Se der erro campos_em_falta, faça a proxima_pergunta dos detalhes e grave com preencher_campo antes de tentar outra vez.',
      entrada: z.object({ requerimento_id: idOpcional }),
      executar: (ctx, { requerimento_id }) =>
        requerimentos.concluir(ctx, requerimento_id),
    }),
  ];
}
