import { Controller, Get, Query } from '@nestjs/common';
import { MunicipioAtual } from '../../common/pedido.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PainelService } from './painel.service.js';
import { hojeNoFuso, lerPeriodo } from './periodos.js';

@Controller('painel')
export class VisaoGeralController {
  constructor(private readonly painel: PainelService) {}

  /** Visão geral: indicadores com variação, trabalho da semana, mapa de calor, temas, atenção. */
  @Get('visao-geral')
  @Painel('visao_geral')
  visaoGeral(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { de, ate } = lerPeriodo(query, hojeNoFuso(m.fuso));
    return this.painel.visaoGeral(m, { de, ate });
  }

  /** Indicadores: séries por dia ou semana (`?agrupar=dia|semana`). */
  @Get('indicadores')
  @Painel('indicadores')
  indicadores(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { de, ate, agrupar } = lerPeriodo(query, hojeNoFuso(m.fuso));
    return this.painel.indicadores(m, { de, ate }, agrupar);
  }
}
