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
  StreamableFile,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  esquemaAtualizarCache,
  esquemaEditarRascunho,
  esquemaNovoRascunho,
  ProcessosApoioService,
} from './processos-apoio.service.js';
import {
  esquemaAtualizarProcesso,
  esquemaListaProcessos,
  esquemaNota,
  esquemaPedirDocumento,
  esquemaResumoProcessos,
  ProcessosPainelService,
} from './processos-painel.service.js';
import { ProcessosDemonstracaoService } from './processos-demonstracao.service.js';
import { ProcessosService } from './processos.service.js';
import { ProcessosVerificacoesService } from './processos-verificacoes.service.js';
import {
  esquemaDocumentoAlterar,
  esquemaDocumentoTipo,
  esquemaTipoAlterar,
  esquemaTipoNovo,
  TiposProcessoService,
} from './tipos-processo.service.js';

@Controller('painel/processos')
@Painel('processos')
export class ProcessosPainelController {
  constructor(
    private readonly painel: ProcessosPainelService,
    private readonly apoio: ProcessosApoioService,
    private readonly verificacoes: ProcessosVerificacoesService,
    private readonly demonstracao: ProcessosDemonstracaoService,
  ) {}

  /**
   * Cria (uma vez) o processo de demonstração do design "Porta na cozinha"
   * (CP 412), com o projeto em PDF para as verificações automáticas.
   */
  @Post('demonstracao')
  @HttpCode(201)
  carregarDemonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.demonstracao.carregar(m, u);
  }

  /** Totais por separador: ?fase=&texto=&tipo_processo_id=&servico_id=&freguesia= */
  @Get('resumo')
  totais(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.painel.resumo(m, u, validar(esquemaResumoProcessos, query));
  }

  /** ?fase=&tecnico_id=(uuid|eu)&atrasados=true&aguarda_municipe=true&a_terminar=true&texto=&tipo_processo_id=&servico_id=&freguesia=&limite=&cursor= */
  @Get()
  listar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.painel.listar(m, u, validar(esquemaListaProcessos, query));
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.painel.detalhe(m, id);
  }

  /** { fase?, tecnico_id?, decisao? } */
  @Patch(':id')
  atualizar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.painel.atualizar(
      m,
      u,
      id,
      validar(esquemaAtualizarProcesso, body),
    );
  }

  /** Nota na linha do tempo: { descricao, interno } (interna por defeito). */
  @Post(':id/eventos')
  nota(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.painel.nota(m, u, id, validar(esquemaNota, body));
  }

  /** { tipo_documento_id? | nome?, nota?, prazo_dias_uteis? (10) } → evento, pedido com prazo e aviso com o link. */
  @Post(':id/pedir-documento')
  @HttpCode(200)
  pedirDocumento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.painel.pedirDocumento(
      m,
      u,
      id,
      validar(esquemaPedirDocumento, body),
    );
  }

  /** Resumo do processo numa página (IA, em cache até o processo mudar). ?atualizar=true força. */
  @Get(':id/resumo')
  resumo(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ) {
    return this.apoio.resumo(
      m,
      u,
      id,
      validar(esquemaAtualizarCache, query).atualizar,
    );
  }

  /** Regulamento aplicável com as frases destacadas (sem IA: os trechos sem destaques). */
  @Get(':id/regulamento')
  regulamento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ) {
    return this.apoio.regulamento(
      m,
      u,
      id,
      validar(esquemaAtualizarCache, query).atualizar,
    );
  }

  /**
   * Verificações automáticas (PDM, instrução, termo, Ordem simulada, leitura
   * do projeto pela IA). Da cache até os documentos ou as regras mudarem;
   * ?atualizar=true corre tudo outra vez, IA incluída.
   */
  @Get(':id/verificacoes')
  verificar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: unknown,
  ) {
    return this.verificacoes.obter(
      m,
      u,
      id,
      validar(esquemaAtualizarCache, query).atualizar,
    );
  }

  /** O ficheiro de um documento do processo (para o abrir na folha da evidência). */
  @Get(':id/documentos/:documento/ficheiro')
  async ficheiro(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('documento', ParseUUIDPipe) documento: string,
  ) {
    const f = await this.verificacoes.ficheiro(m, id, documento);
    const nome =
      f.nome.replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'documento';
    return new StreamableFile(f.conteudo, {
      type: f.mime,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(nome)}`,
      length: f.conteudo.length,
    });
  }

  @Get(':id/rascunhos')
  rascunhos(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apoio.listarRascunhos(m, id);
  }

  /** { tipo: parecer|oficio|pedido_elementos|notificacao_sms, instrucoes?, modelo_id?, documentos_pedidos?, prazo_dias_uteis? } */
  @Post(':id/rascunhos')
  criarRascunho(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.apoio.criarRascunho(
      m,
      u,
      id,
      validar(esquemaNovoRascunho, body),
    );
  }
}

/** Rascunhos de ofício, pedido de elementos e SMS: o técnico edita, aprova ou descarta. */
@Controller('painel/rascunhos')
@Painel('processos')
export class RascunhosController {
  constructor(private readonly apoio: ProcessosApoioService) {}

  /** { corpo } → nova versão (as anteriores ficam). */
  @Patch(':id')
  editar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.apoio.editarRascunho(
      m,
      u,
      id,
      validar(esquemaEditarRascunho, body),
    );
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  aprovar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apoio.aprovarRascunho(m, u, id);
  }

  @Post(':id/descartar')
  @HttpCode(200)
  descartar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apoio.descartarRascunho(m, u, id);
  }
}

@Controller('painel/tipos-processo')
@Painel('processos')
export class TiposProcessoController {
  constructor(private readonly tipos: TiposProcessoService) {}

  @Get()
  async listar(@MunicipioAtual() m: Municipio) {
    return { itens: await this.tipos.listar(m.id) };
  }

  /** { codigo, nome, prazo_dias_uteis, servico_id?, frase_do_agente? } */
  @Post()
  @HttpCode(201)
  @Painel('agente')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.tipos.criar(m.id, u, validar(esquemaTipoNovo, body));
  }

  @Patch(':id')
  @Painel('agente')
  alterar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.tipos.alterar(m.id, u, id, validar(esquemaTipoAlterar, body));
  }

  /** { nome, obrigatorio, verificacoes[], gerado_pelo_sistema } */
  @Post(':id/documentos')
  @HttpCode(201)
  @Painel('agente')
  criarDocumento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.tipos.criarDocumento(
      m.id,
      u,
      id,
      validar(esquemaDocumentoTipo, body),
    );
  }

  @Patch(':id/documentos/:doc')
  @Painel('agente')
  alterarDocumento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('doc', ParseUUIDPipe) doc: string,
    @Body() body: unknown,
  ) {
    return this.tipos.alterarDocumento(
      m.id,
      u,
      id,
      doc,
      validar(esquemaDocumentoAlterar, body),
    );
  }

  @Delete(':id/documentos/:doc')
  @Painel('agente')
  removerDocumento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('doc', ParseUUIDPipe) doc: string,
  ) {
    return this.tipos.removerDocumento(m.id, u, id, doc);
  }
}

/** Página "O seu processo", aberta pelo código do link do SMS. */
@Controller('public/processos')
export class ProcessosPublicoController {
  constructor(private readonly processos: ProcessosService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.processos.publico(codigo);
  }

  /** V2 · Decisão: "Guarde a decisão". */
  @Get(':codigo/decisao.pdf')
  async decisaoPdf(@Param('codigo') codigo: string) {
    const { nome, pdf } = await this.processos.pdfDecisao(codigo);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `inline; filename="${nome}"`,
      length: pdf.length,
    });
  }

  /** { nota: 1 (difícil) a 3 (fácil) } */
  @Post(':codigo/avaliacao')
  @HttpCode(200)
  avaliar(@Param('codigo') codigo: string, @Body() body: unknown) {
    const { nota } = validar(
      z.object({ nota: z.number().int().min(1).max(3) }),
      body,
    );
    return this.processos.avaliarPublico(codigo, nota);
  }
}
