import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  MunicipioAtual,
  UtilizadorAtual,
  type UtilizadorPainel,
} from '../../common/pedido.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { ConcelhoService } from './concelho.service.js';

/**
 * "Pergunte ao concelho" (o que sentem os munícipes): mesma permissão dos
 * Indicadores (chefia, vereação, técnicos; admin e equipa). Os ids das
 * conversas de suporte só saem para quem pode ver conversas.
 */
@Controller('painel/concelho')
@Painel('indicadores')
export class ConcelhoController {
  constructor(private readonly concelho: ConcelhoService) {}

  /** Freguesias, temas, canais, faixas, a escala e se há IA. */
  @Get('opcoes')
  opcoes(@MunicipioAtual() m: Municipio) {
    return this.concelho.opcoes(m);
  }

  /** Sugestões de pergunta a partir do que subiu nos últimos 7 dias. */
  @Get('sinais')
  sinais(@MunicipioAtual() m: Municipio) {
    return this.concelho.sinais(m);
  }

  @Post('analisar')
  @HttpCode(200)
  analisar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.concelho.analisar(m, u, body, ip);
  }

  /** As minhas perguntas; `?guardadas=true` dá as guardadas da câmara. */
  @Get('analises')
  lista(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.concelho.lista(m, u, query);
  }

  @Get('analises/:id')
  obter(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id') id: string,
  ) {
    return this.concelho.obter(m, u, id);
  }

  /** Guarda como relatório (com título): fica visível a quem tem a mesma permissão. */
  @Post('analises/:id/guardar')
  @HttpCode(200)
  guardar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.concelho.guardar(m, u, id, body);
  }
}
