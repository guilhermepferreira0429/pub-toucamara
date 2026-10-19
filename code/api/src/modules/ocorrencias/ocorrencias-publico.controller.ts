import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { validar } from '../../common/validacao.js';
import { OcorrenciasService } from './ocorrencias.service.js';

// Tokens de 18 bytes em base64url (24 caracteres): recusa logo o que não é.
const esquemaToken = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);

/** Página do link do SMS: ver a ocorrência e juntar fotografias. */
@Controller('public/ocorrencias')
export class OcorrenciasPublicoController {
  constructor(private readonly ocorrencias: OcorrenciasService) {}

  @Get(':token')
  ver(@Param('token') token: string) {
    return this.ocorrencias.publica(validar(esquemaToken, token));
  }

  /** Devolve a URL assinada; o browser envia a fotografia direto (PUT). */
  @Post(':token/fotos')
  @HttpCode(201)
  foto(@Param('token') token: string, @Body() body: unknown) {
    const { mime } = validar(
      z.object({ mime: z.string().trim().min(3).max(100) }),
      body,
    );
    return this.ocorrencias.novaFoto(validar(esquemaToken, token), mime);
  }
}
