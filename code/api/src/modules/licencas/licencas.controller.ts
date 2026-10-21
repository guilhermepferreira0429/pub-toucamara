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
import { esquemaTipo, TipoLicenca } from './tipos.js';

function tipoDe(t: string): TipoLicenca {
  return validar(z.object({ tipo: esquemaTipo }), { tipo: t }).tipo;
}

const ESTADOS = [
  'a_pagar',
  'por_aprovar',
  'para_tecnico',
  'emitida',
  'recusada',
] as const;

/** Painel · Licenças decididas na chamada (todos os tipos). */
@Controller('painel/licencas')
@Painel('processos')
export class LicencasPainelController {
  constructor(private readonly licencas: LicencasService) {}

  /** ?estado=&tipo= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const filtro = validar(
      z.object({
        estado: z.enum(ESTADOS).optional(),
        tipo: esquemaTipo.optional(),
      }),
      query,
    );
    return this.licencas.listar(m, filtro);
  }

  /** As regras em código que o agente aplica (as do ruído, como antes). */
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

  /** Todos os tipos: regras em vigor, campos editáveis e histórico. */
  @Get('tipos')
  tipos(@MunicipioAtual() m: Municipio) {
    return this.licencas.tipos(m).then((tipos) => ({ tipos }));
  }

  @Get('regras/:tipo')
  regrasDe(@MunicipioAtual() m: Municipio, @Param('tipo') tipo: string) {
    const t = tipoDe(tipo);
    return this.licencas
      .configDe(m.id, t)
      .then((config) => ({ tipo: t, config }));
  }

  @Put('regras/:tipo')
  @Painel('agente')
  guardarRegrasDe(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('tipo') tipo: string,
    @Body() body: unknown,
  ) {
    const t = tipoDe(tipo);
    return this.licencas.guardarConfig(
      m,
      u,
      this.licencas.validarConfig(t, body),
      t,
    );
  }

  /**
   * "Testar uma lei antes de a aprovar": corre as regras propostas (o
   * corpo, as mesmas do PUT) contra os pedidos antigos, sem gravar nada.
   */
  @Post('regras/:tipo/simular')
  @HttpCode(200)
  @Painel('agente')
  simular(
    @MunicipioAtual() m: Municipio,
    @Param('tipo') tipo: string,
    @Body() body: unknown,
  ) {
    const t = tipoDe(tipo);
    return this.licencas.simular(m, t, this.licencas.validarConfig(t, body));
  }

  /** Pedidos antigos de demonstração para este tipo (só se ainda não houver). */
  @Post('historico/:tipo/demonstracao')
  @HttpCode(200)
  @Painel('agente')
  historicoDemonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('tipo') tipo: string,
  ) {
    return this.licencas.carregarHistoricoDemonstracao(m, u, tipoDe(tipo));
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
