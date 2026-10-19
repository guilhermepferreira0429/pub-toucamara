import { Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import { PainelModule } from '../painel/painel.module.js';
import { RelatoriosController } from './relatorios.controller.js';
import { RelatoriosService } from './relatorios.service.js';

/**
 * Relatórios: `relatorio_semanal` (segunda, 08:00) e `relatorio_mensal`
 * (dia 1, 08:00), mais o pedido manual no painel.
 */
@Module({
  imports: [PainelModule],
  controllers: [RelatoriosController],
  providers: [RelatoriosService],
})
export class RelatoriosModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly relatorios: RelatoriosService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar('relatorio_semanal', () =>
      this.relatorios.correrJob('semanal'),
    );
    this.jobs.agendar('relatorio_semanal', '0 8 * * 1');
    this.jobs.trabalhar('relatorio_mensal', () =>
      this.relatorios.correrJob('mensal'),
    );
    this.jobs.agendar('relatorio_mensal', '0 8 1 * *');
  }
}
