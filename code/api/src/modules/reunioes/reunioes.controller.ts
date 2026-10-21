import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
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
import { MunicipiosService } from '../municipios/municipios.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  DeliberacoesService,
  esquemaPesquisa,
} from './deliberacoes.service.js';
import {
  esquemaGravacao,
  esquemaListar,
  esquemaRascunho,
  esquemaTranscricao,
  ReunioesService,
} from './reunioes.service.js';
import {
  esquemaAprovar,
  esquemaCriarReuniao,
  esquemaEditarAta,
  esquemaMudarReuniao,
} from './tipos.js';

function ficheiro({ nome, pdf }: { nome: string; pdf: Buffer }) {
  return new StreamableFile(pdf, {
    type: 'application/pdf',
    disposition: `inline; filename="${nome}"`,
    length: pdf.length,
  });
}

/** Painel · Reuniões de câmara e assembleia, atas e deliberações. */
@Controller('painel/reunioes')
@Painel('reunioes')
export class ReunioesPainelController {
  constructor(
    private readonly reunioes: ReunioesService,
    private readonly deliberacoes: DeliberacoesService,
  ) {}

  /** ?orgao=&estado=&limite=&cursor= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.reunioes.listar(m, validar(esquemaListar, query));
  }

  @Post()
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.reunioes.criar(m, u, validar(esquemaCriarReuniao, body));
  }

  /** Pesquisa nas deliberações publicadas: ?q=&de=&ate=&orgao=&votacao=&limite= */
  @Get('deliberacoes')
  procurar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.deliberacoes.procurar(m.id, validar(esquemaPesquisa, query));
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reunioes.detalhe(m, id);
  }

  @Put(':id')
  mudar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reunioes.mudar(m, u, id, validar(esquemaMudarReuniao, body));
  }

  /** { mime } → URL assinada para o browser enviar a gravação (PUT). */
  @Post(':id/gravacao')
  @HttpCode(200)
  enviarGravacao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { mime } = validar(esquemaGravacao, body);
    return this.reunioes.urlEnvioGravacao(m, u, id, mime);
  }

  @Get(':id/gravacao')
  ouvirGravacao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reunioes.urlGravacao(m, u, id);
  }

  /** Transcrever a gravação (ElevenLabs, num job). */
  @Post(':id/transcrever')
  @HttpCode(202)
  transcrever(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reunioes.pedirTranscricao(m, u, id);
  }

  /** { texto }: a transcrição em texto ("Nome: ..." marca quem fala). */
  @Put(':id/transcricao')
  transcricao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { texto } = validar(esquemaTranscricao, body);
    return this.reunioes.gravarTranscricao(m, u, id, texto);
  }

  /** { sem_ia? }: o rascunho da ata (nova versão se já houver). */
  @Post(':id/ata/rascunho')
  @HttpCode(200)
  rascunho(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reunioes.gerarRascunho(
      m,
      u,
      id,
      validar(esquemaRascunho, body ?? {}),
    );
  }

  @Get(':id/ata')
  ata(@MunicipioAtual() m: Municipio, @Param('id', ParseUUIDPipe) id: string) {
    return this.reunioes.ata(m, id);
  }

  /** { conteudo, versao, nota? }: grava uma versão nova do rascunho. */
  @Put(':id/ata')
  editarAta(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reunioes.editarAta(m, u, id, validar(esquemaEditarAta, body));
  }

  @Get(':id/ata/versoes')
  versoes(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reunioes.versoes(m, id);
  }

  @Get(':id/ata/versoes/:versao')
  versao(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versao', ParseIntPipe) versao: number,
  ) {
    return this.reunioes.versao(m, id, versao);
  }

  /** { modo: 'minuta' | 'reuniao_seguinte', reuniao_id? } */
  @Post(':id/ata/aprovar')
  @HttpCode(200)
  aprovar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reunioes.aprovar(m, u, id, validar(esquemaAprovar, body));
  }

  @Post(':id/ata/publicar')
  @HttpCode(200)
  publicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reunioes.publicar(m, u, id);
  }

  /** O PDF em qualquer estado (o rascunho vai marcado). */
  @Get(':id/ata/pdf')
  async pdf(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return ficheiro(await this.reunioes.pdfPainel(m, id));
  }
}

/** Pesquisa pública nas deliberações (só das atas publicadas). */
@Controller('public/deliberacoes')
export class DeliberacoesPublicoController {
  constructor(
    private readonly deliberacoes: DeliberacoesService,
    private readonly municipios: MunicipiosService,
  ) {}

  /** ?municipio=guimaraes (ou X-Municipio) &q=&de=&ate=&orgao=&votacao=&limite= */
  @Get()
  async procurar(
    @Query() query: Record<string, unknown>,
    @Headers('x-municipio') cabecalho: string | undefined,
  ) {
    const { municipio, ...resto } = query;
    const { slug } = validar(
      z.object({ slug: z.string().trim().min(1).max(64) }),
      { slug: municipio ?? cabecalho },
    );
    const m = await this.municipios.porSlug(slug);
    return this.deliberacoes.procurar(m.id, validar(esquemaPesquisa, resto));
  }
}

/** A ata publicada: dados e PDF. */
@Controller('public/atas')
export class AtasPublicoController {
  constructor(private readonly reunioes: ReunioesService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.reunioes.ataPublica(codigo);
  }

  @Get(':codigo/pdf')
  async pdf(@Param('codigo') codigo: string) {
    return ficheiro(await this.reunioes.pdfPublico(codigo));
  }
}
