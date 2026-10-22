import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { lerMensagem, RespostaJsonRpc } from './mcp.js';
import { McpService } from './mcp.service.js';
import {
  esquemaChave,
  esquemaConfirmar,
  esquemaPedirCodigo,
  PortaIasService,
} from './porta-ias.service.js';

const MAX_LOTE = 20;

/**
 * O servidor MCP (transporte Streamable HTTP, respostas em JSON).
 * - `/v1/mcp/{municipio}`: público, só informação
 * - `/v1/mcp/{municipio}/{chave}`: a ligação pessoal autorizada por SMS
 */
@Controller('mcp')
export class McpController {
  constructor(
    private readonly mcp: McpService,
    private readonly porta: PortaIasService,
    private readonly municipios: MunicipiosService,
  ) {}

  @Post(':municipio')
  publico(
    @Param('municipio') slug: string,
    @Headers('mcp-session-id') sessao: string | undefined,
    @Ip() ip: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    return this.atender(slug, null, sessao, ip, body, res);
  }

  @Post(':municipio/:chave')
  pessoal(
    @Param('municipio') slug: string,
    @Param('chave') chave: string,
    @Headers('mcp-session-id') sessao: string | undefined,
    @Ip() ip: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    return this.atender(slug, chave, sessao, ip, body, res);
  }

  /** Sem stream do servidor para o cliente (o spec deixa responder 405). */
  @Get([':municipio', ':municipio/:chave'])
  semStream(@Res() res: Response) {
    res.setHeader('Allow', 'POST, DELETE');
    res.status(405).json({
      erro: {
        codigo: 'metodo_nao_suportado',
        mensagem: 'Use POST (MCP Streamable HTTP).',
      },
    });
  }

  /** O cliente termina a sessão: não há nada guardado para apagar. */
  @Delete([':municipio', ':municipio/:chave'])
  @HttpCode(204)
  terminar() {}

  private async atender(
    slug: string,
    chave: string | null,
    sessao: string | undefined,
    ip: string,
    body: unknown,
    res: Response,
  ): Promise<void> {
    const municipio = await this.municipios.porSlug(slug);
    const ligacao = chave ? await this.porta.porChave(chave) : null;
    if (chave && (!ligacao || ligacao.municipioId !== municipio.id)) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'ligacao_desconhecida',
        'Esta ligação não existe ou foi desligada. Volte a ligar o assistente no site da câmara.',
      );
    }
    const origem = { municipio, ligacao, sessao: sessao ?? null, ip };
    const lote = Array.isArray(body);
    const mensagens = lote ? body : [body];
    if (mensagens.length === 0 || mensagens.length > MAX_LOTE) {
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Lote vazio ou demasiado grande.' },
      });
      return;
    }

    const respostas: RespostaJsonRpc[] = [];
    for (const bruta of mensagens) {
      const lida = lerMensagem(bruta);
      if (!lida.ok) {
        respostas.push(lida.resposta);
        continue;
      }
      const r = await this.mcp.processar(origem, lida.mensagem);
      if (r.sessaoNova) res.setHeader('Mcp-Session-Id', r.sessaoNova);
      if (r.resposta) respostas.push(r.resposta);
    }
    if (respostas.length === 0) {
      res.status(202).end();
      return;
    }
    res.status(200).json(lote ? respostas : respostas[0]);
  }
}

/** A página /ia do munícipe: autorizar e desligar o assistente. */
@Controller('public/ias')
export class PortaIasPublicoController {
  constructor(private readonly porta: PortaIasService) {}

  /** { municipio, telefone, assistente } → SMS com código */
  @Post('pedir-codigo')
  @HttpCode(202)
  pedirCodigo(@Body() body: unknown, @Ip() ip: string) {
    return this.porta.pedirCodigo(validar(esquemaPedirCodigo, body), ip);
  }

  /** { pedido, codigo } → a chave (só esta vez) */
  @Post('confirmar')
  @HttpCode(201)
  confirmar(@Body() body: unknown) {
    return this.porta.confirmar(validar(esquemaConfirmar, body));
  }

  /** { chave } */
  @Post('desligar')
  @HttpCode(200)
  desligar(@Body() body: unknown) {
    return this.porta.desligarPelaChave(validar(esquemaChave, body).chave);
  }
}

/** Painel · Porta para as IAs. */
@Controller('painel/ias')
@Painel('conversas')
export class PortaIasPainelController {
  constructor(private readonly porta: PortaIasService) {}

  @Get('resumo')
  resumo(@MunicipioAtual() m: Municipio) {
    return this.porta.resumo(m);
  }

  /** ?desde= (ISO): só os mais recentes, para o feed ao vivo. */
  @Get('atividade')
  atividade(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    const { desde } = validar(
      z.object({ desde: z.iso.datetime({ offset: true }).optional() }),
      query,
    );
    return this.porta.atividade(m, desde);
  }

  @Get('ligacoes')
  ligacoes(@MunicipioAtual() m: Municipio) {
    return this.porta.ligacoes(m);
  }

  @Post('ligacoes/:id/revogar')
  @HttpCode(200)
  @Painel('agente')
  revogar(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.porta.revogarPelaCamara(m, u.id, id);
  }
}
