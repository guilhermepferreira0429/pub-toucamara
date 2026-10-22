import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RetomarService } from './retomar.service.js';

export function ferramentasRetomar(retomar: RetomarService) {
  return [
    ferramenta({
      nome: 'conversa_anterior',
      descricao:
        'Quando diz que já ligou ou escreveu antes e o contexto do início não chega: resumo, próximos passos e o que ficou registado (30 dias). Continua sem pedir que repita.',
      entrada: z.object({
        quantas: z
          .number()
          .int()
          .min(1)
          .max(3)
          .optional()
          .describe('Quantas, da mais recente (1; até 3 se não disser qual).'),
      }),
      async executar(ctx, { quantas }) {
        return retomar.paraFerramenta(ctx, quantas ?? 1);
      },
    }),
  ];
}
