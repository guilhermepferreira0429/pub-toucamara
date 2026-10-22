import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import { pode } from '../auth/permissoes.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { hojeNoFuso, lerPeriodo } from '../painel/periodos.js';
import { esquemaResposta } from './satisfacao.regras.js';
import { SatisfacaoService } from './satisfacao.service.js';

const esquemaCodigo = z
  .string()
  .regex(/^[0-9A-Za-z]{4,12}$/, 'Código inválido.');

/** A pergunta "Ficou resolvido?" na página do resumo (link do SMS). */
@Controller('public/resumos')
export class SatisfacaoPublicaController {
  constructor(private readonly satisfacao: SatisfacaoService) {}

  @Get(':codigo/satisfacao')
  estado(@Param('codigo') codigo: string) {
    return this.satisfacao.estado(validar(esquemaCodigo, codigo));
  }

  @Post(':codigo/satisfacao')
  @HttpCode(200)
  responder(@Param('codigo') codigo: string, @Body() body: unknown) {
    const c = validar(esquemaCodigo, codigo);
    const { nota, comentario } = validar(esquemaResposta, body);
    return this.satisfacao.responder(c, nota, comentario);
  }
}

@Controller('painel/satisfacao')
export class SatisfacaoPainelController {
  constructor(private readonly satisfacao: SatisfacaoService) {}

  /**
   * Cartão "Satisfação" da Visão geral (`?de=&ate=`, como a visão geral).
   * Os comentários são texto livre (podem ter dados pessoais): só para quem
   * pode ver as conversas.
   */
  @Get()
  @Painel('visao_geral')
  resumo(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    const { de, ate } = lerPeriodo(query, hojeNoFuso(m.fuso));
    return this.satisfacao.painel(m, { de, ate }, pode(u.perfil, 'conversas'));
  }
}
