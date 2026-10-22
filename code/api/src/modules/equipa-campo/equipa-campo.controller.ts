import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotenciaInterceptor } from '../../common/idempotencia.interceptor.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  EquipaCampoService,
  esquemaFecharOcorrencia,
  esquemaFotoCampo,
  esquemaHoje,
} from './equipa-campo.service.js';

/**
 * Painel · app da equipa de campo. Os pedidos que a app guarda sem rede
 * levam `Idempotency-Key`: reenviar não repete a ação.
 */
@Controller('painel/equipa')
@UseInterceptors(IdempotenciaInterceptor)
export class EquipaCampoController {
  constructor(private readonly equipa: EquipaCampoService) {}

  /** ?lat=&lng=&dia= — as minhas tarefas de hoje, por proximidade. */
  @Get('hoje')
  @Painel()
  hoje(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.equipa.hoje(m, u, validar(esquemaHoje, query));
  }

  /** Fotografia da visita com GPS e hora (URL assinada; 503 sem S3). */
  @Post('visitas/:id/fotos')
  @Painel('fiscalizacao')
  fotoVisita(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.equipa.fotoVisita(m, u, id, validar(esquemaFotoCampo, body));
  }

  /** A fotografia "do depois" (URL assinada; 503 sem S3). */
  @Post('ocorrencias/:id/fotos')
  @Painel('ocorrencias')
  fotoOcorrencia(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.equipa.fotoOcorrencia(
      m,
      u,
      id,
      validar(esquemaFotoCampo, body),
    );
  }

  /** Fecha com nota (e fotos do depois): resolvida, e o munícipe é avisado. */
  @Post('ocorrencias/:id/fechar')
  @HttpCode(200)
  @Painel('ocorrencias')
  fechar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.equipa.fecharOcorrencia(
      m,
      u,
      id,
      validar(esquemaFecharOcorrencia, body),
    );
  }
}
