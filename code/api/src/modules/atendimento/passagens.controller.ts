import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  ApoioPassagemService,
  esquemaEnsinar,
} from './apoio-passagem.service.js';
import { EstadoPassagem, PassagensService } from './passagens.service.js';

const filtros = esquemaPaginacao.extend({
  // 'pendentes' = aberta + em_curso (a fila de trabalho).
  estado: z
    .enum(['aberta', 'em_curso', 'respondida', 'fechada', 'pendentes'])
    .optional(),
  // 'eu', 'ninguem' (por pegar) ou o id de um colega.
  atribuida_a: z.union([z.enum(['eu', 'ninguem']), z.uuid()]).optional(),
});

/** "Passagens a funcionário": a fila do atendimento no painel. */
@Controller('painel/passagens')
@Painel('conversas')
export class PassagensController {
  constructor(
    private readonly passagens: PassagensService,
    private readonly apoio: ApoioPassagemService,
  ) {}

  @Get()
  listar(
    @MunicipioAtual() municipio: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    const f = validar(filtros, query);
    const estados: EstadoPassagem[] | null =
      f.estado === 'pendentes'
        ? ['aberta', 'em_curso']
        : f.estado
          ? [f.estado]
          : null;
    return this.passagens.listar(municipio.id, {
      estados,
      atribuidaA:
        f.atribuida_a === 'eu'
          ? u.id
          : f.atribuida_a === 'ninguem'
            ? null
            : (f.atribuida_a ?? null),
      semAtribuicao: f.atribuida_a === 'ninguem',
      limite: f.limite,
      cursor: f.cursor,
    });
  }

  @Get(':id')
  obter(
    @MunicipioAtual() municipio: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.passagens.obter(municipio.id, id);
  }

  /** Sem corpo (ou sem `utilizador_id`): fica para quem pede. */
  @Post(':id/atribuir')
  @HttpCode(200)
  atribuir(
    @MunicipioAtual() municipio: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const { utilizador_id } = validar(
      z.object({ utilizador_id: z.uuid().optional() }),
      body ?? {},
    );
    return this.passagens.atribuir(municipio, u, id, utilizador_id, ip);
  }

  @Post(':id/responder')
  @HttpCode(200)
  responder(
    @MunicipioAtual() municipio: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const dados = validar(
      z.object({
        texto: z.string().trim().min(2).max(2000),
        canal: z.enum(['sms', 'email']),
      }),
      body,
    );
    return this.passagens.responder(municipio, u, id, dados, ip);
  }

  @Post(':id/fechar')
  @HttpCode(200)
  fechar(
    @MunicipioAtual() municipio: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
  ) {
    return this.passagens.fechar(municipio, u, id, ip);
  }

  /** Ajuda ao funcionário: regras que se aplicam, a ficha da pessoa e uma resposta sugerida. */
  @Post(':id/sugestao')
  @HttpCode(200)
  sugestao(
    @MunicipioAtual() municipio: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.apoio.sugestao(municipio, id);
  }

  /** { pergunta, resposta }: fica proposta como conhecimento novo, para aprovar. */
  @Post(':id/ensinar')
  @HttpCode(201)
  ensinar(
    @MunicipioAtual() municipio: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.apoio.ensinar(municipio, u, id, validar(esquemaEnsinar, body));
  }
}
