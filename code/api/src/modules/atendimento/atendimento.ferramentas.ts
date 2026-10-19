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
        'Diz que entidade trata de um assunto que não é da câmara (água e saneamento, lixo e monos, finanças, ' +
        'segurança social, saúde, emergências...) e o contacto certo, com horário e se está aberto agora. ' +
        'Usa quando o munícipe pergunta por algo que pode ser de outra entidade. Diz o texto de "dizer" e, se ' +
        'pedir, os outros contactos. Se vier emergencia: true, segue a "instrucao" de imediato. Se ' +
        '"passa_a_pessoa" vier preenchido e o caso do munícipe encaixar nessa condição, usa passar_a_humano. ' +
        'Se vier encontrada: false, procura no conhecimento ou passa a um funcionário; nunca inventes contactos.',
      entrada: z.object({
        assunto: z
          .string()
          .trim()
          .min(2)
          .max(300)
          .describe(
            'O problema ou pedido, resumido (ex.: "rotura de água na rua", "recolha de um sofá velho", "IMI").',
          ),
      }),
      async executar(ctx, { assunto }) {
        return encaminhamento.procurar(ctx.municipio.id, assunto);
      },
    }),

    ferramenta({
      nome: 'identificar_municipe',
      descricao:
        'Identifica o munícipe pelo número de contribuinte (NIF) que ele diz. Usa só quando é preciso saber ' +
        'quem é (ex.: estado de um processo, requerimento em nome dele) e depois de lhe pedir o NIF. ' +
        'Se vier identificado: true, trata-o pelo nome se houver. Se vier nif_invalido, pede para repetir ' +
        'devagar, algarismo a algarismo. Nunca repitas o NIF em voz alta.',
      entrada: z.object({
        nif: z
          .string()
          .trim()
          .min(9)
          .max(20)
          .describe(
            'O NIF dito na chamada, 9 algarismos (espaços não importam).',
          ),
        nome: z
          .string()
          .trim()
          .min(2)
          .max(120)
          .optional()
          .describe('O nome, se o munícipe o disse.'),
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
        'Passa o caso a um funcionário da câmara, com um resumo do que ele já precisa de saber. Usa quando o ' +
        'munícipe pede uma pessoa, quando o conhecimento vem sem fonte, em questões jurídicas ou políticas, ' +
        'reclamações, ou quando uma regra diz que passa a pessoa. Antes de chamar, pergunta como prefere a ' +
        'resposta (SMS, email ou telefone) se ainda não sabes. Depois diz o texto de "dizer" tal como vem ' +
        '(inclui até quando respondem) e não prometas outro prazo.',
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
          .describe(
            'pedido: pediu uma pessoa; sem_fonte: não há resposta oficial; juridico; politica; processo: sobre um processo em curso; outro.',
          ),
        resumo: z
          .string()
          .trim()
          .min(10)
          .max(2000)
          .describe(
            'O que o funcionário já sabe, em 2 a 5 frases: o pedido, a morada ou o processo se houver, o que já foi dito e o que falta. Sem NIF.',
          ),
        preferencia_resposta: z
          .enum(['sms', 'email', 'telefone', 'chat'])
          .optional()
          .describe(
            'Como quer a resposta. Por defeito: SMS ao telefone, chat no chat.',
          ),
        email: z
          .email()
          .optional()
          .describe('O email, se escolheu resposta por email e o disse.'),
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
        'Regista que a conversa é uma emergência (incêndio, acidente, pessoa ferida ou em perigo, crime a ' +
        'acontecer). PRIMEIRO diz ao munícipe "Desligue e ligue já para o 112" e SÓ DEPOIS chama esta ' +
        'ferramenta: ela não chama ninguém nem avisa o 112, só deixa registado. Não faças mais perguntas.',
      entrada: z.object({
        situacao: z
          .string()
          .trim()
          .max(300)
          .optional()
          .describe(
            'O que se passa, numa frase (ex.: "fumo a sair de uma casa").',
          ),
      }),
      async executar(ctx, { situacao }) {
        return passagens.emergencia(ctx, situacao);
      },
    }),
  ];
}
