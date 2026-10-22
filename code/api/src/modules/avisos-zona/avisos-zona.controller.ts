import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel, SoConsulta } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  AvisosZonaService,
  esquemaEnviar,
  esquemaListaAvisos,
  esquemaNovoAviso,
  esquemaPreVisualizar,
} from './avisos-zona.service.js';

/**
 * Avisos por zona no painel. Ver: 'visao_geral'. Criar, pré-visualizar,
 * enviar e cancelar: 'agente' (chefe de divisão; é o mesmo recurso das
 * chamadas de saída: falar com a população em nome da câmara).
 */
@Controller('painel/avisos-zona')
@Painel('visao_geral')
export class AvisosZonaController {
  constructor(private readonly avisos: AvisosZonaService) {}

  /** { zona, desde? } → quantos, por origem, amostra mascarada. */
  @Post('pre-visualizar')
  @SoConsulta()
  @HttpCode(200)
  @Painel('agente')
  preVisualizar(@MunicipioAtual() m: Municipio, @Body() body: unknown) {
    return this.avisos.preVisualizar(m, validar(esquemaPreVisualizar, body));
  }

  /** ?estado=&limite=&cursor= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.avisos.listar(m, validar(esquemaListaAvisos, query));
  }

  /** { titulo, mensagem, tipo, zona, desde?, enviar_em? } → rascunho. */
  @Post()
  @Painel('agente')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.avisos.criar(m, u, validar(esquemaNovoAviso, body));
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.avisos.detalhe(m, id);
  }

  /** { confirmo_destinatarios: N } (o número da pré-visualização). */
  @Post(':id/enviar')
  @HttpCode(200)
  @Painel('agente')
  enviar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.avisos.enviar(m, u, id, validar(esquemaEnviar, body));
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Painel('agente')
  cancelar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.avisos.cancelar(m, u, id);
  }
}

// O código do link curto (6 caracteres do alfabeto dos links).
const esquemaCodigo = z.string().regex(/^[A-Za-z0-9]{4,12}$/);

/** A página do link do SMS (`/r/{codigo}` → `${WEB_URL}/aviso/{codigo}`). */
@Controller('public/avisos')
export class AvisosZonaPublicoController {
  constructor(private readonly avisos: AvisosZonaService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.avisos.publico(validar(esquemaCodigo, codigo));
  }

  /** "Deixar de receber avisos". */
  @Post(':codigo/sair')
  @HttpCode(200)
  sair(@Param('codigo') codigo: string) {
    return this.avisos.sair(validar(esquemaCodigo, codigo));
  }
}
