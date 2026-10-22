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
          'Quando recebeu uma carta da câmara e não a percebe: o que é, a data-limite (calculada por nós), o que acontece se não fizer nada e como responder. ' +
          'Sem código: na chamada manda SMS para fotografar (espera e chama com o código do resultado); no chat pede para anexar ([carta CODIGO] na mensagem). ' +
          'Não leias os excertos todos. Nunca inventes o prazo (se pedir data_rececao, pergunta o dia). da_camara: false → diz de quem é e encaminha.',
        entrada: entradaLerCarta,
        executar: (ctx, e) => this.cartas.lerCartaAgente(ctx, e),
      }),
      ferramenta({
        nome: 'preparar_resposta_carta',
        descricao:
          'Depois de ler_carta, quando quer responder: o rascunho vai no link, para a pessoa rever e confirmar (nada é entregue sem isso). ' +
          'Na pronúncia, pergunta porque não concorda e passa as palavras dela (sem acrescentar factos).',
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
