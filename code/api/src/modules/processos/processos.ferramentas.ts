import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { ProcessosService } from './processos.service.js';

export function ferramentasProcessos(processos: ProcessosService) {
  return [
    ferramenta({
      nome: 'estado_processo',
      descricao:
        'Quando pergunta como está o processo dela (só os da própria pessoa): fase, dias úteis que faltam e o que falta, com prazos. ' +
        'Diz o "resumo" de cada um; se houver vários, pergunta de qual quer saber.',
      agentes: ['entrada', 'saida', 'chat'],
      entrada: z.object({
        numero: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .optional()
          .describe('O número, se o disser ("CP 412/2026" ou "412").'),
      }),
      executar: (ctx, { numero }) => processos.estadoParaAgente(ctx, numero),
    }),
  ];
}
