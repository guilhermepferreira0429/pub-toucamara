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
  ArquivoService,
  esquemaLigar,
  esquemaLote,
  esquemaMetadados,
  esquemaPesquisa,
  esquemaTranscrever,
} from './arquivo.service.js';
import {
  esquemaAtender,
  esquemaEncerrarPedido,
  esquemaFiltroPedidos,
  PedidosArquivoService,
} from './pedidos.service.js';
import { esquemaConfig } from './regras.js';

/**
 * Painel · Arquivo antigo. O recurso 'arquivo' deixa entrar quem atende
 * (pedidos de consulta); os documentos (pesquisar, carregar, rever) são dos
 * técnicos e da chefia (verificado no serviço).
 */
@Controller('painel/arquivo')
@Painel('arquivo')
export class ArquivoPainelController {
  constructor(
    private readonly arquivo: ArquivoService,
    private readonly pedidos: PedidosArquivoService,
  ) {}

  /** ?q=&ano=&ano_ate=&freguesia=&tipo=&morada=&estado=&por_transcrever=&limite= */
  @Get()
  pesquisar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.arquivo.pesquisar(m, u, validar(esquemaPesquisa, query));
  }

  @Get('config')
  config(@MunicipioAtual() m: Municipio) {
    return this.arquivo.configDe(m.id).then((config) => ({ config }));
  }

  /** Prazos e taxas (só a chefia). */
  @Put('config')
  @Painel('agente')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.arquivo.guardarConfig(m, u, validar(esquemaConfig, body));
  }

  // ---------------------------------------------------------------- lotes

  @Get('lotes')
  lotes(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.arquivo.lotes(m, u);
  }

  /** { nome, ficheiros: [{ nome, mime, tamanho? }] } → URLs para enviar (PUT). */
  @Post('lotes')
  criarLote(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.arquivo.criarLote(m, u, validar(esquemaLote, body));
  }

  /** Depois de enviados os ficheiros: põe-nos na fila para processar. */
  @Post('lotes/:id/processar')
  @HttpCode(200)
  processarLote(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.arquivo.processarLote(m, u, id);
  }

  // ----------------------------------------------------------- documentos

  /** Fica no registo de acessos (ação 'ver'). */
  @Get('documentos/:id')
  documento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.arquivo.detalhe(m, u, id);
  }

  /** URL assinado da digitalização (5 min); fica no registo de acessos. */
  @Get('documentos/:id/ficheiro')
  ficheiro(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.arquivo.ficheiro(m, u, id);
  }

  @Post('documentos/:id/processar')
  @HttpCode(200)
  processar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.arquivo.processarAgora(m, u, id);
  }

  /** { texto }: transcrição à mão. */
  @Put('documentos/:id/texto')
  transcrever(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.arquivo.transcrever(
      m,
      u,
      id,
      validar(esquemaTranscrever, body),
    );
  }

  /** Confirma (e corrige) os metadados: fica 'revisto'. */
  @Post('documentos/:id/rever')
  @HttpCode(200)
  rever(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.arquivo.rever(m, u, id, validar(esquemaMetadados, body ?? {}));
  }

  /** { municipe_id?, processos?, retirar_processos? } */
  @Post('documentos/:id/ligar')
  @HttpCode(200)
  ligar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.arquivo.ligar(m, u, id, validar(esquemaLigar, body));
  }

  /** Para o técnico que analisa um processo novo. */
  @Get('processos/:processoId/mesma-morada')
  mesmaMorada(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('processoId', ParseUUIDPipe) processoId: string,
  ) {
    return this.arquivo.mesmaMoradaDoProcesso(m, u, processoId);
  }

  // -------------------------------------------------------------- pedidos

  /** ?estado=recebido|agendado|em_preparacao|pronto|encerrado|abertos */
  @Get('pedidos')
  listarPedidos(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.pedidos.listar(m, validar(esquemaFiltroPedidos, query));
  }

  @Get('pedidos/:id')
  pedido(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.pedidos.detalhe(m, u, id);
  }

  /** { acao: 'marcar', quando, local? } | { acao: 'preparar_copia', paginas } | { acao: 'copia_pronta', paginas? } */
  @Post('pedidos/:id/atender')
  @HttpCode(200)
  atender(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.pedidos.atender(m, u, id, validar(esquemaAtender, body));
  }

  /** { resultado, nota? } (nota obrigatória ao recusar). */
  @Post('pedidos/:id/encerrar')
  @HttpCode(200)
  encerrar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.pedidos.encerrar(
      m,
      u,
      id,
      validar(esquemaEncerrarPedido, body),
    );
  }
}
