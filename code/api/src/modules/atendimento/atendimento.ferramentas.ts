import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { ConversasService } from '../conversas/conversas.service.js';
import {
  Municipe,
  MunicipesService,
  nifValido,
} from '../municipes/municipes.service.js';
import { EncaminhamentoService } from './encaminhamento.service.js';
import { PassagensService } from './passagens.service.js';

/** O NIF como é ditado ("123 456 789", "PT123456789") → só os dígitos. */
export function limparNif(nif: string): string {
  return nif.replace(/\D/g, '');
}

export function ferramentasAtendimento(
  encaminhamento: EncaminhamentoService,
  passagens: PassagensService,
  municipes: MunicipesService,
  conversas: ConversasService,
) {
  return [
    ferramenta({
      nome: 'encaminhar',
      descricao:
        'Quando o assunto pode ser de outra entidade (água, lixo e monos, finanças, segurança social, saúde): quem trata e o contacto, com horário. ' +
        'Outros contactos só se pedir. emergencia: true → segue já a instrucao. Se vier passa_a_pessoa e o caso encaixar, usa passar_a_humano.',
      agentes: ['entrada', 'saida', 'chat'],
      entrada: z.object({
        assunto: z
          .string()
          .trim()
          .min(2)
          .max(300)
          .describe('O problema ou pedido, resumido.'),
      }),
      async executar(ctx, { assunto }) {
        return encaminhamento.procurar(ctx.municipio.id, assunto);
      },
    }),

    ferramenta({
      nome: 'identificar_municipe',
      descricao:
        'Só quando é preciso saber quem é (processos, pedidos em nome dela), depois de pedir o NIF. Devolve o nome; nif_invalido → pede para repetir devagar.',
      agentes: ['entrada', 'saida', 'chat'],
      entrada: z.object({
        nif: z
          .string()
          .trim()
          .min(9)
          .max(20)
          .describe('O NIF dito (9 algarismos).'),
        nome: z
          .string()
          .trim()
          .min(2)
          .max(120)
          .optional()
          .describe('O nome, se o disse.'),
      }),
      async executar(ctx, { nif: dito, nome }) {
        const nif = limparNif(dito);
        if (!nifValido(nif)) {
          return {
            identificado: false,
            motivo: 'nif_invalido',
            dizer:
              'Esse número de contribuinte não parece estar certo. Pode repetir, devagar?',
          };
        }
        const m = ctx.municipio.id;
        let municipe: Municipe | null = await municipes.porNif(m, nif);
        let associado = false;
        if (municipe) {
          if (nome && !municipe.nome) {
            municipe = await municipes.atualizar(municipe.id, { nome });
          }
        } else {
          // Ninguém com este NIF: se o número de onde liga é de um munícipe
          // ainda sem NIF, é ele. Se esse já tem outro NIF (ex.: um familiar
          // a ligar do mesmo telefone), não se mexe.
          const doNumero = ctx.municipeId
            ? await municipes.porId(ctx.municipeId)
            : await municipes.porTelefone(m, ctx.telefone);
          if (doNumero && !doNumero.tem_nif) {
            municipe = await municipes.atualizar(doNumero.id, { nif, nome });
          } else {
            // Chat sem número, ou o número já é de outra pessoa: munícipe
            // novo só com o NIF. Não terá processos, mas fica identificado.
            municipe = await municipes.criar(m, { nif, nome });
          }
          associado = true;
        }
        if (ctx.conversaId) {
          await conversas.ligarMunicipe(ctx.conversaId, municipe.id);
        }
        return {
          identificado: true,
          nome: municipe.nome,
          // NIF acabado de associar ao munícipe do número de onde liga.
          novo: associado,
        };
      },
    }),

    ferramenta({
      nome: 'passar_a_humano',
      descricao:
        'Passa o caso a um funcionário: quando pede uma pessoa, sem fonte, questões jurídicas ou políticas, queixas informais (a formal é registar_reclamacao) ou quando uma regra o diz. ' +
        'Antes pergunta como prefere a resposta. O "dizer" traz até quando respondem.',
      agentes: ['entrada', 'saida', 'chat'],
      entrada: z.object({
        motivo: z
          .enum([
            'pedido',
            'sem_fonte',
            'juridico',
            'politica',
            'processo',
            'outro',
          ])
          .describe('pedido = pediu uma pessoa; processo = processo em curso.'),
        resumo: z
          .string()
          .trim()
          .min(10)
          .max(2000)
          .describe(
            'O que o funcionário precisa de saber, em 2 a 5 frases (pedido, morada ou processo, o que falta). Sem NIF.',
          ),
        preferencia_resposta: z
          .enum(['sms', 'email', 'telefone', 'chat'])
          .optional()
          .describe('Por omissão SMS (no chat, chat).'),
        email: z.email().optional().describe('Se escolheu email.'),
      }),
      async executar(ctx, e) {
        return passagens.criar(ctx, {
          motivo: e.motivo,
          resumo: e.resumo,
          preferencia: e.preferencia_resposta,
          email: e.email,
        });
      },
    }),

    ferramenta({
      nome: 'emergencia',
      descricao:
        'Só DEPOIS de dizer "desligue e ligue já para o 112": regista a emergência (não chama ninguém nem avisa o 112). Sem mais perguntas.',
      agentes: ['entrada', 'saida', 'chat'],
      entrada: z.object({
        situacao: z
          .string()
          .trim()
          .max(300)
          .optional()
          .describe('O que se passa, numa frase.'),
      }),
      async executar(ctx, { situacao }) {
        return passagens.emergencia(ctx, situacao);
      },
    }),
  ];
}
