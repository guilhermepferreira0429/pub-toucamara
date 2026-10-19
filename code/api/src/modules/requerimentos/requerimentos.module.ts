import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ProcessosModule } from '../processos/processos.module.js';
import {
  RequerimentosPainelController,
  RequerimentosPublicoController,
} from './requerimentos.controller.js';
import { ferramentasRequerimentos } from './requerimentos.ferramentas.js';
import {
  JOB_PDF,
  JOB_TRADUZIR,
  RequerimentosService,
} from './requerimentos.service.js';

@Module({
  imports: [ProcessosModule],
  controllers: [RequerimentosPublicoController, RequerimentosPainelController],
  providers: [RequerimentosService],
  exports: [RequerimentosService],
})
export class RequerimentosModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly requerimentos: RequerimentosService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasRequerimentos(this.requerimentos));
    this.jobs.trabalhar<{ requerimentoId: string }>(
      JOB_PDF,
      ({ requerimentoId }) => this.requerimentos.gerarPdf(requerimentoId),
      { concorrencia: 1 },
    );
    this.jobs.trabalhar<{ requerimentoId: string }>(
      JOB_TRADUZIR,
      ({ requerimentoId }) => this.requerimentos.traduzir(requerimentoId),
      { concorrencia: 2 },
    );
  }
}
