import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { MarcacoesService } from './marcacoes.service.js';
import { RecolhasService } from './recolhas.service.js';

const telefone = z
  .string()
  .trim()
  .max(30)
  .optional()
  .describe('Telemóvel para o SMS, se não for o de onde liga.');

export function ferramentasMarcacoes(
  marcacoes: MarcacoesService,
  recolhas: RecolhasService,
) {
  return [
    ferramenta({
      nome: 'ver_vagas',
      descricao:
        'Quando quer marcar atendimento presencial: vagas reais. Lê 2 ou 3 pelo "dito" e, escolhida, chama marcar com o "inicio". sem_vagas → propõe outro dia.',
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
          .describe('O serviço ou assunto, sem agenda_id.'),
        dia: z.iso.date().optional().describe('Dia pedido, AAAA-MM-DD.'),
        limite: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Máximo de vagas.'),
      }),
      executar: (ctx, e) => marcacoes.verVagas(ctx, e),
    }),
    ferramenta({
      nome: 'marcar',
      descricao:
        'Marca na vaga de ver_vagas escolhida e manda SMS (com link para remarcar). Diz "quando", o local e o que levar. vaga_ocupada ou fora_do_horario → oferece as vagas_alternativas; falta_telefone → pede um telemóvel.',
      entrada: z.object({
        agenda_id: z.uuid().describe('A agenda de ver_vagas.'),
        inicio: z.iso
          .datetime({ offset: true })
          .describe('O "inicio" exato da vaga (de ver_vagas).'),
        assunto: z
          .string()
          .trim()
          .min(2)
          .max(300)
          .describe('Ao que vai, em poucas palavras.'),
        levar: z
          .array(z.string().trim().min(2).max(120))
          .max(10)
          .optional()
          .describe('Documentos a levar, se os souberes pela fonte.'),
        telefone,
      }),
      executar: (ctx, e) => marcacoes.marcar(ctx, e),
    }),
    ferramenta({
      nome: 'agendar_recolha',
      descricao:
        'Recolha gratuita de monos à porta (móveis, colchões, eletrodomésticos): pergunta os itens e quantidades e a morada. Marca a próxima janela livre. sem_entidade_recolha ou sem_janela → passa a um funcionário.',
      entrada: z.object({
        itens: z
          .array(
            z.object({
              item: z.string().trim().min(2).max(100).describe('Ex.: "sofá".'),
              qtd: z.number().int().min(1).max(50).describe('Quantos.'),
            }),
          )
          .min(1)
          .max(20)
          .describe('O que recolher.'),
        morada: z
          .string()
          .trim()
          .min(5)
          .max(300)
          .describe('Rua, número e freguesia.'),
        preferencia: z
          .enum(['manha', 'tarde'])
          .optional()
          .describe('Manhã (8h–12h) ou tarde (13h–17h), se preferir.'),
        telefone,
      }),
      executar: (ctx, e) => recolhas.agendar(ctx, e),
    }),
    ferramenta({
      nome: 'cancelar_marcacao',
      descricao:
        'Quando quer desmarcar um atendimento ou uma recolha (confirma antes). Sem id cancela a única que tiver.',
      entrada: z.object({
        id: z
          .uuid()
          .optional()
          .describe('A marcação ou recolha, se tiver várias.'),
      }),
      executar: (ctx, e) => marcacoes.cancelarDoContexto(ctx, e.id),
    }),
  ];
}
