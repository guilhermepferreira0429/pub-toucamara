import { Global, Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import { FILA_PUSH, PushParaMunicipe, PushService } from './push.service.js';

/**
 * Push para a app do munícipe (FCM). Global: os módulos que já mandam SMS
 * (avisos por zona, emergências, processos...) injetam o PushService sem
 * dependências circulares. A fila `push_enviar` manda os envios em massa.
 */
@Global()
@Module({
  providers: [PushService],
  exports: [PushService],
})
export class PushModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar<{ municipeIds: string[]; push: PushParaMunicipe }>(
      FILA_PUSH,
      (dados) => this.push.processarFila(dados),
      { concorrencia: 2 },
    );
  }
}
