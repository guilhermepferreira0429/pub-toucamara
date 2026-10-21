import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  ConsultasPublicasService,
  esquemaConsulta,
  esquemaEditar,
  esquemaParticiparPagina,
  esquemaPedirCodigo,
} from './consultas-publicas.service.js';

/**
 * Painel · Consultas públicas. Ver os resultados: quem vê os indicadores
 * (inclui a vereação). Criar, mudar, abrir e fechar: quem gere o agente,
 * porque muda o que o agente diz. Ligar às pessoas: ação social (a lista de
 * pessoas inscritas).
 */
@Controller('painel/consultas')
@Painel('indicadores')
export class ConsultasPublicasPainelController {
  constructor(private readonly consultas: ConsultasPublicasService) {}

  @Get()
  listar(@MunicipioAtual() m: Municipio) {
    return this.consultas.listar(m);
  }

  @Post()
  @HttpCode(201)
  @Painel('agente')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.consultas.criar(m, u, validar(esquemaConsulta, body));
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.consultas.detalhe(m, id);
  }

  @Patch(':id')
  @Painel('agente')
  editar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.consultas.editar(m, u, id, validar(esquemaEditar, body ?? {}));
  }

  @Post(':id/abrir')
  @HttpCode(200)
  @Painel('agente')
  abrir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.consultas.abrir(m, u, id);
  }

  @Post(':id/fechar')
  @HttpCode(200)
  @Painel('agente')
  fechar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.consultas.fechar(m, u, id);
  }

  /** Agrupa as opiniões livres por temas (IA) ou conta-as (sem IA). */
  @Post(':id/resumo')
  @HttpCode(200)
  resumo(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.consultas.gerarResumo(m, u, id);
  }

  /** As participações sem dados pessoais. */
  @Get(':id/participacoes.csv')
  async csv(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { nome, csv } = await this.consultas.csv(m, u, id);
    const b = Buffer.from(csv, 'utf-8');
    return new StreamableFile(b, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${nome}"`,
      length: b.length,
    });
  }

  @Post(':id/pre-visualizar-ligar')
  @HttpCode(200)
  @Painel('acao_social')
  preVisualizarLigar(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.consultas.preVisualizarLigar(m, id);
  }

  @Post(':id/ligar')
  @HttpCode(201)
  @Painel('acao_social')
  ligar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.consultas.ligar(m, u, id);
  }
}

/** A página pública da consulta (/consulta/CODIGO): ler, participar, ver o resultado. */
@Controller('public/consultas-publicas')
export class ConsultasPublicasPublicoController {
  constructor(private readonly consultas: ConsultasPublicasService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.consultas.publico(codigo);
  }

  /** { telefone } → SMS com o código de 6 dígitos. */
  @Post(':codigo/codigo')
  @HttpCode(200)
  pedirCodigo(
    @Param('codigo') codigo: string,
    @Ip() ip: string,
    @Body() body: unknown,
  ) {
    return this.consultas.pedirCodigo(
      codigo,
      validar(esquemaPedirCodigo, body),
      ip,
    );
  }

  /** { pedido, codigo, respostas: { p1: "concordo" }, opiniao?, freguesia } */
  @Post(':codigo/participar')
  @HttpCode(200)
  participar(@Param('codigo') codigo: string, @Body() body: unknown) {
    return this.consultas.participarPagina(
      codigo,
      validar(esquemaParticiparPagina, body),
    );
  }
}
