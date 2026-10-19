import { Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module.js';
import { AgenteController } from './agente.controller.js';
import { AgenteService } from './agente.service.js';
import { EquipaController } from './equipa.controller.js';
import { EquipaService } from './equipa.service.js';
import { PainelDadosService } from './painel-dados.service.js';
import { PainelService } from './painel.service.js';
import { RgpdService } from './rgpd.service.js';
import { VisaoGeralController } from './visao-geral.controller.js';

/**
 * Painel: Visão geral, Indicadores, Equipa e acessos (com RGPD) e Agente.
 * Jobs: `refrescar_vistas` a cada 5 min (vistas da 0018) e `retencao_rgpd`
 * às 03:30.
 */
@Module({
  imports: [ConhecimentoModule],
  controllers: [VisaoGeralController, EquipaController, AgenteController],
  providers: [
    PainelDadosService,
    PainelService,
    EquipaService,
    AgenteService,
    RgpdService,
  ],
  exports: [PainelDadosService],
})
export class PainelModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly dados: PainelDadosService,
    private readonly rgpd: RgpdService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar('refrescar_vistas', () => this.dados.refrescar(), {
      concorrencia: 1,
    });
    this.jobs.agendar('refrescar_vistas', '*/5 * * * *');
    this.jobs.trabalhar('retencao_rgpd', () => this.rgpd.correr(), {
      concorrencia: 1,
    });
    this.jobs.agendar('retencao_rgpd', '30 3 * * *');
  }
}
