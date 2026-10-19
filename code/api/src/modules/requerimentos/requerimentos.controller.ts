import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
} from '@nestjs/common';
import { z } from 'zod';
import { MunicipioAtual } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  MIMES_DOCUMENTO,
  RequerimentosService,
} from './requerimentos.service.js';

const esquemaToken = z.string().min(16).max(64);

const esquemaDocumento = z.object({
  tipo_documento_id: z.uuid().nullable().optional(),
  mime: z.enum(Object.keys(MIMES_DOCUMENTO) as [string, ...string[]]),
  nome: z.string().trim().min(1).max(200),
});

/** Página "Rever e assinar", aberta pelo token do requerimento. */
@Controller('public/requerimentos')
export class RequerimentosPublicoController {
  constructor(private readonly requerimentos: RequerimentosService) {}

  @Get(':token')
  ver(@Param('token') token: string) {
    return this.requerimentos.publico(validar(esquemaToken, token));
  }

  /** Assinatura simulada → entregue → processo. Idempotente. */
  @Post(':token/assinar')
  @HttpCode(200)
  assinar(@Param('token') token: string, @Ip() ip: string) {
    return this.requerimentos.assinar(validar(esquemaToken, token), ip);
  }

  /** { tipo_documento_id, mime, nome } → URL de envio (PUT) assinada. */
  @Post(':token/documentos')
  documento(@Param('token') token: string, @Body() body: unknown) {
    return this.requerimentos.novoDocumento(
      validar(esquemaToken, token),
      validar(esquemaDocumento, body),
    );
  }
}

/**
 * Ecrã "requerimento ao vivo" durante a chamada. O EventSource do browser
 * não manda Authorization: a web usa fetch com stream (ex.:
 * @microsoft/fetch-event-source) para ler este SSE.
 */
@Controller('painel')
@Painel('conversas')
export class RequerimentosPainelController {
  constructor(private readonly requerimentos: RequerimentosService) {}

  @Sse('requerimentos/:id/ao-vivo')
  aoVivo(
    @MunicipioAtual() m: Municipio,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.requerimentos.aoVivo(m.id, id);
  }

  @Get('requerimentos/:id')
  ver(@MunicipioAtual() m: Municipio, @Param('id', ParseUUIDPipe) id: string) {
    return this.requerimentos.estadoVivo(m.id, id);
  }

  /** Para o ecrã descobrir o requerimento ativo da chamada. */
  @Get('conversas/:conversaId/requerimento')
  daConversa(
    @MunicipioAtual() m: Municipio,
    @Param('conversaId', ParseUUIDPipe) conversaId: string,
  ) {
    return this.requerimentos.daConversa(m.id, conversaId);
  }
}
