import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { IdempotenciaInterceptor } from '../../common/idempotencia.interceptor.js';
import { MunicipioAtual } from '../../common/pedido.js';
import { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { telefoneComAlternativa } from '../municipes/municipes.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipioGuard, SegredoAgenteGuard } from './agente.guard.js';

/**
 * Ferramentas que o agente de voz chama durante a chamada: uma rota por
 * ferramenta, `POST /v1/agent/tools/{nome}` com a entrada no corpo.
 * Orçamento: p95 < 400 ms; o que é lento vai para jobs.
 *
 * Headers que o ElevenLabs manda (variáveis dinâmicas do sistema):
 * - `X-Conversa-Id`: {{system__conversation_id}} → liga tudo à conversa
 * - `X-Telefone`: {{system__caller_id}} → munícipe pelo número
 * - `X-Telefone-Web`: {{telefone}} → o número que a página `/ligar` manda
 *   (numa chamada pelo browser não há caller_id); usado quando o
 *   `X-Telefone` vem vazio ou inválido
 */
@Controller('agent/tools')
@UseGuards(SegredoAgenteGuard)
export class AgentToolsController {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly conversas: ConversasService,
  ) {}

  /** O catálogo, para configurar as ferramentas no ElevenLabs. */
  @Get()
  catalogo() {
    return { ferramentas: this.registo.catalogo() };
  }

  @Post(':nome')
  @HttpCode(200)
  @UseGuards(MunicipioGuard)
  @UseInterceptors(IdempotenciaInterceptor)
  async executar(
    @Param('nome') nome: string,
    @MunicipioAtual() municipio: Municipio,
    @Headers('x-conversa-id') conversaRef: string | undefined,
    @Headers('x-telefone') telefoneBruto: string | undefined,
    @Headers('x-telefone-web') telefoneWeb: string | undefined,
    @Body() body: unknown,
  ) {
    this.registo.obter(nome); // 404 antes de criar a conversa
    const telefone = telefoneComAlternativa(telefoneBruto, telefoneWeb);
    const conversa = conversaRef
      ? await this.conversas.garantir({
          municipioId: municipio.id,
          canal: 'telefone',
          providerId: conversaRef,
          telefone,
        })
      : null;
    const ctx: ContextoFerramenta = {
      municipio,
      canal: 'telefone',
      conversaId: conversa?.conversaId ?? null,
      municipeId: conversa?.municipeId ?? null,
      telefone,
    };
    return this.registo.executar(nome, ctx, body);
  }
}
