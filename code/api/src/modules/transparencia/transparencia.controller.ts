import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { Ficheiro, TransparenciaService } from './transparencia.service.js';

/** 15 minutos no browser e nos proxies; o conteúdo muda no máximo uma vez por noite. */
const MAX_AGE = 900;

interface Cache {
  etag?: string;
  modificado?: Date;
  imutavel?: boolean;
}

/**
 * Dados abertos: qualquer site os pode ler (sem credenciais) e guardar em
 * cache. Com ETag, o Express responde 304 a um If-None-Match igual.
 */
function cabecalhos(res: Response, c: Cache = {}): void {
  res.setHeader(
    'Cache-Control',
    c.imutavel
      ? 'public, max-age=31536000, immutable'
      : `public, max-age=${MAX_AGE}, stale-while-revalidate=86400`,
  );
  if (!res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  if (c.etag) res.setHeader('ETag', `"${c.etag}"`);
  if (c.modificado) res.setHeader('Last-Modified', c.modificado.toUTCString());
}

function enviarFicheiro(res: Response, f: Ficheiro): string {
  cabecalhos(res, {
    etag: f.etag,
    modificado: f.modificado,
    imutavel: f.imutavel,
  });
  res.setHeader('Content-Type', f.tipo);
  res.setHeader('Content-Disposition', `inline; filename="${f.nome}"`);
  return f.corpo;
}

/** 'ocorrencias.csv' → ['ocorrencias', 'csv']; 'ocorrencias' → ['ocorrencias', null]. */
function partirFicheiro(ficheiro: string): [string, 'csv' | 'json' | null] {
  const m = /^(.+)\.(csv|json)$/.exec(ficheiro);
  return m ? [m[1], m[2] as 'csv' | 'json'] : [ficheiro, null];
}

const esquemaAlterar = z.object({ ativo: z.boolean() }).strict();

/** Painel · Transparência: ligar/desligar cada conjunto e publicar já. */
@Controller('painel/transparencia')
@Painel('indicadores')
export class TransparenciaPainelController {
  constructor(private readonly t: TransparenciaService) {}

  @Get()
  estado(@MunicipioAtual() m: Municipio) {
    return this.t.estado(m);
  }

  /** Publica já todos os conjuntos ligados. */
  @Post('publicar')
  @HttpCode(200)
  @Painel('transparencia')
  publicarTodos(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.t.publicarAgora(m, u);
  }

  @Get('conjuntos/:id')
  detalhe(@MunicipioAtual() m: Municipio, @Param('id') id: string) {
    return this.t.detalhe(m, id);
  }

  /** O que sairia agora, sem publicar. */
  @Get('conjuntos/:id/pre-visualizar')
  preVisualizar(@MunicipioAtual() m: Municipio, @Param('id') id: string) {
    return this.t.preVisualizar(m, id);
  }

  /** { ativo } — ligar publica logo. */
  @Put('conjuntos/:id')
  @Painel('transparencia')
  alterar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.t.alterar(m, u, id, validar(esquemaAlterar, body).ativo);
  }

  @Post('conjuntos/:id/publicar')
  @HttpCode(200)
  @Painel('transparencia')
  publicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id') id: string,
  ) {
    return this.t.publicarAgora(m, u, id);
  }
}

/** Portal de dados abertos (sem login) e catálogo DCAT-AP para o dados.gov.pt. */
@Controller('public/dados')
export class DadosAbertosPublicoController {
  constructor(private readonly t: TransparenciaService) {}

  @Get(':municipio')
  async catalogo(
    @Param('municipio') municipio: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const c = await this.t.catalogo(municipio);
    cabecalhos(res, {
      modificado: c.atualizado_em ? new Date(c.atualizado_em) : undefined,
    });
    return c;
  }

  @Get(':municipio/catalogo.jsonld')
  async dcat(
    @Param('municipio') municipio: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { corpo, etag } = await this.t.dcat(municipio);
    cabecalhos(res, { etag });
    res.setHeader('Content-Type', 'application/ld+json; charset=utf-8');
    return corpo;
  }

  @Get(':municipio/:conjunto/historico')
  async historico(
    @Param('municipio') municipio: string,
    @Param('conjunto') conjunto: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { limite, cursor } = validar(esquemaPaginacao, query);
    const h = await this.t.historico(municipio, conjunto, limite, cursor);
    cabecalhos(res);
    return h;
  }

  /** Uma publicação antiga: `<id>.csv` ou `<id>.json` (não muda nunca). */
  @Get(':municipio/:conjunto/historico/:ficheiro')
  async daHistoria(
    @Param('municipio') municipio: string,
    @Param('conjunto') conjunto: string,
    @Param('ficheiro') ficheiro: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const [id, formato] = partirFicheiro(ficheiro);
    if (!formato || !z.string().uuid().safeParse(id).success) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'conjunto_nao_publicado',
        'Esta publicação não existe (use <id>.csv ou <id>.json).',
      );
    }
    return enviarFicheiro(
      res,
      await this.t.ficheiro(municipio, conjunto, formato, id),
    );
  }

  /** `<conjunto>` (metadados + última publicação), `<conjunto>.csv` ou `<conjunto>.json`. */
  @Get(':municipio/:ficheiro')
  async conjunto(
    @Param('municipio') municipio: string,
    @Param('ficheiro') ficheiro: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const [id, formato] = partirFicheiro(ficheiro);
    if (formato) {
      return enviarFicheiro(res, await this.t.ficheiro(municipio, id, formato));
    }
    const c = await this.t.conjuntoPublico(municipio, id);
    cabecalhos(res, { modificado: c.publicacao.gerado_em });
    return c;
  }
}

/** Os números do mês, para a câmara embeber no site. */
@Controller('public/indicadores')
export class IndicadoresPublicoController {
  constructor(private readonly t: TransparenciaService) {}

  /** ?mes=AAAA-MM (por omissão, o último mês completo). */
  @Get(':municipio')
  async indicadores(
    @Param('municipio') municipio: string,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { mes } = validar(
      z.object({
        mes: z
          .string()
          .regex(/^\d{4}-\d{2}$/, 'O mês tem de ser AAAA-MM.')
          .optional(),
      }),
      query,
    );
    const r = await this.t.indicadores(municipio, mes);
    cabecalhos(res);
    return r;
  }
}
