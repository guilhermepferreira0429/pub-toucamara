import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { ProcessosService } from './processos.service.js';

export function ferramentasProcessos(processos: ProcessosService) {
  return [
    ferramenta({
      nome: 'estado_processo',
      descricao:
        'Diz em que ponto está um processo do munícipe (licenças, comunicações prévias, pedidos já entregues): fase, dias úteis que faltam e o que falta da parte dele, com o prazo de cada pedido. ' +
        'Usa quando a pessoa pergunta "como está o meu processo?". Só mostra processos da própria pessoa. ' +
        'Se vier precisa_identificacao: true, peça o NIF, use identificar_municipe e volte a chamar. ' +
        'Diga o "resumo" de cada processo por palavras simples (inclui até quando tem de entregar cada documento pedido); se houver vários, pergunte de qual quer saber.',
      entrada: z.object({
        numero: z
          .string()
          .trim()
          .min(1)
          .max(40)
          .optional()
          .describe(
            'O número do processo, se a pessoa o disser (ex.: "CP 412/2026" ou só "412"). Sem número devolve os processos em curso.',
          ),
      }),
      executar: (ctx, { numero }) => processos.estadoParaAgente(ctx, numero),
    }),
  ];
}
