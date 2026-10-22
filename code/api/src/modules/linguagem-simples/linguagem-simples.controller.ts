import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  esquemaEditarTermo,
  esquemaTermo,
  GlossarioService,
} from './glossario.service.js';
import {
  esquemaCriar,
  esquemaGerar,
  esquemaPublicar,
  esquemaRascunho,
  LinguagemSimplesService,
} from './linguagem-simples.service.js';

const uuid = new ParseUUIDPipe();

/**
 * Linguagem simples no painel. Ler: 'conhecimento_ver'. Gerar, editar,
 * rever e publicar: 'conhecimento' (a revisão humana obrigatória).
 */
@Controller('painel/linguagem-simples')
export class LinguagemSimplesPainelController {
  constructor(private readonly svc: LinguagemSimplesService) {}

  /** As fontes do município e o estado da versão simples de cada uma. */
  @Get()
  @Painel('conhecimento_ver')
  listar(@MunicipioAtual() m: Municipio) {
    return this.svc.listar(m.id);
  }

  /** { fonte_id, tipo } → o documento (cria-o se ainda não existir). */
  @Post()
  @HttpCode(201)
  @Painel('conhecimento')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.svc.criar(m, u, validar(esquemaCriar, body));
  }

  @Get(':id')
  @Painel('conhecimento_ver')
  ver(@MunicipioAtual() m: Municipio, @Param('id', uuid) id: string) {
    return this.svc.ver(m.id, id);
  }

  /** "Gerar" / "Gerar de novo": { modo: 'ia' | 'extrativo' }. */
  @Post(':id/gerar')
  @HttpCode(200)
  @Painel('conhecimento')
  gerar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.gerar(m, u, id, validar(esquemaGerar, body ?? {}));
  }

  /** Grava o rascunho (cria um, escrito à mão, se não houver). */
  @Put(':id/rascunho')
  @Painel('conhecimento')
  guardar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.guardarRascunho(m, u, id, validar(esquemaRascunho, body));
  }

  /** Rever e publicar um rascunho: { confirmo: true }. */
  @Post(':id/versoes/:versao/publicar')
  @HttpCode(200)
  @Painel('conhecimento')
  publicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Param('versao', uuid) versao: string,
    @Body() body: unknown,
  ) {
    validar(esquemaPublicar, body ?? {});
    return this.svc.publicar(m, u, id, versao);
  }

  /** Tira a versão publicada do ar. */
  @Post(':id/retirar')
  @HttpCode(200)
  @Painel('conhecimento')
  retirar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
  ) {
    return this.svc.retirar(m, u, id);
  }
}

/** Glossário administrativo no painel (CRUD com auditoria). */
@Controller('painel/glossario')
export class GlossarioPainelController {
  constructor(private readonly glossario: GlossarioService) {}

  @Get()
  @Painel('conhecimento_ver')
  listar(@MunicipioAtual() m: Municipio) {
    return this.glossario.listar(m.id);
  }

  @Post()
  @HttpCode(201)
  @Painel('conhecimento')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.glossario.criar(m, u, validar(esquemaTermo, body));
  }

  /** Os termos iniciais, marcados como valores de demonstração. */
  @Post('demonstracao')
  @HttpCode(201)
  @Painel('conhecimento')
  demonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.glossario.carregarDemonstracao(m, u);
  }

  @Put(':id')
  @Painel('conhecimento')
  editar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ) {
    return this.glossario.editar(m, u, id, validar(esquemaEditarTermo, body));
  }

  @Delete(':id')
  @Painel('conhecimento')
  apagar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', uuid) id: string,
  ) {
    return this.glossario.apagar(m, u, id);
  }
}

const esquemaCodigo = z.string().regex(/^[A-Za-z0-9]{6,16}$/);
const esquemaSlug = z.object({ slug: z.string().trim().min(1).max(64) });

/** Páginas públicas (sem login): o documento, a lista e o glossário. */
@Controller('public/documentos')
export class DocumentosPublicoController {
  constructor(private readonly svc: LinguagemSimplesService) {}

  /** ?municipio=guimaraes (ou X-Municipio): os documentos publicados. */
  @Get()
  listar(
    @Query('municipio') municipio: string | undefined,
    @Headers('x-municipio') cabecalho: string | undefined,
  ) {
    const { slug } = validar(esquemaSlug, { slug: municipio ?? cabecalho });
    return this.svc.publicados(slug);
  }

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.svc.publico(validar(esquemaCodigo, codigo));
  }
}

@Controller('public/glossario')
export class GlossarioPublicoController {
  constructor(private readonly svc: LinguagemSimplesService) {}

  /** ?municipio=guimaraes (ou X-Municipio). */
  @Get()
  listar(
    @Query('municipio') municipio: string | undefined,
    @Headers('x-municipio') cabecalho: string | undefined,
  ) {
    const { slug } = validar(esquemaSlug, { slug: municipio ?? cabecalho });
    return this.svc.glossarioPublico(slug);
  }
}
