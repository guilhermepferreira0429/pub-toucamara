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
          'Diz a que apoios da câmara a pessoa pode ter direito (apoio à renda, tarifa social da água, cheque bebé, cartão do idoso, material escolar…). ' +
          'Usa quando a pessoa pergunta por apoios ou conta uma dificuldade (renda, contas, filhos, idade). ' +
          'Chama logo com o que já sabes; se vier perguntar_a_seguir, faz essas perguntas (uma ou duas de cada vez) e chama outra vez com TUDO o que já sabes, incluindo o rendimento (não fica guardado). ' +
          'Pergunta também se aceita que a câmara lhe volte a ligar sobre estes apoios (aceita_contacto). ' +
          'Diz o "dizer". No fim, a lista com os documentos segue por SMS. Se a pessoa quiser pedir um apoio, usa pedir_apoio. ' +
          'É uma indicação: a decisão é da câmara, com os documentos.',
        entrada: entradaQueApoiosTenho,
        executar: (ctx, e) => this.apoios.queApoiosTenho(ctx, e),
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'pedir_apoio',
        descricao:
          'Faz o pedido de um apoio da câmara (depois de que_apoios_tenho, ou numa chamada da câmara sobre um apoio). Confirma antes com a pessoa. ' +
          'Cria um processo para a ação social, com os documentos a entregar, e manda SMS com o número e o link. Diz o "dizer". ' +
          'Se vier precisa_identificacao, segue a instrução.',
        entrada: entradaPedirApoio,
        executar: (ctx, e) => this.apoios.pedirApoio(ctx, e),
      }),
    );
  }
}
