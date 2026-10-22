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
import { esquemaConfigContratacao } from './config.js';
import {
  ContratacaoService,
  esquemaAvaliar,
  esquemaContrato,
  esquemaCriarProcedimento,
  esquemaImportar,
  esquemaListarContratos,
  esquemaListarProcedimentos,
  esquemaMudarEstado,
  esquemaPeca,
  esquemaPublicar,
} from './contratacao.service.js';
import { TIPOS_PECA, TipoPeca } from './pecas.js';

function tipoPeca(t: string): TipoPeca {
  return validar(z.object({ tipo: z.enum(TIPOS_PECA) }), { tipo: t }).tipo;
}

/**
 * Painel · Contratação pública (interno): "isto cabe no ajuste direto?",
 * o registo de contratos do município e a preparação dos procedimentos.
 * Recurso `contratacao` (chefia e técnicos que tratam das compras); mudar
 * os limiares e aprovar um procedimento é da chefia (`agente`).
 */
@Controller('painel/contratacao')
@Painel('contratacao')
export class ContratacaoController {
  constructor(private readonly contratacao: ContratacaoService) {}

  // --- Regras -------------------------------------------------------------------

  @Get('config')
  config(@MunicipioAtual() m: Municipio) {
    return this.contratacao.verConfig(m);
  }

  @Put('config')
  @Painel('agente')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.contratacao.guardarConfig(
      m,
      u,
      validar(esquemaConfigContratacao, body),
    );
  }

  /** Simular sem gravar: que procedimentos cabem, porquê e que peças são precisas. */
  @Post('avaliar')
  @HttpCode(200)
  avaliar(@MunicipioAtual() m: Municipio, @Body() body: unknown) {
    return this.contratacao.avaliar(m, validar(esquemaAvaliar, body));
  }

  // --- Registo de contratos ---------------------------------------------------------

  /** ?nif=&ano=&q=&limite=&cursor= */
  @Get('contratos')
  contratos(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.contratacao.listarContratos(
      m,
      validar(esquemaListarContratos, query),
    );
  }

  @Post('contratos')
  criarContrato(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.contratacao.criarContrato(m, u, validar(esquemaContrato, body));
  }

  /** { csv, separador? } — o CSV exportado do portal BASE. */
  @Post('contratos/importar')
  @HttpCode(200)
  importar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.contratacao.importarContratos(
      m,
      u,
      validar(esquemaImportar, body),
    );
  }

  // --- Procedimentos ----------------------------------------------------------------

  /** ?estado=&limite=&cursor= */
  @Get('procedimentos')
  procedimentos(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.contratacao.listarProcedimentos(
      m,
      validar(esquemaListarProcedimentos, query),
    );
  }

  /** O pedido do serviço requerente: corre o motor e gera o rascunho das peças. */
  @Post('procedimentos')
  criarProcedimento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.contratacao.criarProcedimento(
      m,
      u,
      validar(esquemaCriarProcedimento, body),
    );
  }

  @Get('procedimentos/:id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contratacao.detalhe(m, id);
  }

  /** { estado: em_revisao | rascunho | aprovado, nota? } — aprovar é da chefia. */
  @Post('procedimentos/:id/estado')
  @HttpCode(200)
  mudarEstado(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.contratacao.mudarEstado(
      m,
      u,
      id,
      validar(esquemaMudarEstado, body),
    );
  }

  /** { base_numero, adjudicatario_nif?, preco_contratual_cent?, data_contrato? } */
  @Post('procedimentos/:id/publicar')
  @HttpCode(200)
  publicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.contratacao.publicar(m, u, id, validar(esquemaPublicar, body));
  }

  /** { titulo?, secoes: [{titulo, texto}] } */
  @Put('procedimentos/:id/pecas/:tipo')
  guardarPeca(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tipo') tipo: string,
    @Body() body: unknown,
  ) {
    return this.contratacao.guardarPeca(
      m,
      u,
      id,
      tipoPeca(tipo),
      validar(esquemaPeca, body),
    );
  }

  @Get('procedimentos/:id/pecas/:tipo/pdf')
  async pdf(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tipo') tipo: string,
  ) {
    const { nome, pdf } = await this.contratacao.pdf(m, id, tipoPeca(tipo));
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${nome}"`,
      length: pdf.length,
    });
  }
}
