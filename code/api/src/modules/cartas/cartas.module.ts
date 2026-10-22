import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { AppSessaoService } from '../app-municipe/app-sessao.service.js';
import { AppGuard } from '../app-municipe/app.guard.js';
import { ChatModule } from '../chat/chat.module.js';
import { LinguagemSimplesModule } from '../linguagem-simples/linguagem-simples.module.js';
import { PagamentosModule } from '../pagamentos/pagamentos.module.js';
import { ProcessosModule } from '../processos/processos.module.js';
import {
  CartasAppController,
  CartasChatController,
  CartasPainelController,
  CartasPublicoController,
} from './cartas.controller.js';
import {
  CartasService,
  entradaLerCarta,
  entradaPrepararResposta,
} from './cartas.service.js';

/** Lembretes antes do fim do prazo das cartas (todos os dias de manhã). */
export const FILA_LEMBRETES_CARTAS = 'cartas_lembretes';

/**
 * "Não percebi esta carta da câmara" (o requerimento ao contrário): a
 * pessoa envia a fotografia ou o PDF de um ofício e o agente explica, diz
 * o prazo, liga ao processo e prepara a resposta. Ferramentas `ler_carta`
 * e `preparar_resposta_carta` (chat e voz), página /carta/{codigo}, anexo
 * no chat, app do munícipe e painel ("ofícios que mais confundem").
 */
@Module({
  imports: [
    ChatModule,
    LinguagemSimplesModule,
    PagamentosModule,
    ProcessosModule,
  ],
  controllers: [
    CartasPublicoController,
    CartasChatController,
    CartasAppController,
    CartasPainelController,
  ],
  // A sessão da app (AppGuard) vem do módulo da app, que não a exporta.
  providers: [CartasService, AppSessaoService, AppGuard],
  exports: [CartasService],
})
export class CartasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly cartas: CartasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'ler_carta',
        descricao:
          'Explica uma carta da câmara que a pessoa recebeu e não percebe (ofício, notificação, audiência prévia, pedido de documentos, taxa, coima, edital): o que é, o prazo e a data-limite (calculada por nós), o que acontece se não fizer nada e como responder. ' +
          'No chat, a mensagem da pessoa traz "[carta CODIGO]" quando envia a fotografia: chama com esse código. Sem código: na chamada manda um SMS com o link para fotografar a carta (diz o "dizer" e espera; quando a pessoa disser que enviou, chama outra vez com o código do resultado); no chat pede para anexar. ' +
          'Diz o "dizer" por palavras simples, sem ler os excertos todos. Nunca inventes um prazo: se vier pergunta data_rececao, pergunta em que dia recebeu a carta e chama outra vez com data_rececao. ' +
          'Se vier da_camara: false, a carta é de outra entidade: diz de quem é e encaminha (não prepares resposta). Se vier precisa_identificacao, segue a instrução. ' +
          'Se a pessoa quiser responder, usa preparar_resposta_carta.',
        entrada: entradaLerCarta,
        executar: (ctx, e) => this.cartas.lerCartaAgente(ctx, e),
      }),
      ferramenta({
        nome: 'preparar_resposta_carta',
        descricao:
          'Prepara o rascunho da resposta a uma carta já lida com ler_carta: pronuncia (responder por escrito em audiência prévia ou defesa, com os argumentos que a pessoa disse), prorrogacao (pedir mais tempo), elementos (lista dos documentos pedidos) ou pagamento (referência de teste). ' +
          'Antes da pronúncia, pergunta à pessoa porque não concorda e passa as palavras dela em argumentos (não acrescentes factos). ' +
          'O rascunho fica no link para a pessoa rever, mudar e confirmar: NADA é entregue sem a confirmação dela na página. Diz o "dizer".',
        entrada: entradaPrepararResposta,
        executar: (ctx, e) => this.cartas.prepararRespostaAgente(ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_LEMBRETES_CARTAS, async () => {
      await this.cartas.lembrar();
    });
    // Todos os dias às 9h41 (Lisboa).
    this.jobs.agendar(FILA_LEMBRETES_CARTAS, '41 9 * * *');
  }
}
