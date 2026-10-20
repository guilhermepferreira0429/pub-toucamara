import { Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import { GestaoDocumentalService } from './gestao-documental.service.js';
import {
  GestaoDocumentalController,
  IntegracoesProcessosController,
} from './integracoes.controller.js';
import { MosaicosOsmService } from './mosaicos-osm.service.js';
import { PlantaService } from './planta.service.js';

/**
 * V2 · Integrações: a gestão documental que a câmara já usa (adaptadores,
 * job `sync_gestao_documental`) e a planta de localização (OpenStreetMap,
 * job `plantas_localizacao`). Migração 0030.
 *
 * A geocodificação é a das ocorrências (o módulo delas não a exporta):
 * instância própria, com a sua cache.
 */
@Module({
  controllers: [GestaoDocumentalController, IntegracoesProcessosController],
  providers: [
    GestaoDocumentalService,
    PlantaService,
    MosaicosOsmService,
    GeocodificacaoService,
  ],
  exports: [GestaoDocumentalService, PlantaService],
})
export class IntegracoesModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly gd: GestaoDocumentalService,
    private readonly plantas: PlantaService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar(
      'sync_gestao_documental',
      async () => {
        await this.gd.sincronizarPendentes();
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar('sync_gestao_documental', '*/15 * * * *');

    // Desfasado da sincronização (minutos 7, 22, 37, 52): a planta nova
    // segue para a gestão documental na volta seguinte.
    this.jobs.trabalhar(
      'plantas_localizacao',
      async () => {
        await this.plantas.gerarEmFalta();
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar('plantas_localizacao', '7-59/15 * * * *');
  }
}
