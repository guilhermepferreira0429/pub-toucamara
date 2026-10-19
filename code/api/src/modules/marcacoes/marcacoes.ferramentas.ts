import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { MarcacoesService } from './marcacoes.service.js';
import { RecolhasService } from './recolhas.service.js';

const telefone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .describe(
    'Telemóvel para o SMS de confirmação, só se não for o número de onde liga (ou no chat).',
  );

export function ferramentasMarcacoes(
  marcacoes: MarcacoesService,
  recolhas: RecolhasService,
) {
  return [
    ferramenta({
      nome: 'ver_vagas',
      descricao:
        'Mostra vagas reais para atendimento presencial marcado num serviço da câmara. ' +
        'Usa quando o munícipe quiser marcar atendimento. Dá agenda_id se já o tiveres; senão descreve o serviço ou assunto em "servico". ' +
        'Lê ao munícipe 2 ou 3 das vagas pelo "dito" e pergunta qual prefere; depois chama marcar com o "inicio" escolhido. ' +
        'Se vier precisa_escolher, pergunta qual das agendas. Se sem_vagas, propõe outro dia.',
      entrada: z.object({
        agenda_id: z
          .uuid()
          .optional()
          .describe('Id da agenda, se já o tiveres.'),
        servico: z
          .string()
          .trim()
          .min(2)
          .max(200)
          .optional()
          .describe(
            'O serviço ou assunto, por palavras do munícipe (ex.: "licenciamento de obras").',
          ),
        dia: z.iso
          .date()
          .optional()
          .describe('Dia pedido (AAAA-MM-DD). Sem dia: os próximos dias.'),
        limite: z.number().int().min(1).max(10).optional(),
      }),
      executar: (ctx, e) => marcacoes.verVagas(ctx, e),
    }),
    ferramenta({
      nome: 'marcar',
      descricao:
        'Marca o atendimento numa vaga devolvida por ver_vagas e manda SMS de confirmação com link para remarcar ou cancelar. ' +
        'Confirma antes com o munícipe o dia e a hora. Depois diz "quando", o local e o que levar. ' +
        'Se der vaga_ocupada ou fora_do_horario, oferece as vagas_alternativas. Se der falta_telefone, pede um telemóvel.',
      entrada: z.object({
        agenda_id: z.uuid().describe('A agenda de ver_vagas.'),
        inicio: z.iso
          .datetime({ offset: true })
          .describe('O "inicio" exato da vaga escolhida (de ver_vagas).'),
        assunto: z
          .string()
          .trim()
          .min(2)
          .max(300)
          .describe(
            'Ao que vai, em poucas palavras (ex.: "entregar projeto de obras").',
          ),
        levar: z
          .array(z.string().trim().min(2).max(120))
          .max(10)
          .optional()
          .describe(
            'Documentos a levar (ex.: "Cartão de Cidadão"), se os souberes pela fonte.',
          ),
        telefone,
      }),
      executar: (ctx, e) => marcacoes.marcar(ctx, e),
    }),
    ferramenta({
      nome: 'agendar_recolha',
      descricao:
        'Marca a recolha gratuita de monos (móveis, colchões, eletrodomésticos) à porta, com a empresa de resíduos do concelho. ' +
        'Pergunta antes o que é (itens e quantidades) e a morada completa; manhã ou tarde se o munícipe tiver preferência. ' +
        'A janela é a próxima livre a partir do dia útil seguinte: diz o "quando" e que vai SMS. ' +
        'Se der sem_entidade_recolha ou sem_janela, passa a um funcionário.',
      entrada: z.object({
        itens: z
          .array(
            z.object({
              item: z.string().trim().min(2).max(100).describe('Ex.: "sofá".'),
              qtd: z.number().int().min(1).max(50),
            }),
          )
          .min(1)
          .max(20),
        morada: z
          .string()
          .trim()
          .min(5)
          .max(300)
          .describe('Morada completa da recolha (rua, número, freguesia).'),
        preferencia: z
          .enum(['manha', 'tarde'])
          .optional()
          .describe('Manhã (8h–12h) ou tarde (13h–17h).'),
        telefone,
      }),
      executar: (ctx, e) => recolhas.agendar(ctx, e),
    }),
    ferramenta({
      nome: 'cancelar_marcacao',
      descricao:
        'Cancela uma marcação de atendimento ou recolha futura do munícipe que está a falar. ' +
        'Sem id: se tiver só uma, cancela-a; se tiver várias, devolve a lista (precisa_escolher) e perguntas qual, ' +
        'chamando outra vez com o id. Confirma antes de cancelar. Diz que vai SMS a confirmar.',
      entrada: z.object({
        id: z
          .uuid()
          .optional()
          .describe('Id da marcação ou recolha a cancelar.'),
      }),
      executar: (ctx, e) => marcacoes.cancelarDoContexto(ctx, e.id),
    }),
  ];
}
