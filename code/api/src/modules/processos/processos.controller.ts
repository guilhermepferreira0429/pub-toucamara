import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  esquemaAtualizarProcesso,
  esquemaListaProcessos,
  esquemaNota,
  esquemaPedirDocumento,
  ProcessosPainelService,
} from './processos-painel.service.js';
import { ProcessosService } from './processos.service.js';
import { TiposProcessoService } from './tipos-processo.service.js';

@Controller('painel/processos')
@Painel('processos')
export class ProcessosPainelController {
  constructor(private readonly painel: ProcessosPainelService) {}

  /** ?fase=&tecnico_id=(uuid|eu)&atrasados=true&aguarda_municipe=true&texto=&limite=&cursor= */
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
}

@Controller('painel/tipos-processo')
@Painel('processos')
export class TiposProcessoController {
  constructor(private readonly tipos: TiposProcessoService) {}

  @Get()
  async listar(@MunicipioAtual() m: Municipio) {
    return { itens: await this.tipos.listar(m.id) };
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
}
