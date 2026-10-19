import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { OcorrenciasService } from './ocorrencias.service.js';

export function ferramentasOcorrencias(ocorrencias: OcorrenciasService) {
  return [
    ferramenta({
      nome: 'registar_ocorrencia',
      descricao:
        'Regista um problema na via pública (buraco, candeeiro apagado, lixo, árvore caída, sinal partido...). ' +
        'Antes de chamar, confirma com o munícipe a morada (rua, número ou cruzamento e freguesia) e o que se passa. ' +
        'Se vier registada: false com categorias, pergunta qual delas é e volta a chamar com esse nome. ' +
        'Se vier duplicada: true, o problema já estava reportado: diz que juntámos o aviso dele e que vai ser avisado quando estiver resolvido. ' +
        'Diz o texto de "dizer" (o número da ocorrência devagar). Não leias links em voz alta. ' +
        'Se der erro, pede desculpa e passa a um funcionário; não digas que ficou registada.',
      entrada: z.object({
        categoria: z
          .string()
          .trim()
          .min(2)
          .max(120)
          .describe(
            'O tipo de problema, pelo nome da categoria ou por palavras do munícipe (ex.: "buraco na estrada", "candeeiro apagado").',
          ),
        descricao: z
          .string()
          .trim()
          .min(3)
          .max(1000)
          .describe(
            'O que se passa, em poucas frases (ex.: "buraco grande na faixa da direita, já fez furar um pneu").',
          ),
        morada: z
          .string()
          .trim()
          .min(3)
          .max(300)
          .describe(
            'Onde: rua e número ou cruzamento, e freguesia se a disser (ex.: "Rua Direita 45, freguesia de São Pedro").',
          ),
        ponto_referencia: z
          .string()
          .trim()
          .max(200)
          .optional()
          .describe(
            'Referência para encontrar o sítio, se o munícipe a der (ex.: "em frente à farmácia").',
          ),
      }),
      executar: (ctx, entrada) => ocorrencias.registar(ctx, entrada),
    }),
    ferramenta({
      nome: 'estado_ocorrencia',
      descricao:
        'Diz em que ponto está uma ocorrência já reportada. Usa com o número (vem no SMS, ex.: OC-0381) ' +
        'ou sem número para ver as últimas reportadas a partir deste telefone. ' +
        'Diz o "estado_explicado" e, se houver, a data prevista. Se não encontrar, pede o número do SMS.',
      entrada: z.object({
        numero: z
          .string()
          .trim()
          .max(20)
          .optional()
          .describe(
            'Número da ocorrência como o munícipe o disser ("OC-0381", "381"). Omitir para procurar pelo telefone.',
          ),
      }),
      executar: (ctx, { numero }) => ocorrencias.estado(ctx, numero),
    }),
  ];
}
