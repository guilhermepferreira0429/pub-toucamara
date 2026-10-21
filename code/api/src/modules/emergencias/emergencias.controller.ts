import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { GUIOES, PRECOS_DEMONSTRACAO } from './emergencias.regras.js';
import {
  EmergenciasService,
  esquemaConfig,
  esquemaEncerrar,
  esquemaEnviar,
  esquemaNovaEmergencia,
  esquemaTratar,
} from './emergencias.service.js';

/**
 * Avisos de emergência em massa no painel. Ver, criar, simular e tratar
 * pedidos de ajuda: 'acao_social' (atendimento e chefe de divisão; são dados
 * sensíveis). Enviar, encerrar e mudar o ritmo/proteção civil: 'agente'
 * (chefe de divisão: falar com a população em nome da câmara).
 */
@Controller('painel/emergencias')
@Painel('acao_social')
export class EmergenciasController {
  constructor(private readonly emergencias: EmergenciasService) {}

  @Get()
  listar(@MunicipioAtual() m: Municipio) {
    return this.emergencias.listar(m);
  }

  /** Ritmo de envio, proteção civil e os textos prontos por tipo. */
  @Get('config')
  async config(@MunicipioAtual() m: Municipio) {
    return {
      ...(await this.emergencias.obterConfig(m)),
      guioes: GUIOES,
      precos: PRECOS_DEMONSTRACAO,
    };
  }

  @Put('config')
  @Painel('agente')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.emergencias.guardarConfig(m, u, validar(esquemaConfig, body));
  }

  /** Rascunho com a simulação; com `simular: true` só o plano (nada gravado). */
  @Post()
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.emergencias.criar(m, u, validar(esquemaNovaEmergencia, body));
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emergencias.detalhe(m, id);
  }

  /** Simular de novo um rascunho (nada sai). O envio exige 'agente'. */
  @Post(':id/simular')
  @HttpCode(200)
  simular(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emergencias.enviar(m, u, id, { simular: true });
  }

  /**
   * { simular: true } → o plano; { confirmo_destinatarios: N,
   * confirmo_texto: 'ENVIAR' } → envia (dupla confirmação).
   */
  @Post(':id/enviar')
  @HttpCode(200)
  @Painel('agente')
  enviar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.emergencias.enviar(m, u, id, validar(esquemaEnviar, body));
  }

  @Post(':id/encerrar')
  @HttpCode(200)
  @Painel('agente')
  encerrar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.emergencias.encerrar(
      m,
      u,
      id,
      validar(esquemaEncerrar, body ?? {}),
    );
  }

  @Post(':id/destinatarios/:destId/tratar')
  @HttpCode(200)
  tratar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('destId', ParseUUIDPipe) destId: string,
    @Body() body: unknown,
  ) {
    return this.emergencias.tratar(
      m,
      u,
      id,
      destId,
      validar(esquemaTratar, body ?? {}),
    );
  }
}
