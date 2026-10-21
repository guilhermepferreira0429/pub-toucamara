import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  esquemaAlterarVisita,
  esquemaCancelar,
  esquemaCorrigirRelatorio,
  esquemaEnvioAudio,
  esquemaEnvioFoto,
  esquemaFiltroVisitas,
  esquemaNovaVisita,
  esquemaPlano,
  esquemaRelatorioTexto,
  FiscalizacaoService,
} from './fiscalizacao.service.js';
import { esquemaConfig } from './regras.js';

/** Painel · Fiscalização: visitas, plano do dia e relatório ditado. */
@Controller('painel/fiscalizacao')
@Painel('fiscalizacao')
export class FiscalizacaoController {
  constructor(private readonly fiscalizacao: FiscalizacaoService) {}

  /** Tipos com a checklist e a duração, fiscais, estados e configuração. */
  @Get('opcoes')
  opcoes(@MunicipioAtual() m: Municipio) {
    return this.fiscalizacao.opcoes(m);
  }

  @Get('config')
  config(@MunicipioAtual() m: Municipio) {
    return this.fiscalizacao.configDe(m.id).then((config) => ({ config }));
  }

  /** Ponto de partida, velocidade, durações, prazo (só a chefia). */
  @Put('config')
  @Painel('agente')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.fiscalizacao.guardarConfig(m, u, validar(esquemaConfig, body));
  }

  /** ?dia=AAAA-MM-DD&fiscal_id=&partida_lat=&partida_lng=&inicio=HH:MM&regressar= */
  @Get('plano')
  plano(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.fiscalizacao.plano(m, u, validar(esquemaPlano, query));
  }

  /** ?estado=&abertas=&fiscal_id=&dia=&origem=&ocorrencia_id=&processo_id= */
  @Get('visitas')
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.fiscalizacao.listar(m, validar(esquemaFiltroVisitas, query));
  }

  /** A partir de uma ocorrência, de um processo (vistoria) ou à mão. */
  @Post('visitas')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.fiscalizacao.criar(m, u, validar(esquemaNovaVisita, body));
  }

  @Get('visitas/:id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.fiscalizacao.detalhe(m, id);
  }

  /** Agendar (dia, janela, fiscal), mudar o motivo, o local ou a checklist. */
  @Patch('visitas/:id')
  alterar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.fiscalizacao.alterar(
      m,
      u,
      id,
      validar(esquemaAlterarVisita, body),
    );
  }

  @Post('visitas/:id/cancelar')
  @HttpCode(200)
  cancelar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.fiscalizacao.cancelar(m, u, id, validar(esquemaCancelar, body));
  }

  /** O texto ditado no telemóvel; estrutura com IA ou fica relatório livre. */
  @Post('visitas/:id/relatorio')
  @HttpCode(200)
  relatorioTexto(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.fiscalizacao.relatorioTexto(
      m,
      u,
      id,
      validar(esquemaRelatorioTexto, body),
    );
  }

  /** Revisão do fiscal antes de fechar. */
  @Patch('visitas/:id/relatorio')
  corrigirRelatorio(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.fiscalizacao.corrigirRelatorio(
      m,
      u,
      id,
      validar(esquemaCorrigirRelatorio, body),
    );
  }

  /** URL assinada para enviar o áudio (503 sem S3). */
  @Post('visitas/:id/relatorio/audio')
  pedirEnvioAudio(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.fiscalizacao.pedirEnvioAudio(
      m,
      u,
      id,
      validar(esquemaEnvioAudio, body),
    );
  }

  /** Transcreve o áudio enviado (ElevenLabs) e estrutura o relatório. */
  @Post('visitas/:id/relatorio/audio/transcrever')
  @HttpCode(200)
  transcrever(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.fiscalizacao.transcreverAudio(m, u, id);
  }

  /** URL assinada para enviar uma fotografia (503 sem S3). */
  @Post('visitas/:id/fotos')
  pedirEnvioFoto(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.fiscalizacao.pedirEnvioFoto(
      m,
      u,
      id,
      validar(esquemaEnvioFoto, body),
    );
  }

  /**
   * Fecha o relatório: a visita fica feita, a ocorrência ou o processo são
   * atualizados, há nova visita se houver infrações e o munícipe é avisado.
   */
  @Post('visitas/:id/concluir')
  @HttpCode(200)
  concluir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.fiscalizacao.concluir(m, u, id);
  }

  @Get('visitas/:id/pdf')
  async pdf(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const { nome, pdf } = await this.fiscalizacao.pdf(m, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${nome}"`,
      length: pdf.length,
    });
  }
}
