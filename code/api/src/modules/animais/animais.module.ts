import {
  Body,
  Controller,
  Get,
  Module,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { RegistoServicos, servico } from '../../ferramentas/servicos.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import {
  AnimaisService,
  entradaNaVia,
  entradaParaAdotar,
  entradaRegisto,
  entradaReportar,
  entradaVisita,
  esquemaAlterarVisita,
  esquemaEstadoAnimal,
  esquemaEstadoReporte,
  esquemaFiltroReportados,
  esquemaFiltroVisitas,
  esquemaNovoAnimal,
} from './animais.service.js';

/** Painel · Animais: os animais do canil, os pedidos de visita e os avisos. */
@Controller('painel/animais')
@Painel('servicos_municipais')
export class AnimaisPainelController {
  constructor(private readonly animais: AnimaisService) {}

  @Get()
  resumo(@MunicipioAtual() m: Municipio) {
    return this.animais.resumo(m);
  }

  @Post()
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.animais.criarAnimal(m, u, validar(esquemaNovoAnimal, body));
  }

  @Patch(':id')
  estado(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { estado } = validar(esquemaEstadoAnimal, body);
    return this.animais.mudarEstadoAnimal(m, u, id, estado);
  }

  /** ?estado=&limite=&cursor= */
  @Get('visitas')
  visitas(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const { limite, cursor } = validar(esquemaPaginacao, q);
    return this.animais.visitas(
      m,
      validar(esquemaFiltroVisitas, q),
      limite,
      cursor,
    );
  }

  /** { estado, mensagem? }: confirmar (com a hora) e desmarcar avisam por SMS. */
  @Patch('visitas/:id')
  alterarVisita(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.animais.alterarVisita(
      m,
      u,
      id,
      validar(esquemaAlterarVisita, body),
    );
  }

  /** ?tipo=&estado=&limite=&cursor= */
  @Get('reportados')
  reportados(@MunicipioAtual() m: Municipio, @Query() q: unknown) {
    const { limite, cursor } = validar(esquemaPaginacao, q);
    return this.animais.reportados(
      m,
      validar(esquemaFiltroReportados, q),
      limite,
      cursor,
    );
  }

  @Patch('reportados/:id')
  alterarReportado(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { estado } = validar(esquemaEstadoReporte, body);
    return this.animais.mudarEstadoReporte(m, u, id, estado);
  }
}

/** A página /adotar (sem login): os animais do canil para adoção. */
@Controller('public/animais')
export class AnimaisPublicoController {
  constructor(private readonly animais: AnimaisService) {}

  @Get(':municipio/adocao')
  async adocao(
    @Param('municipio') municipio: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.animais.publico(municipio);
    res.setHeader('Cache-Control', 'public, max-age=60');
    return r;
  }
}

/**
 * Animais (V4 #9) no catálogo de serviços: adoções e visitas ao canil,
 * animais perdidos/encontrados/abandonados, feridos ou agressivos na via
 * (ocorrência urgente) e a informação do registo e da vacina (SIAC).
 */
@Module({
  imports: [OcorrenciasModule],
  controllers: [AnimaisPainelController, AnimaisPublicoController],
  providers: [AnimaisService],
  exports: [AnimaisService],
})
export class AnimaisModule implements OnModuleInit {
  constructor(
    private readonly servicos: RegistoServicos,
    private readonly animais: AnimaisService,
  ) {}

  onModuleInit() {
    this.servicos.registar(
      servico({
        area: 'animais',
        acao: 'animais_para_adotar',
        titulo: 'Animais para adoção no canil',
        quando:
          'Quando quer adotar um cão ou um gato ou saber que animais há no canil municipal.',
        entrada: entradaParaAdotar,
        executar: (ctx, e) => this.animais.paraAdotar(ctx, e),
      }),
      servico({
        area: 'animais',
        acao: 'marcar_visita_adocao',
        titulo: 'Marcar visita ao canil para adotar',
        quando:
          'Quando quer ir ao canil conhecer um animal para adotar (dia e período).',
        entrada: entradaVisita,
        altera: true,
        executar: (ctx, e) => this.animais.marcarVisita(ctx, e),
      }),
      servico({
        area: 'animais',
        acao: 'reportar_animal',
        titulo: 'Animal perdido, encontrado ou abandonado',
        quando:
          'Quando perdeu o seu animal, encontrou um animal na rua ou viu um animal abandonado.',
        entrada: entradaReportar,
        altera: true,
        executar: (ctx, e) => this.animais.reportar(ctx, e),
      }),
      servico({
        area: 'animais',
        acao: 'animal_na_via',
        titulo: 'Animal ferido ou agressivo na rua (urgente)',
        quando:
          'Quando há um animal ferido ou agressivo na via pública: vai como urgente à equipa do canil.',
        entrada: entradaNaVia,
        altera: true,
        executar: (ctx, e) => this.animais.naVia(ctx, e),
      }),
      servico({
        area: 'animais',
        acao: 'registo_e_vacina',
        titulo: 'Registo (chip, SIAC) e vacina contra a raiva',
        quando:
          'Quando pergunta como registar o animal, pôr o chip, mudar o dono ou a vacina antirrábica.',
        entrada: entradaRegisto,
        executar: () => this.animais.registo(),
      }),
    );
  }
}
