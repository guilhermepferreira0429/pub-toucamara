import {
  Controller,
  Get,
  HttpCode,
  Module,
  OnModuleInit,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { INTERESSES } from './turismo.regras.js';
import { entradaOQueVisitar, TurismoService } from './turismo.service.js';

function cache(res: Response): void {
  res.setHeader(
    'Cache-Control',
    'public, max-age=60, stale-while-revalidate=120',
  );
}

const esquemaLingua = z.object({
  lingua: z.string().trim().max(10).optional(),
});

const esquemaRoteiro = esquemaLingua.extend({
  minutos: z.coerce.number().int().min(30).max(720).default(180),
  interesses: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const partes = (v ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const maus = partes.filter(
        (p) => !(INTERESSES as readonly string[]).includes(p),
      );
      if (maus.length) {
        ctx.addIssue({
          code: 'custom',
          message: `Interesses desconhecidos: ${maus.join(', ')}.`,
        });
        return z.NEVER;
      }
      return partes as (typeof INTERESSES)[number][];
    }),
  mobilidade: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

/** Painel: as fontes de turismo de demonstração e o indicador por língua. */
@Controller('painel/turismo')
@Painel('conhecimento_ver')
export class TurismoPainelController {
  constructor(private readonly turismo: TurismoService) {}

  @Get()
  resumo(@MunicipioAtual() m: Municipio) {
    return this.turismo.resumo(m);
  }

  /** Idempotente: só cria as fontes que faltam; não mexe no texto já editado. */
  @Post('demonstracao')
  @HttpCode(201)
  @Painel('conhecimento')
  demonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.turismo.carregarDemonstracao(m, u);
  }
}

/** A página /visitar (sem login): `?lingua=pt|en|es|fr`. */
@Controller('public/turismo')
export class TurismoPublicoController {
  constructor(private readonly turismo: TurismoService) {}

  @Get(':municipio')
  async ver(
    @Param('municipio') municipio: string,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { lingua } = validar(esquemaLingua, q);
    const r = await this.turismo.publico(municipio, lingua);
    cache(res);
    return r;
  }

  /** `?lingua=&minutos=&interesses=historia,museus&mobilidade=1` */
  @Get(':municipio/roteiro')
  async roteiro(
    @Param('municipio') municipio: string,
    @Query() q: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = validar(esquemaRoteiro, q);
    const r = await this.turismo.roteiroPublico(municipio, f.lingua, {
      minutos: f.minutos,
      interesses: f.interesses,
      mobilidade_reduzida: f.mobilidade,
    });
    cache(res);
    return r;
  }
}

/**
 * Turistas (V4 #10): conteúdo turístico como fontes oficiais (tipo
 * 'turismo', em várias línguas), a página /visitar e a ferramenta
 * o_que_visitar (roteiro com o tempo, os interesses e a mobilidade da
 * pessoa, mais os eventos dos próximos dias do /agora).
 */
@Module({
  controllers: [TurismoPainelController, TurismoPublicoController],
  providers: [TurismoService],
  exports: [TurismoService],
})
export class TurismoModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly turismo: TurismoService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'o_que_visitar',
        descricao:
          'Quando um turista pergunta o que visitar ou o que ver em X horas (um sítio concreto: procurar_conhecimento): roteiro a pé, eventos dos próximos dias e link do mapa. ' +
          'Os tempos são estimativas; horários e preços confirmam-se no local.',
        entrada: entradaOQueVisitar,
        executar: (ctx, e) => this.turismo.oQueVisitar(ctx, e),
      }),
    );
  }
}
