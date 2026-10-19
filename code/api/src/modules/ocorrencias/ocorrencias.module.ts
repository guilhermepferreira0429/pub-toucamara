import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { GeocodificacaoService } from './geocodificacao.js';
import { OcorrenciasPainelController } from './ocorrencias-painel.controller.js';
import { OcorrenciasPublicoController } from './ocorrencias-publico.controller.js';
import { ferramentasOcorrencias } from './ocorrencias.ferramentas.js';
import { OcorrenciasService } from './ocorrencias.service.js';

@Module({
  controllers: [OcorrenciasPainelController, OcorrenciasPublicoController],
  providers: [OcorrenciasService, GeocodificacaoService],
  exports: [OcorrenciasService],
})
export class OcorrenciasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly ocorrencias: OcorrenciasService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasOcorrencias(this.ocorrencias));
  }
}
