import {
  Controller,
  Get,
  HttpCode,
  Module,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { RegistoServicos, servico } from '../../ferramentas/servicos.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import {
  AguaService,
  entradaAvaria,
  entradaContacto,
  entradaFatura,
  entradaLeitura,
  esquemaFiltroPedidos,
} from './agua.service.js';
import { INTEGRACAO_VIMAGUA } from './integracao-vimagua.js';
import { VimaguaSimulada } from './vimagua-simulada.js';

/** Reenvio à entidade gestora do que falhou (de 5 em 5 minutos). */
export const FILA_AGUA_REENVIAR = 'agua_reenviar';

/** Painel · Água e saneamento: os pedidos encaminhados e o estado do envio. */
@Controller('painel/agua')
@Painel('servicos_municipais')
export class AguaPainelController {
  constructor(private readonly agua: AguaService) {}

  @Get()
  resumo(@MunicipioAtual() m: Municipio) {
    return this.agua.resumo(m);
  }

  /** ?tipo=&envio=&limite=&cursor= */
  @Get('pedidos')
  pedidos(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const { limite, cursor } = validar(esquemaPaginacao, q);
    return this.agua.pedidos(
      m,
      validar(esquemaFiltroPedidos, q),
      limite,
      cursor,
    );
  }

  @Post('pedidos/:id/reenviar')
  @HttpCode(200)
  reenviar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.agua.reenviar(m, u, id);
  }
}

/**
 * Água e saneamento (V4 #6) no catálogo de serviços. A câmara só
 * encaminha: o pedido fica registado e segue para a entidade gestora pelo
 * adaptador IntegracaoVimagua (SIMULADO enquanto não houver acordo).
 */
@Module({
  imports: [OcorrenciasModule],
  controllers: [AguaPainelController],
  providers: [
    AguaService,
    VimaguaSimulada,
    { provide: INTEGRACAO_VIMAGUA, useExisting: VimaguaSimulada },
  ],
  exports: [AguaService],
})
export class AguaModule implements OnModuleInit {
  constructor(
    private readonly servicos: RegistoServicos,
    private readonly jobs: JobsService,
    private readonly agua: AguaService,
  ) {}

  onModuleInit() {
    this.servicos.registar(
      servico({
        area: 'agua',
        acao: 'comunicar_leitura',
        titulo: 'Comunicar a leitura do contador',
        quando: 'Quando quer dar a leitura do contador da água.',
        entrada: entradaLeitura,
        altera: true,
        executar: (ctx, e) => this.agua.leitura(ctx, e),
      }),
      servico({
        area: 'agua',
        acao: 'fatura',
        titulo: '2.ª via ou explicação da fatura da água',
        quando:
          'Quando quer outra via da fatura da água ou não percebe ou não concorda com uma fatura.',
        entrada: entradaFatura,
        altera: true,
        executar: (ctx, e) => this.agua.fatura(ctx, e),
      }),
      servico({
        area: 'agua',
        acao: 'reportar_avaria',
        titulo: 'Avaria, rotura ou falta de água',
        quando:
          'Quando há um cano rebentado, água a correr na rua, esgoto entupido ou está sem água.',
        entrada: entradaAvaria,
        altera: true,
        executar: (ctx, e) => this.agua.avaria(ctx, e),
      }),
      servico({
        area: 'agua',
        acao: 'contacto',
        titulo: 'Contacto da entidade da água',
        quando:
          'Quando só quer o contacto de quem trata da água e do saneamento.',
        entrada: entradaContacto,
        executar: (ctx) => this.agua.contacto(ctx),
      }),
    );
    this.jobs.trabalhar(FILA_AGUA_REENVIAR, async () => {
      await this.agua.reenviarPendentes();
    });
    this.jobs.agendar(FILA_AGUA_REENVIAR, '*/5 * * * *');
  }
}
