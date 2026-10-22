import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { RegistoServicos, servico } from '../../ferramentas/servicos.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  entradaCriterios,
  entradaEstadoCandidatura,
  entradaPedirReparacao,
  entradaPreCandidatura,
  entradaRenda,
  entradaRevisaoRenda,
  esquemaMudarCandidatura,
  esquemaMudarReparacao,
  HabitacaoService,
} from './habitacao.service.js';

/** Painel · Habitação municipal: candidaturas, reparações, fogos e inquilinos. */
@Controller('painel/habitacao')
@Painel('habitacao')
export class HabitacaoPainelController {
  constructor(private readonly habitacao: HabitacaoService) {}

  @Get()
  ver(@MunicipioAtual() m: Municipio) {
    return this.habitacao.painel(m);
  }

  /** ?estado= */
  @Get('candidaturas')
  candidaturas(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { estado } = validar(
      z.object({ estado: esquemaMudarCandidatura.shape.estado.optional() }),
      query,
    );
    return this.habitacao.candidaturas(m, estado);
  }

  /** { estado, nota? } */
  @Patch('candidaturas/:id')
  mudarCandidatura(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.habitacao.mudarCandidatura(
      m,
      u,
      id,
      validar(esquemaMudarCandidatura, body),
    );
  }

  /** ?estado= */
  @Get('reparacoes')
  reparacoes(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { estado } = validar(
      z.object({
        estado: z
          .enum(['registada', 'atribuida', 'em_curso', 'concluida'])
          .optional(),
      }),
      query,
    );
    return this.habitacao.reparacoes(m, estado);
  }

  /** { estado?, atribuida_a? }: concluída avisa o inquilino por SMS. */
  @Patch('reparacoes/:id')
  mudarReparacao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.habitacao.mudarReparacao(
      m,
      u,
      id,
      validar(esquemaMudarReparacao, body),
    );
  }

  /** Fogos com o inquilino e a renda, e os pedidos de revisão da renda. */
  @Get('fogos')
  fogos(@MunicipioAtual() m: Municipio) {
    return this.habitacao.fogos(m);
  }

  @Post('demonstracao')
  @HttpCode(201)
  demonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.habitacao.carregarDemonstracao(m, u);
  }
}

@Module({
  controllers: [HabitacaoPainelController],
  providers: [HabitacaoService],
  exports: [HabitacaoService],
})
export class HabitacaoModule implements OnModuleInit {
  constructor(
    private readonly servicos: RegistoServicos,
    private readonly habitacao: HabitacaoService,
  ) {}

  onModuleInit() {
    const area = 'habitacao' as const;
    this.servicos.registar(
      servico({
        area,
        acao: 'criterios',
        titulo: 'Quem pode candidatar-se',
        quando:
          'Quando pergunta se pode ter uma casa da câmara ou renda acessível e quais os critérios.',
        entrada: entradaCriterios,
        executar: (_ctx, e) => Promise.resolve(this.habitacao.criterios(e)),
      }),
      servico({
        area,
        acao: 'pre_candidatura',
        titulo: 'Pré-candidatura a habitação',
        quando:
          'Quando quer candidatar-se a uma casa da câmara (dá a pontuação provisória).',
        entrada: entradaPreCandidatura,
        altera: true,
        executar: (ctx, e) => this.habitacao.preCandidatura(ctx, e),
      }),
      servico({
        area,
        acao: 'estado_candidatura',
        titulo: 'Como está a candidatura',
        quando: 'Quando pergunta pela sua candidatura a habitação.',
        entrada: entradaEstadoCandidatura,
        executar: (ctx, e) => this.habitacao.estadoCandidatura(ctx, e),
      }),
      servico({
        area,
        acao: 'renda',
        titulo: 'Renda e próximas prestações',
        quando:
          'Quando um inquilino da câmara pergunta quanto paga, quando vence ou se tem rendas em atraso.',
        entrada: entradaRenda,
        executar: (ctx) => this.habitacao.renda(ctx),
      }),
      servico({
        area,
        acao: 'pedir_reparacao',
        titulo: 'Pedir uma reparação na casa',
        quando:
          'Quando um inquilino da câmara tem uma avaria ou estrago em casa.',
        entrada: entradaPedirReparacao,
        altera: true,
        executar: (ctx, e) => this.habitacao.pedirReparacao(ctx, e),
      }),
      servico({
        area,
        acao: 'revisao_renda',
        titulo: 'Pedir revisão da renda',
        quando:
          'Quando um inquilino da câmara ganha menos (ou a família mudou) e quer rever a renda.',
        entrada: entradaRevisaoRenda,
        altera: true,
        executar: (ctx, e) => this.habitacao.revisaoRenda(ctx, e),
      }),
    );
  }
}
