import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module.js';
import {
  ProcessosPainelController,
  ProcessosPublicoController,
  RascunhosController,
  TiposProcessoController,
} from './processos.controller.js';
import { ferramentasProcessos } from './processos.ferramentas.js';
import { ProcessosApoioService } from './processos-apoio.service.js';
import { ProcessosAvisosService } from './processos-avisos.service.js';
import { ProcessosPainelService } from './processos-painel.service.js';
import { ProcessosService } from './processos.service.js';
import { TiposProcessoService } from './tipos-processo.service.js';

@Module({
  // Pesquisa no conhecimento para o regulamento aplicável.
  imports: [ConhecimentoModule],
  controllers: [
    ProcessosPainelController,
    RascunhosController,
    TiposProcessoController,
    ProcessosPublicoController,
  ],
  providers: [
    ProcessosService,
    ProcessosPainelService,
    ProcessosAvisosService,
    ProcessosApoioService,
    TiposProcessoService,
  ],
  exports: [ProcessosService, TiposProcessoService],
})
export class ProcessosModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly processos: ProcessosService,
    private readonly avisos: ProcessosAvisosService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasProcessos(this.processos));
    // Lembretes do prazo de resposta do munícipe (o `lembretes` é o das marcações).
    this.jobs.trabalhar(
      'lembretes_prazos',
      async () => {
        await this.avisos.lembrarPrazos();
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar('lembretes_prazos', '*/15 * * * *');
  }
}
