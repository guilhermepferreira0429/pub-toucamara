import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { z } from 'zod';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  esquemaEmitir,
  esquemaRecusar,
  JuntasService,
  TIPOS_ATESTADO,
} from './juntas.service.js';

function ficheiro(r: { nome: string; pdf: Buffer }) {
  return new StreamableFile(r.pdf, {
    type: 'application/pdf',
    disposition: `inline; filename="${r.nome}"`,
    length: r.pdf.length,
  });
}

/**
 * Painel · Atestados da junta (só existe nas juntas: o
 * FuncionalidadesInterceptor responde 404 numa câmara).
 */
@Controller('painel/atestados')
@Painel('atestados')
export class AtestadosPainelController {
  constructor(private readonly juntas: JuntasService) {}

  /** ?estado=pedido|emitido|recusado&tipo=&limite=&cursor= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const q = validar(
      esquemaPaginacao.extend({
        estado: z.enum(['pedido', 'emitido', 'recusado']).optional(),
        tipo: z.enum(TIPOS_ATESTADO).optional(),
      }),
      query,
    );
    return this.juntas.listar(
      m,
      { estado: q.estado, tipo: q.tipo },
      q.limite,
      q.cursor,
    );
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.juntas.detalhe(m, id);
  }

  /** { nota? }: emite (PDF com QR) e manda SMS com o link. */
  @Post(':id/emitir')
  @HttpCode(200)
  emitir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.juntas.emitir(m, u, id, validar(esquemaEmitir, body ?? {}));
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
    return this.juntas.recusar(m, u, id, validar(esquemaRecusar, body));
  }

  @Get(':id/pdf')
  async pdf(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return ficheiro(await this.juntas.pdfPainel(m, id));
  }
}

/** Painel · que município é este (câmara ou junta) e as ligações entre eles. */
@Controller('painel/juntas')
@Painel()
export class JuntasPainelController {
  constructor(private readonly juntas: JuntasService) {}

  @Get()
  resumo(@MunicipioAtual() m: Municipio) {
    return this.juntas.resumo(m);
  }
}

/** Página do link do SMS e do QR: o estado do pedido e o PDF quando emitido. */
@Controller('public/atestados')
export class AtestadosPublicoController {
  constructor(private readonly juntas: JuntasService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.juntas.publico(codigo);
  }

  @Get(':codigo/pdf')
  async pdf(@Param('codigo') codigo: string) {
    return ficheiro(await this.juntas.pdfPorCodigo(codigo));
  }
}

/** O chat da junta no site (`/junta/[slug]`): o nome e o concelho. */
@Controller('public/juntas')
export class JuntasPublicoController {
  constructor(private readonly juntas: JuntasService) {}

  @Get(':slug')
  ver(@Param('slug') slug: string) {
    return this.juntas.publicoMunicipio(slug);
  }
}
