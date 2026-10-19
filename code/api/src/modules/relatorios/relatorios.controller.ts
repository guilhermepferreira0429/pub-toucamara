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
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { hojeNoFuso, lerPeriodo } from '../painel/periodos.js';
import { RelatoriosService } from './relatorios.service.js';

const TIPOS = ['semanal', 'mensal', 'executivo'] as const;

const esquemaLista = esquemaPaginacao.extend({
  tipo: z.enum(TIPOS).optional(),
});

const esquemaGerar = z.object({
  tipo: z.enum(TIPOS),
  de: z.string(),
  ate: z.string(),
  /** Mandar também o email às chefias e vereação (por omissão não). */
  enviar: z.boolean().default(false),
});

@Controller('painel/relatorios')
@Painel('indicadores')
export class RelatoriosController {
  constructor(
    private readonly relatorios: RelatoriosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { tipo, limite, cursor } = validar(esquemaLista, query);
    return this.relatorios.listar(m, tipo, limite, cursor);
  }

  /** Gerar à mão (ou refazer) um relatório de um período qualquer. */
  @Post('gerar')
  @HttpCode(200)
  async gerar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const { tipo, enviar, ...datas } = validar(esquemaGerar, body);
    const { de, ate } = lerPeriodo(datas, hojeNoFuso(m.fuso));
    const r = await this.relatorios.gerar(
      m,
      tipo,
      { de, ate },
      { enviar, refazer: true },
    );
    await this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'gerar_relatorio',
      objetoTipo: 'relatorio',
      objetoId: r.id,
      dados: { tipo, de, ate, enviar },
      ip,
    });
    return r;
  }

  @Get(':id')
  obter(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.relatorios.obter(m, id);
  }

  /** URL assinada do PDF, válida 5 minutos. */
  @Get(':id/pdf')
  pdf(@MunicipioAtual() m: Municipio, @Param('id', ParseUUIDPipe) id: string) {
    return this.relatorios.urlPdf(m, id);
  }
}
