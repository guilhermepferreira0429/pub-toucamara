import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Coluna, ficheiroCsv, gerarCsv, nomeCsv } from '../../common/csv.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  esquemaAnexo,
  esquemaAtribuir,
  esquemaConverterEmail,
  esquemaEncerrar,
  esquemaFiltro,
  esquemaNova,
  esquemaRascunho,
  esquemaResponder,
  ReclamacoesService,
} from './reclamacoes.service.js';
import { esquemaConfig, NOMES_ESTADO, SituacaoPrazo } from './regras.js';

type ReclamacaoLista = Awaited<
  ReturnType<ReclamacoesService['exportar']>
>[number];

const PRAZOS: Record<SituacaoPrazo, string> = {
  no_prazo: 'No prazo',
  a_terminar: 'A terminar',
  termina_hoje: 'Termina hoje',
  em_atraso: 'Em atraso',
  respondida_no_prazo: 'Respondida no prazo',
  respondida_fora_do_prazo: 'Respondida fora do prazo',
};

/**
 * Sem nome, telefone, email nem o texto da reclamação (dados pessoais que a
 * folha de cálculo não precisa): o número abre o detalhe no painel.
 */
const COLUNAS_CSV: Coluna<ReclamacaoLista>[] = [
  { titulo: 'Número', valor: (r) => r.numero },
  { titulo: 'Recebida em', valor: (r) => r.recebida_em },
  { titulo: 'Canal', valor: (r) => r.canal_nome },
  { titulo: 'Estado', valor: (r) => NOMES_ESTADO[r.estado] ?? r.estado },
  { titulo: 'Serviço visado', valor: (r) => r.servico_visado },
  { titulo: 'Serviço', valor: (r) => r.servico },
  { titulo: 'Atribuída a', valor: (r) => r.atribuida_a_nome },
  { titulo: 'Responder até', valor: (r) => r.responder_ate },
  { titulo: 'Prazo', valor: (r) => PRAZOS[r.prazo.situacao] },
  {
    titulo: 'Dias úteis restantes',
    valor: (r) => r.prazo.dias_uteis_restantes,
  },
  {
    titulo: 'Respondida em',
    valor: (r) => (r.respondida_em ? new Date(r.respondida_em) : null),
  },
  {
    titulo: 'Encerrada em',
    valor: (r) => (r.encerrada_em ? new Date(r.encerrada_em) : null),
  },
];

/** Painel · Livro de reclamações. */
@Controller('painel/reclamacoes')
@Painel('reclamacoes')
export class ReclamacoesPainelController {
  constructor(private readonly reclamacoes: ReclamacoesService) {}

  /** ?estado=recebida|em_analise|respondida|encerrada|abertas&servico_id= */
  @Get()
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.reclamacoes.listar(m, validar(esquemaFiltro, query));
  }

  /** A lista com os mesmos filtros, em CSV para o Excel. */
  @Get('exportar.csv')
  async exportar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const linhas = await this.reclamacoes.exportar(
      m,
      validar(esquemaFiltro, query),
    );
    return ficheiroCsv(
      gerarCsv(COLUNAS_CSV, linhas, m.fuso),
      nomeCsv('reclamacoes', new Date(), m.fuso),
    );
  }

  /** Registo à mão: balcão, Livro Amarelo em papel, telefone, email. */
  @Post()
  criar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.criarNoPainel(m, u, validar(esquemaNova, body));
  }

  /** Serviços e funcionários para atribuir. */
  @Get('opcoes')
  opcoes(@MunicipioAtual() m: Municipio) {
    return this.reclamacoes.opcoes(m);
  }

  @Get('config')
  config(@MunicipioAtual() m: Municipio) {
    return this.reclamacoes.configDe(m.id).then((config) => ({ config }));
  }

  /** O prazo legal e os avisos (só a chefia). */
  @Put('config')
  @Painel('agente')
  guardarConfig(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.guardarConfig(m, u, validar(esquemaConfig, body));
  }

  /** Emails da triagem que parecem reclamações (ainda não registadas). */
  @Get('emails')
  emails(@MunicipioAtual() m: Municipio) {
    return this.reclamacoes.emailsCandidatos(m);
  }

  @Post('emails/:emailId')
  converterEmail(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('emailId', ParseUUIDPipe) emailId: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.converterEmail(
      m,
      u,
      emailId,
      validar(esquemaConverterEmail, body ?? {}),
    );
  }

  @Get(':id')
  detalhe(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.reclamacoes.detalhe(m, id);
  }

  /** { servico_id?, utilizador_id? } */
  @Post(':id/atribuir')
  @HttpCode(200)
  atribuir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.atribuir(m, u, id, validar(esquemaAtribuir, body));
  }

  /** Rascunho da resposta (IA com as notas, ou o modelo fixo). */
  @Post(':id/rascunho')
  @HttpCode(200)
  rascunho(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.rascunho(
      m,
      id,
      validar(esquemaRascunho, body ?? {}),
    );
  }

  /** { texto }: vai por SMS (link) ou email e fica na página pública. */
  @Post(':id/responder')
  @HttpCode(200)
  responder(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.responder(
      m,
      u,
      id,
      validar(esquemaResponder, body),
    );
  }

  /** { nota? } (obrigatória se ainda não houver resposta). */
  @Post(':id/encerrar')
  @HttpCode(200)
  encerrar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.encerrar(
      m,
      u,
      id,
      validar(esquemaEncerrar, body ?? {}),
    );
  }

  /** { nome, mime } → URL assinada para enviar o ficheiro (PUT). */
  @Post(':id/anexos')
  anexo(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.reclamacoes.pedirEnvioAnexo(
      m,
      u,
      id,
      validar(esquemaAnexo, body),
    );
  }
}

/** A página do link do SMS: estado, prazo e resposta. */
@Controller('public/reclamacoes')
export class ReclamacoesPublicoController {
  constructor(private readonly reclamacoes: ReclamacoesService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.reclamacoes.publico(codigo);
  }
}
