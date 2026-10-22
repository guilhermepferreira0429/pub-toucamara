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
  Put,
  Query,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { RegistoServicos, servico } from '../../ferramentas/servicos.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PagamentosModule } from '../pagamentos/pagamentos.module.js';
import {
  entradaBilhete,
  entradaCancelar,
  entradaDisponibilidade,
  entradaEventos,
  entradaMinhas,
  entradaReservar,
  esquemaEquipamento,
  esquemaFiltroReservas,
  esquemaRecusarReserva,
  ReservasService,
} from './reservas.service.js';

export const FILA_RESERVAS_PAGAS = 'reservas_pagas';

/** Painel · Reservas: calendário por equipamento, aprovar/recusar, equipamentos e bilhetes. */
@Controller('painel/reservas')
@Painel('reservas')
export class ReservasPainelController {
  constructor(private readonly reservas: ReservasService) {}

  /** ?equipamento_id=&estado=&de=&ate= (por omissão os próximos 15 dias). */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.reservas.painel(m, validar(esquemaFiltroReservas, query));
  }

  @Post('demonstracao')
  @HttpCode(200)
  @Painel('agente')
  demonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.reservas.carregarDemonstracao(m, u);
  }

  @Post('equipamentos')
  @HttpCode(201)
  @Painel('agente')
  criarEquipamento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.reservas.criarEquipamento(
      m,
      u,
      validar(esquemaEquipamento, body),
    );
  }

  @Put('equipamentos/:id')
  @Painel('agente')
  atualizarEquipamento(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reservas.atualizarEquipamento(
      m,
      u,
      id,
      validar(esquemaEquipamento, body),
    );
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  aprovar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reservas.aprovar(m, u, id);
  }

  /** { motivo } (vai por SMS). */
  @Post(':id/recusar')
  @HttpCode(200)
  recusar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reservas.recusar(
      m,
      u,
      id,
      validar(esquemaRecusarReserva, body),
    );
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reservas.cancelarPainel(m, u, id);
  }
}

/** A página do link do SMS: a reserva ou o bilhete (com QR), e cancelar. */
@Controller('public/reservas')
export class ReservasPublicoController {
  constructor(private readonly reservas: ReservasService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.reservas.publico(codigo);
  }

  @Post(':codigo/cancelar')
  @HttpCode(200)
  cancelar(@Param('codigo') codigo: string) {
    return this.reservas.cancelarPublico(codigo);
  }
}

/**
 * Reservas (V4 #4) no catálogo de serviços: o agente usa
 * outros_servicos/pedir_servico com a área `reservas`.
 */
@Module({
  imports: [PagamentosModule],
  controllers: [ReservasPainelController, ReservasPublicoController],
  providers: [ReservasService],
  exports: [ReservasService],
})
export class ReservasModule implements OnModuleInit {
  constructor(
    private readonly servicos: RegistoServicos,
    private readonly jobs: JobsService,
    private readonly reservas: ReservasService,
  ) {}

  onModuleInit() {
    const area = 'reservas';
    this.servicos.registar(
      servico({
        area,
        acao: 'ver_disponibilidade',
        titulo: 'Equipamentos, preços e horas livres',
        quando:
          'Que pavilhões, piscinas, auditórios, salas e campos há, quanto custam (também a entrada na piscina) e que horas estão livres num dia.',
        entrada: entradaDisponibilidade,
        executar: (ctx, e) => this.reservas.verDisponibilidade(ctx, e),
      }),
      servico({
        area,
        acao: 'reservar',
        titulo: 'Reservar um equipamento',
        quando:
          'Quando quer reservar um pavilhão, campo, pista da piscina, auditório ou sala num dia e hora.',
        entrada: entradaReservar,
        altera: true,
        executar: (ctx, e) => this.reservas.reservar(ctx, e),
      }),
      servico({
        area,
        acao: 'ver_eventos',
        titulo: 'Eventos com bilhete',
        quando:
          'Que eventos municipais têm bilhetes ou inscrição, quando são, preço e lugares livres.',
        entrada: entradaEventos,
        executar: (ctx, e) => this.reservas.verEventos(ctx, e),
      }),
      servico({
        area,
        acao: 'comprar_bilhete',
        titulo: 'Reservar ou comprar bilhetes',
        quando:
          'Quando quer bilhetes (ou inscrição) para um evento municipal com lugares limitados.',
        entrada: entradaBilhete,
        altera: true,
        executar: (ctx, e) => this.reservas.comprarBilhete(ctx, e),
      }),
      servico({
        area,
        acao: 'minhas_reservas',
        titulo: 'As minhas reservas',
        quando: 'Quando quer saber que reservas ou bilhetes tem marcados.',
        entrada: entradaMinhas,
        executar: (ctx) => this.reservas.minhas(ctx),
      }),
      servico({
        area,
        acao: 'cancelar',
        titulo: 'Cancelar reserva ou bilhete',
        quando: 'Quando quer cancelar uma reserva ou bilhetes.',
        entrada: entradaCancelar,
        altera: true,
        executar: (ctx, e) => this.reservas.cancelar(ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_RESERVAS_PAGAS, async () => {
      await this.reservas.sincronizar();
    });
    this.jobs.agendar(FILA_RESERVAS_PAGAS, '* * * * *');
  }
}
