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
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  AntecipacoesService,
  esquemaAudiencia,
  esquemaConfig,
  esquemaLista,
} from './antecipacoes.service.js';

/**
 * Painel · Antecipações: os momentos dos próximos dias, os contactos feitos
 * e os alertas internos. Ver é de quem gere processos; mudar as
 * antecedências é da chefia (recurso 'agente').
 */
@Controller('painel/antecipacoes')
@Painel('processos')
export class AntecipacoesController {
  constructor(private readonly antecipacoes: AntecipacoesService) {}

  /** ?dias=14 */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.antecipacoes.painel(m, validar(esquemaLista, query));
  }

  @Get('config')
  config(@MunicipioAtual() m: Municipio) {
    return this.antecipacoes.obterConfig(m);
  }

  @Put('config')
  @Painel('agente')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.antecipacoes.guardarConfig(m, u, validar(esquemaConfig, body));
  }

  /** "Correr agora": só na demonstração (fora de produção ou DEMO_ATIVA). */
  @Post('correr')
  @HttpCode(200)
  @Painel('agente')
  correr(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.antecipacoes.correrAgora(m, u);
  }

  @Get('processos/:id')
  doProcesso(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.antecipacoes.doProcesso(m, id);
  }

  /** Proposta de indeferimento: abre a audiência prévia com o prazo. */
  @Post('processos/:id/audiencia-previa')
  @HttpCode(200)
  abrirAudiencia(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.antecipacoes.abrirAudiencia(
      m,
      u,
      id,
      validar(esquemaAudiencia, body),
    );
  }
}
