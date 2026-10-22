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
  entradaAtividades,
  entradaInscreverAtividade,
  entradaInscreverCantina,
  entradaMarcarRefeicao,
  entradaPedirTransporte,
  entradaPreInscricao,
  entradaSituacaoAluno,
  esquemaDecidirTransporte,
  EscolasService,
} from './escolas.service.js';
import { agoraLisboa } from './regras.js';

/** Painel · Escolas: alunos e inscrições, transporte escolar, refeições do dia. */
@Controller('painel/escolas')
@Painel('escolas')
export class EscolasPainelController {
  constructor(private readonly escolas: EscolasService) {}

  @Get()
  ver(@MunicipioAtual() m: Municipio) {
    return this.escolas.painel(m);
  }

  /** ?escola_id= */
  @Get('alunos')
  alunos(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { escola_id } = validar(
      z.object({ escola_id: z.uuid().optional() }),
      query,
    );
    return this.escolas.alunos(m, escola_id);
  }

  /** ?estado=pendente|aprovado|recusado */
  @Get('transporte')
  transporte(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { estado } = validar(
      z.object({
        estado: z.enum(['pendente', 'aprovado', 'recusado']).optional(),
      }),
      query,
    );
    return this.escolas.transporte(m, estado);
  }

  /** { decisao: 'aprovar'|'recusar', motivo? }: avisa o encarregado por SMS. */
  @Post('transporte/:id/decidir')
  @HttpCode(200)
  decidir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.escolas.decidirTransporte(
      m,
      u,
      id,
      validar(esquemaDecidirTransporte, body),
    );
  }

  /** ?dia=AAAA-MM-DD (hoje por omissão): contagem por escola para a cozinha. */
  @Get('refeicoes')
  refeicoes(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { dia } = validar(z.object({ dia: z.iso.date().optional() }), query);
    return this.escolas.refeicoesDoDia(m, dia ?? agoraLisboa().dia);
  }

  /** Escolas e atividades de demonstração (só o que ainda não existe). */
  @Post('demonstracao')
  @HttpCode(201)
  demonstracao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
  ) {
    return this.escolas.carregarDemonstracao(m, u);
  }
}

@Module({
  controllers: [EscolasPainelController],
  providers: [EscolasService],
  exports: [EscolasService],
})
export class EscolasModule implements OnModuleInit {
  constructor(
    private readonly servicos: RegistoServicos,
    private readonly escolas: EscolasService,
  ) {}

  onModuleInit() {
    const area = 'escolas' as const;
    this.servicos.registar(
      servico({
        area,
        acao: 'inscrever_cantina',
        titulo: 'Inscrever na cantina',
        quando:
          'Quando quer que o filho almoce na escola (pré-escolar ou 1.º ciclo).',
        entrada: entradaInscreverCantina,
        altera: true,
        executar: (ctx, e) => this.escolas.inscreverCantina(ctx, e),
      }),
      servico({
        area,
        acao: 'marcar_refeicao',
        titulo: 'Marcar ou desmarcar uma refeição',
        quando: 'Quando o aluno não vai almoçar num dia (ou afinal vai).',
        entrada: entradaMarcarRefeicao,
        altera: true,
        executar: (ctx, e) => this.escolas.marcarRefeicao(ctx, e),
      }),
      servico({
        area,
        acao: 'situacao_aluno',
        titulo: 'Conta das refeições e pedidos do aluno',
        quando:
          'Quando pergunta quanto paga de refeições, o saldo, o escalão ou como está um pedido (transporte, atividades, pré-escolar).',
        entrada: entradaSituacaoAluno,
        executar: (ctx, e) => this.escolas.situacaoAluno(ctx, e),
      }),
      servico({
        area,
        acao: 'pedir_transporte',
        titulo: 'Pedir transporte escolar',
        quando: 'Quando o aluno mora longe da escola e precisa de transporte.',
        entrada: entradaPedirTransporte,
        altera: true,
        executar: (ctx, e) => this.escolas.pedirTransporte(ctx, e),
      }),
      servico({
        area,
        acao: 'atividades',
        titulo: 'Atividades e férias desportivas',
        quando:
          'Quando pergunta que atividades depois das aulas (AEC) ou férias desportivas há.',
        entrada: entradaAtividades,
        executar: (ctx, e) => this.escolas.atividades(ctx, e),
      }),
      servico({
        area,
        acao: 'inscrever_atividade',
        titulo: 'Inscrever numa atividade',
        quando:
          'Quando quer inscrever o aluno numa atividade ou nas férias desportivas.',
        entrada: entradaInscreverAtividade,
        altera: true,
        executar: (ctx, e) => this.escolas.inscreverAtividade(ctx, e),
      }),
      servico({
        area,
        acao: 'pre_inscricao',
        titulo: 'Pré-inscrição no pré-escolar',
        quando:
          'Quando quer um lugar no jardim de infância (a colocação é decidida pelo agrupamento).',
        entrada: entradaPreInscricao,
        altera: true,
        executar: (ctx, e) => this.escolas.preInscricao(ctx, e),
      }),
    );
  }
}
