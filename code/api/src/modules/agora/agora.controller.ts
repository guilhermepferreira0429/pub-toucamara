import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { esquemaFeed } from './agora.regras.js';
import {
  AgoraPublicacoesService,
  esquemaComunicado,
  esquemaEditarComunicado,
  esquemaEditarEvento,
  esquemaEvento,
  esquemaListaPublicacoes,
} from './agora.publicacoes.js';
import { AgoraService } from './agora.service.js';

/** Cache curta: o feed muda (avisos, ocorrências), mas não a cada segundo. */
function cache(res: Response): void {
  res.setHeader(
    'Cache-Control',
    'public, max-age=60, stale-while-revalidate=120',
  );
  if (!res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}

/**
 * O feed "o que se passa perto de mim", sem login (a app do munícipe, o
 * site e quem quiser): `?lat=&lng=&raio_m=&freguesia=&tipos=&de=&ate=&cursor=&limite=`.
 * Sem dados pessoais: ver agora.regras.ts.
 */
@Controller('public/agora')
export class AgoraPublicoController {
  constructor(private readonly agora: AgoraService) {}

  @Get(':municipio')
  async feed(
    @Param('municipio') municipio: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.agora.feed(municipio, validar(esquemaFeed, query));
    cache(res);
    return r;
  }

  @Get(':municipio/:tipo/:id')
  async detalhe(
    @Param('municipio') municipio: string,
    @Param('tipo') tipo: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.agora.detalhe(municipio, tipo, id);
    cache(res);
    return r;
  }
}

/**
 * Comunicados e notícias no painel. Ver: 'visao_geral'. Escrever, publicar e
 * apagar: 'comunicados' (quem atende e a chefia).
 */
@Controller('painel/comunicados')
@Painel('visao_geral')
export class ComunicadosController {
  constructor(private readonly p: AgoraPublicacoesService) {}

  /** ?estado=&tipo=&limite=&cursor= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.p.listarComunicados(m, validar(esquemaListaPublicacoes, query));
  }

  @Post()
  @Painel('comunicados')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.p.criarComunicado(m, u, validar(esquemaComunicado, body));
  }

  @Get(':id')
  ver(@MunicipioAtual() m: Municipio, @Param('id', ParseUUIDPipe) id: string) {
    return this.p.comunicado(m, id);
  }

  @Patch(':id')
  @Painel('comunicados')
  editar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.p.editarComunicado(
      m,
      u,
      id,
      validar(esquemaEditarComunicado, body),
    );
  }

  @Post(':id/publicar')
  @HttpCode(200)
  @Painel('comunicados')
  publicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.p.estadoComunicado(m, u, id, true);
  }

  @Post(':id/despublicar')
  @HttpCode(200)
  @Painel('comunicados')
  despublicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.p.estadoComunicado(m, u, id, false);
  }

  @Delete(':id')
  @Painel('comunicados')
  apagar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.p.apagarComunicado(m, u, id);
  }
}

/** Eventos da câmara no painel (as mesmas permissões dos comunicados). */
@Controller('painel/eventos')
@Painel('visao_geral')
export class EventosController {
  constructor(private readonly p: AgoraPublicacoesService) {}

  /** ?estado=&limite=&cursor= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.p.listarEventos(m, validar(esquemaListaPublicacoes, query));
  }

  @Post()
  @Painel('comunicados')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.p.criarEvento(m, u, validar(esquemaEvento, body));
  }

  @Get(':id')
  ver(@MunicipioAtual() m: Municipio, @Param('id', ParseUUIDPipe) id: string) {
    return this.p.evento(m, id);
  }

  @Patch(':id')
  @Painel('comunicados')
  editar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.p.editarEvento(m, u, id, validar(esquemaEditarEvento, body));
  }

  @Post(':id/publicar')
  @HttpCode(200)
  @Painel('comunicados')
  publicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.p.estadoEvento(m, u, id, true);
  }

  @Post(':id/despublicar')
  @HttpCode(200)
  @Painel('comunicados')
  despublicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.p.estadoEvento(m, u, id, false);
  }

  @Delete(':id')
  @Painel('comunicados')
  apagar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.p.apagarEvento(m, u, id);
  }
}
