import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Module,
  OnModuleInit,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { PagamentosModule } from '../pagamentos/pagamentos.module.js';
import { esquemaRequisito } from './balcao-empresas.regras.js';
import {
  EmpresasService,
  entradaObrigacoes,
  entradaOQueAEmpresaPrecisa,
  esquemaObrigacoesPainel,
  esquemaPerfilPublico,
} from './empresas.service.js';

/**
 * Painel · Balcão para empresas: o catálogo do que cada atividade precisa
 * (a câmara afina-o), testar com um perfil e o calendário de obrigações de
 * uma empresa pelo NIF. Ver é de quem trata os processos e as licenças;
 * mudar o catálogo é de quem gere o agente (como as regras das licenças).
 */
@Controller('painel/empresas')
@Painel('processos')
export class EmpresasPainelController {
  constructor(private readonly empresas: EmpresasService) {}

  @Get('catalogo')
  catalogo(@MunicipioAtual() m: Municipio) {
    return this.empresas.painel(m);
  }

  /** Altera um requisito do catálogo, ou acrescenta um novo (chave nova). */
  @Put('catalogo/:chave')
  @Painel('agente')
  gravar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('chave') chave: string,
    @Body() body: unknown,
  ) {
    return this.empresas.gravarRequisito(
      m,
      u,
      chave,
      validar(esquemaRequisito, body),
    );
  }

  /** Repõe o requisito do código (ou apaga um requisito acrescentado). */
  @Delete('catalogo/:chave')
  @Painel('agente')
  repor(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('chave') chave: string,
  ) {
    return this.empresas.reporRequisito(m, u, chave);
  }

  /** { perfil } → a lista e o calendário, sem guardar. */
  @Post('pre-visualizar')
  @HttpCode(200)
  preVisualizar(@MunicipioAtual() m: Municipio, @Body() body: unknown) {
    return this.empresas.preVisualizar(m, validar(esquemaPerfilPublico, body));
  }

  /** ?nif= ou ?municipe_id= → licenças e calendário de obrigações. */
  @Get('obrigacoes')
  obrigacoes(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.empresas.obrigacoesPainel(
      m,
      u,
      validar(esquemaObrigacoesPainel, query),
    );
  }
}

/**
 * Público (sem login): a página /empresas faz as perguntas e pede a lista;
 * a lista fica num link partilhável (/empresas/{codigo}) com o calendário
 * em .ics. Não se guardam dados pessoais: só o perfil da atividade.
 */
@Controller('public/empresas')
export class EmpresasPublicoController {
  constructor(private readonly empresas: EmpresasService) {}

  @Get('listas/:codigo')
  ver(@Param('codigo') codigo: string) {
    return this.empresas.publico(codigo);
  }

  @Get('listas/:codigo/calendario.ics')
  @Header('Cache-Control', 'no-store')
  async ics(@Param('codigo') codigo: string) {
    const { nome, ics } = await this.empresas.ics(codigo);
    const corpo = Buffer.from(ics, 'utf8');
    return new StreamableFile(corpo, {
      type: 'text/calendar; charset=utf-8',
      disposition: `attachment; filename="${nome}"`,
      length: corpo.length,
    });
  }

  @Get(':municipio/perguntas')
  perguntas(@Param('municipio') municipio: string) {
    return this.empresas.perguntas(municipio);
  }

  /** O perfil da empresa → a lista do que precisa e o calendário. */
  @Post(':municipio/lista')
  @HttpCode(201)
  lista(@Param('municipio') municipio: string, @Body() body: unknown) {
    return this.empresas.listaPublica(
      municipio,
      validar(esquemaPerfilPublico, body),
    );
  }
}

@Module({
  imports: [PagamentosModule],
  controllers: [EmpresasPainelController, EmpresasPublicoController],
  providers: [EmpresasService],
})
export class EmpresasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly empresas: EmpresasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'o_que_a_empresa_precisa',
        descricao:
          'Quando vai abrir ou mudar um negócio, ou pergunta que licenças precisa: o que a empresa precisa e onde se trata. Chama logo com o que sabes e depois só com as respostas novas. ' +
          'A lista completa segue por SMS. Para tratar já de um item, a ferramenta em pedir_com; para obras, o_que_posso_fazer.',
        entrada: entradaOQueAEmpresaPrecisa,
        executar: (ctx, e) => this.empresas.oQueAEmpresaPrecisa(ctx, e),
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'obrigacoes_da_empresa',
        descricao:
          'Quando a empresa pergunta que prazos tem ou quando renovar: as renovações e taxas das licenças que já tem (e o calendário por SMS). Para renovar: renovar_licenca.',
        entrada: entradaObrigacoes,
        executar: (ctx) => this.empresas.obrigacoesDaEmpresa(ctx),
      }),
    );
  }
}
