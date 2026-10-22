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
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { Painel } from '../auth/painel.guard.js';
import { CampanhasModule } from '../campanhas/campanhas.module.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  ApoiosService,
  entradaPedirApoio,
  entradaQueApoiosTenho,
  esquemaApoioEditar,
  esquemaApoioPainel,
  esquemaCampanhaApoio,
  esquemaPedirPublico,
} from './apoios.service.js';

/**
 * Painel · Apoios ("a câmara que liga primeiro"): o catálogo, as consultas
 * (quem tinha direito e não pediu) e "ligar a quem pode ter direito".
 * Ver é da ação social; mudar os critérios é de quem gere o agente.
 */
@Controller('painel/apoios')
@Painel('acao_social')
export class ApoiosPainelController {
  constructor(private readonly apoios: ApoiosService) {}

  @Get()
  ver(@MunicipioAtual() m: Municipio) {
    return this.apoios.painel(m);
  }

  @Post()
  @HttpCode(201)
  @Painel('agente')
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.apoios.criar(m, u, validar(esquemaApoioPainel, body));
  }

  @Post('demonstracao')
  @HttpCode(201)
  @Painel('agente')
  demonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.apoios.carregarDemonstracao(m, u);
  }

  @Put(':id')
  @Painel('agente')
  editar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.apoios.editar(m, u, id, validar(esquemaApoioEditar, body));
  }

  /** { origem } → quantas pessoas e os textos propostos. */
  @Post(':id/pre-visualizar-campanha')
  @HttpCode(200)
  preVisualizar(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    const { origem } = validar(
      z.object({ origem: z.enum(['consultas', 'contactos_cuidado']) }),
      body,
    );
    return this.apoios.preVisualizarCampanha(m, id, origem);
  }

  /** "Ligar a quem pode ter direito": lança a campanha. */
  @Post(':id/campanha')
  @HttpCode(201)
  campanha(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.apoios.lancarCampanha(
      m,
      u,
      id,
      validar(esquemaCampanhaApoio, body),
    );
  }
}

/** A página do link do SMS: a lista dos apoios e o que entregar; pedir. */
@Controller('public/apoios')
export class ApoiosPublicoController {
  constructor(private readonly apoios: ApoiosService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.apoios.publico(codigo);
  }

  /** { apoio } → cria o pedido e devolve a página atualizada. */
  @Post(':codigo/pedir')
  @HttpCode(200)
  pedir(@Param('codigo') codigo: string, @Body() body: unknown) {
    const { apoio } = validar(esquemaPedirPublico, body);
    return this.apoios.pedirPublico(codigo, apoio);
  }
}

@Module({
  imports: [CampanhasModule],
  controllers: [ApoiosPainelController, ApoiosPublicoController],
  providers: [ApoiosService],
})
export class ApoiosModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly apoios: ApoiosService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'que_apoios_tenho',
        descricao:
          'Quando pergunta por apoios ou conta uma dificuldade (renda, contas, filhos, idade): a que apoios da câmara pode ter direito. ' +
          'Chama logo com o que sabes e depois sempre com TUDO o que já sabes (o rendimento não fica guardado). Pergunta se aceita que a câmara lhe volte a ligar (aceita_contacto). ' +
          'É uma indicação: decide a câmara, com os documentos; a lista segue por SMS.',
        entrada: entradaQueApoiosTenho,
        executar: (ctx, e) => this.apoios.queApoiosTenho(ctx, e),
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'pedir_apoio',
        descricao:
          'Depois de que_apoios_tenho (ou numa chamada nossa sobre um apoio), quando quer pedir: cria o processo na ação social, com os documentos a entregar, e manda SMS.',
        // Também nas campanhas dos apoios (a câmara liga a quem tem direito).
        agentes: ['entrada', 'saida', 'chat'],
        entrada: entradaPedirApoio,
        executar: (ctx, e) => this.apoios.pedirApoio(ctx, e),
      }),
    );
  }
}
