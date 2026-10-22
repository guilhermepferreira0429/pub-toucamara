import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import {
  AgoraPublicoController,
  ComunicadosController,
  EventosController,
  PainelAgoraController,
} from './agora.controller.js';
import { AgoraPublicacoesService } from './agora.publicacoes.js';
import {
  AgoraService,
  entradaAvisarMe,
  entradaOQueSePassa,
} from './agora.service.js';
import { AgoraSubscricoesService } from './agora.subscricoes.js';

/** De 5 em 5 minutos: geocodifica o que falta e manda os avisos das subscrições. */
export const FILA_AGORA = 'agora_avisos';

/**
 * "O que se passa no concelho, perto de mim": feed público (app), as
 * ferramentas o_que_se_passa e avisar_me (agente, chat, SMS e WhatsApp sem
 * IA), comunicados e eventos no painel e o job das subscrições.
 */
@Module({
  controllers: [
    AgoraPublicoController,
    ComunicadosController,
    EventosController,
    PainelAgoraController,
  ],
  providers: [
    AgoraService,
    AgoraPublicacoesService,
    AgoraSubscricoesService,
    GeocodificacaoService,
  ],
  exports: [AgoraService],
})
export class AgoraModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly agora: AgoraService,
    private readonly subscricoes: AgoraSubscricoesService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'o_que_se_passa',
        descricao:
          'Quando pergunta por obras, ruas cortadas, avisos ou eventos perto dela: os itens mais relevantes. Usa a morada que conhecemos; precisa_morada → pergunta UMA vez a rua ou a freguesia (sem número de porta).',
        entrada: entradaOQueSePassa,
        executar: (ctx, e) => this.agora.oQueSePassa(ctx, e),
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'avisar_me',
        descricao:
          'Quando quer ser avisada por SMS do que aparecer na rua ou freguesia (obras, incidentes, eventos, avisos). Confirma o quê e onde (rua sem número de porta, ou freguesia).',
        entrada: entradaAvisarMe,
        executar: (ctx, e) => this.agora.avisarMe(ctx, e),
      }),
    );
    this.jobs.trabalhar(
      FILA_AGORA,
      async () => {
        await this.agora.atualizarLocais();
        await this.subscricoes.processar();
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar(FILA_AGORA, '*/5 * * * *');
  }
}
