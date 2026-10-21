import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  esquemaConfigRuido,
  esquemaRecusar,
  LicencasService,
} from './licencas.service.js';

const ESTADOS = [
  'a_pagar',
  'por_aprovar',
  'para_tecnico',
  'emitida',
  'recusada',
] as const;

/** Painel · Licenças decididas na chamada. */
@Controller('painel/licencas')
@Painel('processos')
export class LicencasPainelController {
  constructor(private readonly licencas: LicencasService) {}

  /** ?estado= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { estado } = validar(
      z.object({ estado: z.enum(ESTADOS).optional() }),
      query,
    );
    return this.licencas.listar(m, estado);
  }

  /** As regras em código que o agente aplica (os números da câmara). */
  @Get('regras')
  regras(@MunicipioAtual() m: Municipio) {
    return this.licencas.configRuido(m.id).then((config) => ({ config }));
  }

  @Put('regras')
  @Painel('agente')
  guardarRegras(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.licencas.guardarConfig(m, u, validar(esquemaConfigRuido, body));
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.licencas.detalhe(m, id);
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  aprovar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.licencas.aprovar(m, u, id);
  }

  /** { motivo } */
  @Post(':id/recusar')
  @HttpCode(200)
  recusar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.licencas.recusar(m, u, id, validar(esquemaRecusar, body));
  }
}

/** A página do QR: qualquer pessoa verifica se a licença é válida. */
@Controller('public/licencas')
export class LicencasPublicoController {
  constructor(private readonly licencas: LicencasService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.licencas.publico(codigo);
  }

  @Get(':codigo/pdf')
  async pdf(@Param('codigo') codigo: string) {
    const { nome, pdf } = await this.licencas.pdf(codigo);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${nome}"`,
      length: pdf.length,
    });
  }
}
