import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
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
import { TIPOS_ITEM } from './entrada.regras.js';
import {
  EntradaService,
  esquemaAtribuir,
  esquemaBalcao,
  esquemaConfig,
  esquemaConverter,
  esquemaLista,
  esquemaResumo,
} from './entrada.service.js';
import { EncaminhamentoAutomaticoService } from './encaminhamento-automatico.service.js';

const esquemaTipo = z.enum(TIPOS_ITEM, 'Tipo de item desconhecido.');

/** Caixa de entrada única do painel (recurso 'entrada'). */
@Controller('painel/entrada')
@Painel('entrada')
export class EntradaController {
  constructor(
    private readonly entrada: EntradaService,
    private readonly encaminhamento: EncaminhamentoAutomaticoService,
  ) {}

  /** ?canal=&tipo=&servico_id=&meus=&por_atribuir=&limite=&cursor= */
  @Get()
  listar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.entrada.listar(m.id, u, validar(esquemaLista, query));
  }

  /** Contagens por tipo e canal (badge da barra lateral). ?meus= */
  @Get('resumo')
  resumo(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    const { meus } = validar(esquemaResumo, query);
    return this.entrada.resumo(m.id, u, meus ?? false);
  }

  /** { ativo, atribuir_tecnico } do encaminhamento automático. */
  @Get('config')
  @Painel('equipa')
  config(@MunicipioAtual() m: Municipio) {
    return this.encaminhamento.config(m.id);
  }

  @Put('config')
  @Painel('equipa')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.encaminhamento.guardarConfig(
      m.id,
      u.id,
      validar(esquemaConfig, body ?? {}),
      ip,
    );
  }

  /** Atendimento presencial: { telefone?, nif?, nome?, assunto, descricao, servico_id?, urgente?, prazo_resposta? } */
  @Post('balcao')
  balcao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.entrada.registarBalcao(
      m.id,
      u,
      validar(esquemaBalcao, body),
      ip,
    );
  }

  @Get('pedidos/:id')
  obterPedido(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.entrada.obterPedido(m.id, id);
  }

  @Post('pedidos/:id/fechar')
  @HttpCode(200)
  fecharPedido(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.entrada.fecharPedido(m.id, u, id, ip);
  }

  /** Email ou pedido → processo: { tipo_processo_id, assunto? } */
  @Post(':tipo/:id/processo')
  converter(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('tipo') tipo: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.entrada.converterEmProcesso(
      m.id,
      u,
      validar(esquemaTipo, tipo),
      id,
      validar(esquemaConverter, body),
      ip,
    );
  }

  /** Atribuição manual: { servico_id?, tecnico_id? } (desfaz a automática). */
  @Post(':tipo/:id/atribuir')
  @HttpCode(200)
  atribuir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('tipo') tipo: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    return this.entrada.atribuir(
      m.id,
      u,
      validar(esquemaTipo, tipo),
      id,
      validar(esquemaAtribuir, body),
      ip,
    );
  }
}
