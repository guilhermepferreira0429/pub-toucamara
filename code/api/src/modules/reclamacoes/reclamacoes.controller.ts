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
  esquemaAnexo,
  esquemaAtribuir,
  esquemaConverterEmail,
  esquemaEncerrar,
  esquemaFiltro,
  esquemaNova,
  esquemaRascunho,
  esquemaResponder,
  ReclamacoesService,
} from './reclamacoes.service.js';
import { esquemaConfig } from './regras.js';

/** Painel · Livro de reclamações. */
@Controller('painel/reclamacoes')
@Painel('reclamacoes')
export class ReclamacoesPainelController {
  constructor(private readonly reclamacoes: ReclamacoesService) {}

  /** ?estado=recebida|em_analise|respondida|encerrada|abertas&servico_id= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.reclamacoes.listar(m, validar(esquemaFiltro, query));
  }

  /** Registo à mão: balcão, Livro Amarelo em papel, telefone, email. */
  @Post()
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.criarNoPainel(m, u, validar(esquemaNova, body));
  }

  /** Serviços e funcionários para atribuir. */
  @Get('opcoes')
  opcoes(@MunicipioAtual() m: Municipio) {
    return this.reclamacoes.opcoes(m);
  }

  @Get('config')
  config(@MunicipioAtual() m: Municipio) {
    return this.reclamacoes.configDe(m.id).then((config) => ({ config }));
  }

  /** O prazo legal e os avisos (só a chefia). */
  @Put('config')
  @Painel('agente')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.guardarConfig(m, u, validar(esquemaConfig, body));
  }

  /** Emails da triagem que parecem reclamações (ainda não registadas). */
  @Get('emails')
  emails(@MunicipioAtual() m: Municipio) {
    return this.reclamacoes.emailsCandidatos(m);
  }

  @Post('emails/:emailId')
  converterEmail(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('emailId', ParseUUIDPipe) emailId: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.converterEmail(
      m,
      u,
      emailId,
      validar(esquemaConverterEmail, body ?? {}),
    );
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reclamacoes.detalhe(m, id);
  }

  /** { servico_id?, utilizador_id? } */
  @Post(':id/atribuir')
  @HttpCode(200)
  atribuir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.atribuir(m, u, id, validar(esquemaAtribuir, body));
  }

  /** Rascunho da resposta (IA com as notas, ou o modelo fixo). */
  @Post(':id/rascunho')
  @HttpCode(200)
  rascunho(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.rascunho(
      m,
      id,
      validar(esquemaRascunho, body ?? {}),
    );
  }

  /** { texto }: vai por SMS (link) ou email e fica na página pública. */
  @Post(':id/responder')
  @HttpCode(200)
  responder(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.responder(
      m,
      u,
      id,
      validar(esquemaResponder, body),
    );
  }

  /** { nota? } (obrigatória se ainda não houver resposta). */
  @Post(':id/encerrar')
  @HttpCode(200)
  encerrar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.encerrar(
      m,
      u,
      id,
      validar(esquemaEncerrar, body ?? {}),
    );
  }

  /** { nome, mime } → URL assinada para enviar o ficheiro (PUT). */
  @Post(':id/anexos')
  anexo(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.pedirEnvioAnexo(
      m,
      u,
      id,
      validar(esquemaAnexo, body),
    );
  }
}

/** A página do link do SMS: estado, prazo e resposta. */
@Controller('public/reclamacoes')
export class ReclamacoesPublicoController {
  constructor(private readonly reclamacoes: ReclamacoesService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.reclamacoes.publico(codigo);
  }
}
