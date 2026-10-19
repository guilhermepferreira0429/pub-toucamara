import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PainelConversasService } from './painel-conversas.service.js';

// Query strings chegam como texto: 'true'/'false' → booleano.
const booleano = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

const esquemaFiltros = esquemaPaginacao.extend({
  canal: z
    .enum(['telefone', 'chat', 'sms', 'email', 'balcao', 'whatsapp'])
    .optional(),
  resultado: z
    .enum([
      'em_curso',
      'resolvida',
      'passada_funcionario',
      'sem_resposta',
      'marcacao',
      'emergencia',
      'caiu',
    ])
    .optional(),
  tema_id: z.uuid().optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
  texto: z.string().trim().min(2).max(200).optional(),
  fora_de_horas: booleano,
  revisao: z.enum(['certa', 'errada', 'por_rever']).optional(),
});

const esquemaRevisao = z.object({
  revisao: z.enum(['certa', 'errada']),
  nota: z.string().trim().max(2000).optional(),
});

@Controller('painel/conversas')
@Painel('conversas')
export class PainelConversasController {
  constructor(private readonly conversas: PainelConversasService) {}

  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.conversas.listar(m.id, validar(esquemaFiltros, query));
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.conversas.detalhe(m.id, id, u, ip);
  }

  @Get(':id/gravacao')
  @Painel('gravacoes')
  gravacao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.conversas.gravacao(m.id, id, u, ip);
  }

  @Post(':id/revisao')
  @HttpCode(200)
  rever(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { revisao, nota } = validar(esquemaRevisao, body);
    return this.conversas.rever(m.id, id, u, revisao, nota || null);
  }
}

@Controller('public/resumos')
export class ResumosPublicosController {
  constructor(private readonly conversas: PainelConversasService) {}

  /** Ecrã "O que tem de fazer", aberto pelo código do link do SMS. */
  @Get(':codigo')
  resumo(@Param('codigo') codigo: string) {
    const c = validar(
      z.string().regex(/^[0-9A-Za-z]{4,12}$/, 'Código inválido.'),
      codigo,
    );
    return this.conversas.publico(c);
  }
}
