import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RetomarService } from './retomar.service.js';

export function ferramentasRetomar(retomar: RetomarService) {
  return [
    ferramenta({
      nome: 'conversa_anterior',
      descricao:
        'O que se tratou nas conversas anteriores desta pessoa (últimos 30 dias): resumo, próximos passos e o que ficou registado ' +
        '(requerimentos, processos, ocorrências, marcações, com estado). ' +
        'Usa quando a pessoa diz que já ligou ou escreveu antes ("liguei ontem por causa de…") e o contexto do início não chega. ' +
        'Continua o assunto sem lhe pedir que repita. Se vier precisa_identificacao: true, segue a instrução.',
      entrada: z.object({
        quantas: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe(
            'Quantas conversas, da mais recente para trás (por defeito 1; até 3 se a pessoa não disser qual).',
          ),
      }),
      async executar(ctx, { quantas }) {
        return retomar.paraFerramenta(ctx, quantas ?? 1);
      },
    }),
  ];
}
