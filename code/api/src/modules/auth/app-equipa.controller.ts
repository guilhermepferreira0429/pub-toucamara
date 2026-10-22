import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  AppEquipaService,
  esquemaEntrarEquipa,
  esquemaPedirCodigoEquipa,
} from './app-equipa.service.js';
import { Painel } from './painel.guard.js';

/**
 * Entrar na app da equipa de campo (telemóvel): email → código de 6
 * dígitos → sessão do painel ligada ao dispositivo, revogável.
 */
@Controller('painel/auth/app')
export class AppEquipaController {
  constructor(private readonly app: AppEquipaService) {}

  /** Manda o código por email. Responde igual exista ou não a conta. */
  @Post('codigo')
  @HttpCode(202)
  codigo(@Body() body: unknown, @Ip() ip: string) {
    return this.app.pedirCodigo(validar(esquemaPedirCodigoEquipa, body), ip);
  }

  @Post('entrar')
  @HttpCode(200)
  entrar(@Body() body: unknown, @Ip() ip: string) {
    return this.app.entrar(validar(esquemaEntrarEquipa, body), ip);
  }

  /** Termina a sessão deste telemóvel. */
  @Post('sair')
  @HttpCode(200)
  @Painel()
  sair(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Ip() ip: string,
  ) {
    if (!u.sessaoAppId) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'sem_sessao_app',
        'Esta sessão não é da app da equipa.',
      );
    }
    return this.app.revogar(m.id, u, u.sessaoAppId, ip);
  }

  /** As minhas sessões de telemóvel ativas. */
  @Get('sessoes')
  @Painel()
  sessoes(@UtilizadorAtual() u: UtilizadorPainel) {
    return this.app.sessoes(u);
  }

  /** Terminar outra sessão minha (telemóvel perdido); a chefia, de qualquer pessoa. */
  @Post('sessoes/:id/revogar')
  @HttpCode(200)
  @Painel()
  revogar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.app.revogar(m.id, u, id, ip);
  }
}
