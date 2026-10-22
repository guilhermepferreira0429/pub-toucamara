import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import {
  AgoraPublicoController,
  ComunicadosController,
  EventosController,
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
          'O que se passa no concelho perto da pessoa: obras e ruas cortadas, incidentes, avisos e comunicados da câmara, eventos e consultas públicas. ' +
          'Usa para "há obras na minha rua?", "o que há este fim de semana na minha freguesia?", "porque é que a rua está fechada?". ' +
          'Usa a morada que já conhecemos da pessoa; se vier precisa_morada, pergunta UMA vez a rua ou a freguesia (sem número de porta) e chama outra vez com morada. ' +
          'Devolve os itens mais relevantes (perto, a decorrer, mais graves primeiro) e um "dizer" curto. Só leitura.',
        entrada: entradaOQueSePassa,
        executar: (ctx, e) => this.agora.oQueSePassa(ctx, e),
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'avisar_me',
        descricao:
          'Subscreve avisos por SMS quando aparecer algo novo na rua ou na freguesia da pessoa: obras e cortes, incidentes, eventos ou avisos da câmara ("avise-me quando houver obras na minha rua"). ' +
          'Confirma com a pessoa o que quer e onde (rua sem número de porta, ou freguesia). Se vier precisa_morada, pergunta a rua ou a freguesia e chama outra vez. ' +
          'No fim diz o "dizer".',
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
