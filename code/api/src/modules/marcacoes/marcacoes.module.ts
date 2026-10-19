import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { LembretesService } from './lembretes.service.js';
import {
  MarcacoesPainelController,
  MarcacoesPublicoController,
} from './marcacoes.controller.js';
import { ferramentasMarcacoes } from './marcacoes.ferramentas.js';
import { MarcacoesService } from './marcacoes.service.js';
import { RecolhasService } from './recolhas.service.js';

/** Marcações em agendas, recolhas de monos e os lembretes de véspera. */
@Module({
  controllers: [MarcacoesPublicoController, MarcacoesPainelController],
  providers: [MarcacoesService, RecolhasService, LembretesService],
  exports: [MarcacoesService, RecolhasService],
})
export class MarcacoesModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly marcacoes: MarcacoesService,
    private readonly recolhas: RecolhasService,
    private readonly lembretes: LembretesService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ...ferramentasMarcacoes(this.marcacoes, this.recolhas),
    );
    this.jobs.trabalhar('lembretes', () => this.lembretes.correr(), {
      concorrencia: 1,
    });
    this.jobs.agendar('lembretes', '*/15 * * * *');
  }
}
