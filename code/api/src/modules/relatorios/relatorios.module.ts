import { Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module.js';
import { PainelModule } from '../painel/painel.module.js';
import { RelatoriosController } from './relatorios.controller.js';
import { RelatoriosService } from './relatorios.service.js';
import { ResumoDiarioService } from './resumo-diario.service.js';

/**
 * Relatórios: `relatorio_semanal` (segunda, 08:00) e `relatorio_mensal`
 * (dia 1, 08:00), `resumo_diario` (de hora a hora aos :30; cada município
 * recebe às 07:30 do seu fuso, se estiver ativo), mais o pedido manual no
 * painel.
 */
@Module({
  imports: [PainelModule, ConhecimentoModule],
  controllers: [RelatoriosController],
  providers: [RelatoriosService, ResumoDiarioService],
})
export class RelatoriosModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly relatorios: RelatoriosService,
    private readonly diario: ResumoDiarioService,
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
    // Aos :30 de cada hora: os fusos portugueses diferem em horas inteiras,
    // por isso cada município passa pelas 07:30 locais numa destas voltas.
    this.jobs.trabalhar('resumo_diario', () => this.diario.correrJob());
    this.jobs.agendar('resumo_diario', '30 * * * *');
  }
}
