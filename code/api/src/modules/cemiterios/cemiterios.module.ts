import {
  Body,
  Controller,
  Get,
  Module,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { RegistoServicos, servico } from '../../ferramentas/servicos.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  CemiteriosService,
  entradaConcessao,
  entradaHorarios,
  entradaPedir,
  entradaProcurar,
  entradaTaxas,
  esquemaAlterarPedido,
  esquemaFiltroPedidos,
  esquemaFiltroSepulturas,
} from './cemiterios.service.js';

/** Painel · Cemitérios: sepulturas e concessões, pedidos, taxas e horários. */
@Controller('painel/cemiterios')
@Painel('servicos_municipais')
export class CemiteriosPainelController {
  constructor(private readonly cemiterios: CemiteriosService) {}

  @Get()
  resumo(@MunicipioAtual() m: Municipio) {
    return this.cemiterios.resumo(m);
  }

  /** ?q=nome, titular ou "3 120"&cemiterio_id= */
  @Get('sepulturas')
  sepulturas(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    return this.cemiterios.sepulturas(m, validar(esquemaFiltroSepulturas, q));
  }

  /** ?estado=&limite=&cursor= */
  @Get('pedidos')
  pedidos(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const { limite, cursor } = validar(esquemaPaginacao, q);
    const f = validar(esquemaFiltroPedidos, q);
    return this.cemiterios.pedidos(m, f, limite, cursor);
  }

  /** { estado, resposta? }: concluir ou recusar manda a resposta por SMS. */
  @Patch('pedidos/:id')
  alterar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.cemiterios.alterarPedido(
      m,
      u,
      id,
      validar(esquemaAlterarPedido, body),
    );
  }
}

/**
 * Cemitérios (V4 #8) no catálogo de serviços: o agente usa
 * outros_servicos('cemiterios') e pedir_servico. Tom cuidadoso: quem liga
 * pode estar de luto (o "instrucao" de cada resultado lembra-o).
 */
@Module({
  controllers: [CemiteriosPainelController],
  providers: [CemiteriosService],
  exports: [CemiteriosService],
})
export class CemiteriosModule implements OnModuleInit {
  constructor(
    private readonly servicos: RegistoServicos,
    private readonly cemiterios: CemiteriosService,
  ) {}

  onModuleInit() {
    this.servicos.registar(
      servico({
        area: 'cemiterios',
        acao: 'procurar_sepultura',
        titulo: 'Onde está sepultada uma pessoa',
        quando:
          'Quando quer saber em que cemitério, talhão e número está sepultado um familiar.',
        entrada: entradaProcurar,
        executar: (ctx, e) => this.cemiterios.procurar(ctx, e),
      }),
      servico({
        area: 'cemiterios',
        acao: 'ver_concessao',
        titulo: 'Concessão de uma sepultura ou jazigo',
        quando:
          'Quando pergunta quem é o titular, até quando vale a concessão ou se há taxas de conservação por pagar.',
        entrada: entradaConcessao,
        executar: (ctx, e) => this.cemiterios.concessao(ctx, e),
      }),
      servico({
        area: 'cemiterios',
        acao: 'pedir_concessao',
        titulo: 'Pedir renovação, averbamento ou 2.ª via do alvará',
        quando:
          'Quando quer renovar a concessão, passá-la para outro titular ou pedir outra via do alvará.',
        entrada: entradaPedir,
        altera: true,
        executar: (ctx, e) => this.cemiterios.pedir(ctx, e),
      }),
      servico({
        area: 'cemiterios',
        acao: 'taxas',
        titulo: 'Taxas dos cemitérios',
        quando:
          'Quando pergunta quanto custa uma inumação, exumação, trasladação, concessão ou a conservação.',
        entrada: entradaTaxas,
        executar: (ctx, e) => this.cemiterios.taxas(ctx, e),
      }),
      servico({
        area: 'cemiterios',
        acao: 'horarios',
        titulo: 'Horário dos cemitérios',
        quando: 'Quando pergunta a que horas abre ou fecha um cemitério.',
        entrada: entradaHorarios,
        executar: (ctx, e) => this.cemiterios.horarios(ctx, e),
      }),
    );
  }
}
