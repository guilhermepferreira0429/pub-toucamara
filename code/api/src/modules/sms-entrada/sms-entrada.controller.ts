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
import { SmsEntradaService } from './sms-entrada.service.js';

/**
 * Webhook "A message comes in" do número de SMS no Twilio (assinado). A
 * resposta vai pela fila dos SMS, por isso o TwiML devolvido é vazio.
 */
@Controller('webhooks/sms')
export class SmsEntradaController {
  constructor(private readonly sms: SmsEntradaService) {}

  @Post('entrada')
  @HttpCode(200)
  async entrada(
    @Body() body: Record<string, unknown>,
    @Headers('x-twilio-signature') assinatura: string | undefined,
    @Res() res: Response,
  ) {
    const p = parametrosTwilio(body);
    if (!this.sms.assinaturaValida(p, assinatura)) {
      throw new ForbiddenException('Assinatura do Twilio inválida.');
    }
    await this.sms.receber(p);
    res
      .type('text/xml')
      .send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }
}
