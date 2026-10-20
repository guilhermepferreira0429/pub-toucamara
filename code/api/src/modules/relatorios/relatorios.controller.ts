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
import { janelaAte } from './diario.js';
import { RelatoriosService } from './relatorios.service.js';
import { ResumoDiarioService } from './resumo-diario.service.js';

const TIPOS = ['semanal', 'mensal', 'executivo'] as const;

const esquemaLista = esquemaPaginacao.extend({
  tipo: z.enum([...TIPOS, 'diario']).optional(),
});

/** Mandar também o email (por omissão não). */
const enviar = z.boolean().default(false);

const esquemaGerar = z.discriminatedUnion('tipo', [
  z.object({
    tipo: z.enum(TIPOS),
    de: z.string(),
    ate: z.string(),
    enviar,
  }),
  /** Resumo diário: as 24 horas até `ate` (por omissão agora). */
  z.object({
    tipo: z.literal('diario'),
    ate: z.iso.datetime({ offset: true }).optional(),
    enviar,
  }),
]);

@Controller('painel/relatorios')
@Painel('indicadores')
export class RelatoriosController {
  constructor(
    private readonly relatorios: RelatoriosService,
    private readonly diario: ResumoDiarioService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { tipo, limite, cursor } = validar(esquemaLista, query);
    return this.relatorios.listar(m, tipo, limite, cursor);
  }

  /**
   * Gerar à mão (ou refazer) um relatório de um período qualquer; o diário,
   * das 24 horas até `ate` (ISO com fuso; por omissão agora).
   */
  @Post('gerar')
  @HttpCode(200)
  async gerar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const pedido = validar(esquemaGerar, body);
    if (pedido.tipo === 'diario') {
      const janela = janelaAte(
        pedido.ate ? new Date(pedido.ate) : new Date(),
        m.fuso,
      );
      const r = await this.diario.gerar(m, janela, {
        enviar: pedido.enviar,
        refazer: true,
      });
      await this.registar(m, u, r.id, ip, {
        tipo: 'diario',
        dia: janela.dia,
        ate: janela.ate.toISOString(),
        enviar: pedido.enviar,
      });
      return r;
    }
    const { tipo, enviar: env, ...datas } = pedido;
    const { de, ate } = lerPeriodo(datas, hojeNoFuso(m.fuso));
    const r = await this.relatorios.gerar(
      m,
      tipo,
      { de, ate },
      { enviar: env, refazer: true },
    );
    await this.registar(m, u, r.id, ip, { tipo, de, ate, enviar: env });
    return r;
  }

  private registar(
    m: Municipio,
    u: UtilizadorPainel,
    id: string,
    ip: string,
    dados: Record<string, unknown>,
  ) {
    return this.auditoria.registar({
      municipioId: m.id,
      atorTipo: 'utilizador',
      atorId: u.id,
      acao: 'gerar_relatorio',
      objetoTipo: 'relatorio',
      objetoId: id,
      dados,
      ip,
    });
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
