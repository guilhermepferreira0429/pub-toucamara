import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { RegistoServicos, servico } from '../../ferramentas/servicos.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PagamentosModule } from '../pagamentos/pagamentos.module.js';
import {
  entradaConsultarMulta,
  entradaDefesa,
  entradaLugarDeficiencia,
  entradaOndeEstacionar,
  entradaPagarMulta,
  esquemaDecisaoDefesa,
  esquemaDecisaoLugar,
  EstacionamentoService,
} from './estacionamento.service.js';

export const FILA_MULTAS_PAGAS = 'estacionamento_pagas';

/** Painel · Estacionamento: multas, defesas por analisar, lugares reservados e parques. */
@Controller('painel/estacionamento')
@Painel('estacionamento')
export class EstacionamentoPainelController {
  constructor(private readonly estacionamento: EstacionamentoService) {}

  @Get()
  ver(@MunicipioAtual() m: Municipio) {
    return this.estacionamento.painel(m);
  }

  /** { decisao: 'aceite' | 'recusada', nota } → SMS ao munícipe. */
  @Post('defesas/:id/decidir')
  @HttpCode(200)
  decidirDefesa(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.estacionamento.decidirDefesa(
      m,
      u,
      id,
      validar(esquemaDecisaoDefesa, body),
    );
  }

  /** { decisao: 'aprovado' | 'recusado', nota } → SMS ao munícipe. */
  @Post('lugares/:id/decidir')
  @HttpCode(200)
  decidirLugar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.estacionamento.decidirLugar(
      m,
      u,
      id,
      validar(esquemaDecisaoLugar, body),
    );
  }

  /** Parques e multas de demonstração (só os que faltam). */
  @Post('demonstracao')
  @HttpCode(200)
  @Painel('agente')
  demonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.estacionamento.carregarDemonstracao(m, u);
  }
}

/**
 * Estacionamento (V4 #5) no catálogo de serviços: o agente usa
 * outros_servicos/pedir_servico com a área `estacionamento`.
 */
@Module({
  imports: [PagamentosModule],
  controllers: [EstacionamentoPainelController],
  providers: [EstacionamentoService],
  exports: [EstacionamentoService],
})
export class EstacionamentoModule implements OnModuleInit {
  constructor(
    private readonly servicos: RegistoServicos,
    private readonly jobs: JobsService,
    private readonly estacionamento: EstacionamentoService,
  ) {}

  onModuleInit() {
    const area = 'estacionamento';
    this.servicos.registar(
      servico({
        area,
        acao: 'consultar_multa',
        titulo: 'Consultar uma multa',
        quando:
          'Quando a pessoa levou uma multa de estacionamento da câmara e quer saber o valor, o prazo ou como pagar ou reclamar.',
        entrada: entradaConsultarMulta,
        executar: (ctx, e) => this.estacionamento.consultarMulta(ctx, e),
      }),
      servico({
        area,
        acao: 'pagar_multa',
        titulo: 'Pagar uma multa',
        quando:
          'Quando quer pagar já uma multa de estacionamento (MB WAY ou Multibanco, modo de teste).',
        entrada: entradaPagarMulta,
        altera: true,
        executar: (ctx, e) => this.estacionamento.pagarMulta(ctx, e),
      }),
      servico({
        area,
        acao: 'apresentar_defesa',
        titulo: 'Contestar uma multa',
        quando:
          'Quando acha que a multa está errada e quer apresentar defesa por escrito.',
        entrada: entradaDefesa,
        altera: true,
        executar: (ctx, e) => this.estacionamento.apresentarDefesa(ctx, e),
      }),
      servico({
        area,
        acao: 'onde_estacionar',
        titulo: 'Parques, horários e tarifas',
        quando:
          'Onde estacionar perto de um sítio, quanto custa, a que horas é pago no centro ou se dá para pagar pelo telemóvel.',
        entrada: entradaOndeEstacionar,
        executar: (ctx, e) => this.estacionamento.ondeEstacionar(ctx, e),
      }),
      servico({
        area,
        acao: 'lugar_deficiencia',
        titulo: 'Lugar reservado para pessoa com deficiência',
        quando:
          'Quando quer pedir um lugar de estacionamento reservado à porta de casa ou do trabalho.',
        entrada: entradaLugarDeficiencia,
        altera: true,
        executar: (ctx, e) => this.estacionamento.pedirLugar(ctx, e),
      }),
      servico({
        area,
        acao: 'distico_residente',
        titulo: 'Dístico de residente',
        quando:
          'Quando quer o dístico de residente ou saber quanto custa (é uma licença).',
        entrada: z.object({}),
        executar: () => this.estacionamento.disticoResidente(),
      }),
    );
    this.jobs.trabalhar(FILA_MULTAS_PAGAS, async () => {
      await this.estacionamento.sincronizar();
    });
    this.jobs.agendar(FILA_MULTAS_PAGAS, '* * * * *');
  }
}
