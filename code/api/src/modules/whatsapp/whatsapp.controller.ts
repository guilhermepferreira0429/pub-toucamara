import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { parametrosTwilio } from '../../common/twilio.js';
import { WhatsappService } from './whatsapp.service.js';

/**
 * Webhook "A message comes in" do remetente WhatsApp no Twilio (assinado).
 * Responde já com TwiML vazio; a resposta do agente vai pela fila.
 */
@Controller('webhooks/whatsapp')
export class WhatsappController {
  constructor(private readonly whatsapp: WhatsappService) {}

  @Post('entrada')
  @HttpCode(200)
  async entrada(
    @Body() body: Record<string, unknown>,
    @Headers('x-twilio-signature') assinatura: string | undefined,
    @Res() res: Response,
  ) {
    const p = parametrosTwilio(body);
    if (!this.whatsapp.assinaturaValida(p, assinatura)) {
      throw new ForbiddenException('Assinatura do Twilio inválida.');
    }
    await this.whatsapp.receber(p);
    res
      .type('text/xml')
      .send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
}
