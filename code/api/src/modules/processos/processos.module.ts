import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import {
  ProcessosPainelController,
  ProcessosPublicoController,
  TiposProcessoController,
} from './processos.controller.js';
import { ferramentasProcessos } from './processos.ferramentas.js';
import { ProcessosPainelService } from './processos-painel.service.js';
import { ProcessosService } from './processos.service.js';
import { TiposProcessoService } from './tipos-processo.service.js';

@Module({
  controllers: [
    ProcessosPainelController,
    TiposProcessoController,
    ProcessosPublicoController,
  ],
  providers: [ProcessosService, ProcessosPainelService, TiposProcessoService],
  exports: [ProcessosService, TiposProcessoService],
})
export class ProcessosModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly processos: ProcessosService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasProcessos(this.processos));
  }
}
