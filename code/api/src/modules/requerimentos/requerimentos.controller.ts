import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Sse,
} from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { MunicipioAtual } from '../../common/pedido.js';
import { MIMES_VISAO } from '../../ia/visao.service.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import {
  MIMES_DOCUMENTO,
  RequerimentosService,
} from './requerimentos.service.js';
import {
  bytesDeBase64,
  MAXIMO_PDF_BYTES,
  semPrefixoDataUrl,
} from './verificacao-documentos.js';

const esquemaToken = z.string().min(16).max(64);

const esquemaDocumento = z.object({
  tipo_documento_id: z.uuid().nullable().optional(),
  mime: z.enum(Object.keys(MIMES_DOCUMENTO) as [string, ...string[]]),
  nome: z.string().trim().min(1).max(200),
});

/*
 * Verificar por fotografia. O corpo JSON pode ir até 50 MB (main.ts), mas o
 * ficheiro fica-se por 5 MB em imagem (limite da API do Claude) e 10 MB em
 * PDF: acima disso 413 `imagem_grande`, sem chegar à IA. A web deve reduzir
 * a foto (ex.: canvas → JPEG 2000 px) antes de enviar.
 */
const esquemaVerificar = z.object({
  tipo_documento_id: z.uuid(),
  mime: z.enum(MIMES_VISAO),
  imagem_base64: z
    .string()
    .min(16)
    .transform((s) => semPrefixoDataUrl(s.trim())),
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

  /**
   * { tipo_documento_id, mime, imagem_base64 } → o que está bem ou mal no
   * documento ("fora de prazo — emitida há 8 meses, tem de ter menos de 6")
   * e as listas tem / por_verificar / faltam atualizadas. É sempre por
   * requerimento (as regras dependem do documento pedido): não há
   * `POST /public/documentos/verificar` solto.
   */
  @Post(':token/documentos/verificar')
  @HttpCode(200)
  verificar(@Param('token') token: string, @Body() body: unknown) {
    const t = validar(esquemaToken, token);
    // Antes do zod e da descodificação: um ficheiro enorme não passa daqui.
    const b64 = (body as { imagem_base64?: unknown } | null)?.imagem_base64;
    if (typeof b64 === 'string' && bytesDeBase64(b64) > MAXIMO_PDF_BYTES) {
      throw new ErroApi(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'imagem_grande',
        'O ficheiro é demasiado grande: tire outra fotografia com menos resolução.',
        { maximo_bytes: MAXIMO_PDF_BYTES },
      );
    }
    return this.requerimentos.verificarDocumento(
      t,
      validar(esquemaVerificar, body),
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
