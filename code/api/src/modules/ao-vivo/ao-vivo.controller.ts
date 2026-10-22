import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual, UtilizadorAtual } from '../../common/pedido.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { AcompanhamentoFamiliarService } from './acompanhamento.service.js';
import {
  AoVivoService,
  esquemaItens,
  esquemaMensagem,
  esquemaNovaSessao,
} from './ao-vivo.service.js';
import { SimulacaoAoVivoService } from './simulacao.service.js';

const esquemaToken = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const esquemaDesde = z.object({
  desde: z.coerce.number().int().min(0).optional(),
});

/** "Authorization: Bearer <token>" → token (ou null). */
function bearer(h: string | undefined): string | null {
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,64})$/.exec(h?.trim() ?? '');
  return m ? m[1] : null;
}

/**
 * A página /ligar durante a chamada web: abre a sessão (onConnect, com o
 * conversation_id do ElevenLabs), escreve as falas e as ferramentas e ouve
 * o que o funcionário e o familiar escrevem (para injetar no agente). Tudo
 * menos a criação exige `Authorization: Bearer <token da sessão>`.
 */
@Controller('public/chamadas-ao-vivo')
export class ChamadasAoVivoPublicoController {
  constructor(private readonly aoVivo: AoVivoService) {}

  @Post()
  criar(@Body() body: unknown, @Ip() ip: string) {
    return this.aoVivo.criarSessao(validar(esquemaNovaSessao, body), ip);
  }

  @Post(':id/falas')
  @HttpCode(200)
  falas(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') auth: string | undefined,
    @Body() body: unknown,
  ) {
    return this.aoVivo.escrever(id, bearer(auth), validar(esquemaItens, body));
  }

  @Sse(':id/instrucoes')
  instrucoes(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') auth: string | undefined,
    @Query() q: unknown,
  ) {
    return this.aoVivo.instrucoes(
      id,
      bearer(auth),
      validar(esquemaDesde, q).desde ?? null,
    );
  }

  @Post(':id/retirar-familiar')
  @HttpCode(200)
  retirar(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') auth: string | undefined,
  ) {
    return this.aoVivo.retirarFamiliar(id, bearer(auth));
  }

  @Post(':id/terminar')
  @HttpCode(200)
  terminar(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('authorization') auth: string | undefined,
  ) {
    return this.aoVivo.terminar(id, bearer(auth));
  }
}

/**
 * Página do familiar (link do SMS, /acompanhar/[token]): a transcrição em
 * direto e um campo para escrever ao agente.
 */
@Controller('public/acompanhar')
export class AcompanharPublicoController {
  constructor(private readonly acompanhamento: AcompanhamentoFamiliarService) {}

  @Get(':token')
  ver(@Param('token') token: string) {
    return this.acompanhamento.publico(validar(esquemaToken, token));
  }

  @Sse(':token/eventos')
  eventos(@Param('token') token: string, @Query() q: unknown) {
    return this.acompanhamento.eventos(
      validar(esquemaToken, token),
      validar(esquemaDesde, q).desde ?? 0,
    );
  }

  @Post(':token/mensagens')
  @HttpCode(201)
  escrever(@Param('token') token: string, @Body() body: unknown) {
    return this.acompanhamento.escrever(
      validar(esquemaToken, token),
      validar(esquemaMensagem, body).texto,
    );
  }
}

/**
 * Slide "Ao vivo" do pitch: eventos anonimizados, só de leitura. O
 * EventSource do browser não manda headers: o token da demo vai na query.
 */
@Controller('public/ao-vivo')
export class AoVivoPublicoController {
  constructor(private readonly aoVivo: AoVivoService) {}

  @Sse(':municipio')
  eventos(
    @Param('municipio') municipio: string,
    @Query('token') token: string | undefined,
  ) {
    return this.aoVivo.eventosPublicos(
      validar(z.string().trim().min(1).max(60), municipio),
      token,
    );
  }
}

/** Painel "Chamadas a decorrer": acompanhar, sugestões e assumir a conversa. */
@Controller('painel/ao-vivo')
@Painel('conversas')
export class AoVivoPainelController {
  constructor(
    private readonly aoVivo: AoVivoService,
    private readonly simulacao: SimulacaoAoVivoService,
  ) {}

  @Get()
  async listar(@MunicipioAtual() m: Municipio) {
    return {
      ...(await this.aoVivo.listar(m)),
      simulacao_disponivel: this.simulacao.permitida,
    };
  }

  @Get('conversas/:id')
  async ver(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const d = await this.aoVivo.detalhe(m, id);
    return {
      ...d,
      // Só nas chamadas simuladas (desenvolvimento): o link do familiar.
      link_simulacao: d.conversa.simulada ? this.simulacao.linkDe(id) : null,
    };
  }

  @Sse('conversas/:id/eventos')
  eventos(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: unknown,
  ) {
    return this.aoVivo.eventosPainel(
      m,
      id,
      validar(esquemaDesde, q).desde ?? 0,
    );
  }

  @Post('conversas/:id/sugestao')
  @HttpCode(200)
  sugestao(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.aoVivo.sugestao(m, u, id);
  }

  @Post('conversas/:id/assumir')
  @HttpCode(201)
  assumir(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.aoVivo.assumir(m, u, id, validar(esquemaMensagem, body).texto);
  }

  /** Só fora de produção: uma chamada a fingir, para ver tudo sem ElevenLabs. */
  @Post('simular')
  simular(
    @MunicipioAtual() m: Municipio,
    @UtilizadorAtual() u: UtilizadorPainel,
    @Body() body: unknown,
  ) {
    const { rapido } = validar(
      z.object({ rapido: z.boolean().optional() }),
      body ?? {},
    );
    return this.simulacao.iniciar(m, u, rapido === true);
  }

  @Post('conversas/:id/terminar-simulacao')
  @HttpCode(200)
  terminarSimulacao(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.simulacao.terminar(m, id);
  }
}
