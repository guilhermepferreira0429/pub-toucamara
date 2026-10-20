import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErroApi } from '../../common/erros.js';
import {
  MunicipioAtual,
  UtilizadorAtual,
  type UtilizadorPainel,
} from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import type { EventoPergunta } from './loop.js';
import {
  erroIa,
  esquemaPergunta,
  PerguntasChefiaService,
} from './perguntas-chefia.service.js';
import { SUGESTOES } from './prompt.js';
import { publica } from './resposta.js';

/**
 * "Perguntar" no painel: perguntas da chefia em linguagem normal, com a
 * resposta, os números, a tabela e como foi calculado. Mesma permissão dos
 * Indicadores (chefe de divisão, vereador, técnico; admin e equipa).
 */
@Controller('painel/perguntar')
@Painel('indicadores')
export class PerguntasChefiaController {
  constructor(private readonly perguntas: PerguntasChefiaService) {}

  @Post()
  @HttpCode(200)
  perguntar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const { pergunta } = validar(esquemaPergunta, body);
    this.perguntas.preparar(u);
    return this.perguntas.perguntar(m, u, pergunta, { ip });
  }

  /**
   * A mesma pergunta em SSE, para a demonstração ficar viva: `consulta`
   * (estado 'a_correr' e depois 'feita', uma por consulta), `texto` (a
   * resposta), `fim` (a resposta inteira, igual ao POST) ou `erro`. Erros
   * antes de começar (IA desligada, limite, pergunta inválida) saem em JSON.
   */
  @Post('stream')
  async stream(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
    @Ip() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pergunta } = validar(esquemaPergunta, body);
    this.perguntas.preparar(u);
    const sse = abrirSse(res);
    try {
      const r = await this.perguntas.perguntar(m, u, pergunta, {
        ip,
        sinal: sse.sinal,
        emitir: (e) => sse.enviar('consulta', eventoConsulta(e)),
      });
      sse.enviar('texto', { texto: r.resposta });
      sse.enviar('fim', r);
    } catch (e) {
      const erro = e instanceof ErroApi ? e : erroIa(e);
      sse.enviar('erro', { codigo: erro.codigo, mensagem: erro.message });
    } finally {
      sse.fechar();
    }
  }

  /** As perguntas do próprio utilizador, mais recentes primeiro. */
  @Get('historico')
  historico(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Query() query: unknown,
  ) {
    return this.perguntas.historico(m, u, query);
  }

  /** Perguntas exemplo para mostrar por baixo da caixa. */
  @Get('sugestoes')
  sugestoes() {
    return { sugestoes: SUGESTOES };
  }
}

function eventoConsulta(e: EventoPergunta) {
  if (e.tipo === 'consulta_inicio') {
    return {
      estado: 'a_correr',
      id: e.id,
      ferramenta: e.ferramenta,
      parametros: e.parametros,
    };
  }
  return { estado: 'feita', ...publica(e.consulta), ms: e.consulta.ms };
}

type EventoSse = 'consulta' | 'texto' | 'fim' | 'erro';

/**
 * Resposta em text/event-stream (o `@Sse` do Nest só serve para GET), como o
 * do chat: cada evento sai logo; um comentário a cada 15 s mantém a ligação.
 */
function abrirSse(res: Response) {
  const controlo = new AbortController();
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const escrever = (s: string) => {
    if (!res.writableEnded && !res.destroyed) res.write(s);
  };
  const vivo = setInterval(() => escrever(': vivo\n\n'), 15_000);
  res.on('close', () => {
    clearInterval(vivo);
    if (!res.writableEnded) controlo.abort();
  });

  return {
    sinal: controlo.signal,
    enviar: (evento: EventoSse, dados: unknown) =>
      escrever(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`),
    fechar: () => {
      clearInterval(vivo);
      if (!res.writableEnded) res.end();
    },
  };
}
