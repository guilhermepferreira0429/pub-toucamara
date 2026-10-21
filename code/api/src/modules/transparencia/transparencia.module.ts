import { Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import {
  DadosAbertosPublicoController,
  IndicadoresPublicoController,
  TransparenciaPainelController,
} from './transparencia.controller.js';
import { TransparenciaService } from './transparencia.service.js';

export const FILA_TRANSPARENCIA = 'transparencia_publicar';

/**
 * Transparência (V3 · FUN §13, ponto 10): dados abertos e indicadores no
 * portal. Todas as noites (04:23) volta a calcular os conjuntos ligados de
 * cada município e publica uma versão nova só quando os números mudaram.
 */
@Module({
  controllers: [
    TransparenciaPainelController,
    DadosAbertosPublicoController,
    IndicadoresPublicoController,
  ],
  providers: [TransparenciaService],
  exports: [TransparenciaService],
})
export class TransparenciaModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly transparencia: TransparenciaService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar(FILA_TRANSPARENCIA, () =>
      this.transparencia.correrJob(),
    );
    this.jobs.agendar(FILA_TRANSPARENCIA, '23 4 * * *');
  }
}
