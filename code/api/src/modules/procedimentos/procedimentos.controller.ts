import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
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
  AssistenteService,
  esquemaPerguntar,
  esquemaTratar,
} from './assistente.service.js';
import {
  EntrevistasService,
  esquemaIniciar,
  esquemaResponder,
} from './entrevistas.service.js';
import {
  esquemaGuardar,
  esquemaListar,
  ProcedimentosService,
} from './procedimentos.service.js';
import { esquemaConteudo } from './regras.js';

/**
 * Painel · Procedimentos internos (só funcionários). Ler, escrever
 * rascunhos e dar entrevistas: `procedimentos_ver` (todos os perfis do
 * painel). Publicar, arquivar e alterar o que não é seu: `procedimentos`.
 */
@Controller('painel/procedimentos')
@Painel('procedimentos_ver')
export class ProcedimentosController {
  constructor(
    private readonly procedimentos: ProcedimentosService,
    private readonly entrevistas: EntrevistasService,
  ) {}

  /** ?estado=rascunho|publicado|arquivado&q=texto */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.procedimentos.listar(m, validar(esquemaListar, query));
  }

  @Post()
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.procedimentos.criar(m, u, validar(esquemaConteudo, body));
  }

  // --- Entrevistas (antes de :id) -----------------------------------------

  @Get('entrevistas')
  listarEntrevistas(@MunicipioAtual() m: Municipio) {
    return this.entrevistas.listar(m);
  }

  /** { area, servico_id? } — quem inicia é o entrevistado. */
  @Post('entrevistas')
  iniciar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.entrevistas.iniciar(m, u, validar(esquemaIniciar, body));
  }

  @Get('entrevistas/:id')
  entrevista(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.entrevistas.detalhe(m, id);
  }

  /** { resposta, por_voz? } ou { saltar: true } */
  @Post('entrevistas/:id/responder')
  @HttpCode(200)
  responder(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.entrevistas.responder(
      m,
      u,
      id,
      validar(esquemaResponder, body),
    );
  }

  @Post('entrevistas/:id/concluir')
  @HttpCode(200)
  concluir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.entrevistas.concluir(m, u, id);
  }

  @Post('entrevistas/:id/cancelar')
  @HttpCode(200)
  cancelar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.entrevistas.cancelar(m, u, id);
  }

  // --- Um procedimento -----------------------------------------------------

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.procedimentos.detalhe(m, id);
  }

  @Get(':id/versoes/:versao')
  versao(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versao', ParseIntPipe) versao: number,
  ) {
    return this.procedimentos.versao(m, id, versao);
  }

  /** O conteúdo todo (cada gravação é uma versão nova); { nota? }. */
  @Put(':id')
  guardar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.procedimentos.atualizar(
      m,
      u,
      id,
      validar(esquemaGuardar, body),
    );
  }

  @Post(':id/publicar')
  @Painel('procedimentos')
  @HttpCode(200)
  publicar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.procedimentos.publicar(m, u, id);
  }

  @Post(':id/arquivar')
  @Painel('procedimentos')
  @HttpCode(200)
  arquivar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.procedimentos.arquivar(m, u, id);
  }
}

/** Painel · Assistente interno para funcionários novos. */
@Controller('painel/assistente')
@Painel('procedimentos_ver')
export class AssistenteController {
  constructor(private readonly assistente: AssistenteService) {}

  /** { pergunta } */
  @Post('perguntar')
  @HttpCode(200)
  perguntar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.assistente.perguntar(m, u, validar(esquemaPerguntar, body));
  }

  @Get('historico')
  historico(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.assistente.historico(m, u);
  }

  /** Procedimentos em falta (?tratadas=1 junta as já tratadas). */
  @Get('lacunas')
  lacunas(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { tratadas } = validar(
      z.object({ tratadas: z.enum(['0', '1']).optional() }),
      query,
    );
    return this.assistente.lacunas(m, tratadas === '1');
  }

  /** Abre um rascunho com a pergunta como título e dá a lacuna por tratada. */
  @Post('lacunas/:id/escrever')
  escrever(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.assistente.escrever(m, u, id);
  }

  /** { procedimento_id? } */
  @Post('lacunas/:id/tratar')
  @Painel('procedimentos')
  @HttpCode(200)
  tratar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.assistente.tratar(m, u, id, validar(esquemaTratar, body ?? {}));
  }
}
