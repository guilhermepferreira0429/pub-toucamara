import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { ConhecimentoService } from './conhecimento.service.js';

export function ferramentasConhecimento(
  conhecimento: ConhecimentoService,
  conversas: ConversasService,
) {
  return [
    ferramenta({
      nome: 'procurar_conhecimento',
      descricao:
        'Procura a resposta nas fontes oficiais do concelho (câmara, empresas municipais, juntas, leis e regulamentos). ' +
        'Usa sempre antes de responder a uma pergunta sobre regras, prazos, taxas, documentos ou contactos. ' +
        'Responde só com o que vem nos resultados e diz a fonte. Se vier sem_fonte: true, não inventes: passa a um funcionário.',
      entrada: z.object({
        pergunta: z
          .string()
          .trim()
          .min(2)
          .max(500)
          .describe(
            'A pergunta do munícipe, por palavras dele ou resumida (ex.: "preciso de licença para abrir uma porta na sala?").',
          ),
        limite: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Quantos resultados no máximo (por defeito 5).'),
      }),
      async executar(ctx, { pergunta, limite }) {
        const r = await conhecimento.procurar(
          ctx.municipio.id,
          pergunta,
          limite,
        );
        if (!r.sem_fonte) {
          await conversas.momento(ctx.conversaId, 'resposta_com_fonte', {
            pergunta,
            trechos: r.trechos.map((t) => t.trecho_id),
            respostas: r.respostas.map((x) => x.resposta_id),
          });
        }
        return r;
      },
    }),
  ];
}
