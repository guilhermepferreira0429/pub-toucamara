import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { GeocodificacaoService } from '../ocorrencias/geocodificacao.js';
import {
  AvisosZonaController,
  AvisosZonaPublicoController,
} from './avisos-zona.controller.js';
import { ferramentasAvisosZona } from './avisos-zona.ferramentas.js';
import { AvisosZonaService, FILA_AVISOS } from './avisos-zona.service.js';

/**
 * Avisos por zona e de emergência (SMS só a quem é afetado). O job
 * `enviar_aviso_zona` corre o aviso confirmado (pedido no envio) e, a cada
 * minuto, apanha os que ficaram por enviar.
 */
@Module({
  controllers: [AvisosZonaController, AvisosZonaPublicoController],
  // A mesma geocodificação das ocorrências (Nominatim, cache, timeout).
  providers: [AvisosZonaService, GeocodificacaoService],
})
export class AvisosZonaModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly avisos: AvisosZonaService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasAvisosZona(this.avisos));
    this.jobs.trabalhar<{ avisoId?: string }>(
      FILA_AVISOS,
      ({ avisoId }) => this.avisos.processar(avisoId),
      { concorrencia: 1 },
    );
    this.jobs.agendar(FILA_AVISOS, '* * * * *');
  }
}
