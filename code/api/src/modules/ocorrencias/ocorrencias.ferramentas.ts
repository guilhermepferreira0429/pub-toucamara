import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { OcorrenciasService } from './ocorrencias.service.js';

export function ferramentasOcorrencias(ocorrencias: OcorrenciasService) {
  return [
    ferramenta({
      nome: 'registar_ocorrencia',
      descricao:
        'Problema na via pública (buraco, candeeiro apagado, lixo, árvore caída), depois de confirmar a morada e o que se passa. ' +
        'duplicada: true → já estava reportado: juntámos o aviso e a pessoa é avisada quando estiver resolvido. Se der erro, pede desculpa e passa a um funcionário.',
      entrada: z.object({
        categoria: z
          .string()
          .trim()
          .min(2)
          .max(120)
          .describe('O tipo de problema, ou o nome da categoria.'),
        descricao: z
          .string()
          .trim()
          .min(3)
          .max(1000)
          .describe('O que se passa, em poucas frases.'),
        morada: z
          .string()
          .trim()
          .min(3)
          .max(300)
          .describe('Rua e número ou cruzamento, e freguesia.'),
        ponto_referencia: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe('Ex.: "em frente à farmácia".'),
      }),
      executar: (ctx, entrada) => ocorrencias.registar(ctx, entrada),
    }),
    ferramenta({
      nome: 'estado_ocorrencia',
      descricao:
        'Quando pergunta por um problema que já reportou: o estado_explicado e a data prevista. Sem número, as últimas deste telefone; se não encontrar, pede o número do SMS.',
      entrada: z.object({
        numero: z
          .string()
          .trim()
          .max(20)
          .optional()
          .describe('Como o disser ("OC-0381", "381").'),
      }),
      executar: (ctx, { numero }) => ocorrencias.estado(ctx, numero),
    }),
  ];
}
