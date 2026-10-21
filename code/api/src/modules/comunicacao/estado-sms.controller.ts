import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { parametrosTwilio } from '../../common/twilio.js';
import { MensagensService } from './mensagens.service.js';

/** Estado dos SMS (entregue / falhou), pelo StatusCallback do Twilio. */
@Controller('webhooks/sms')
export class EstadoSmsController {
  constructor(private readonly mensagens: MensagensService) {}

  @Post('estado')
  @HttpCode(204)
  async estado(
    @Body() body: Record<string, unknown>,
    @Headers('x-twilio-signature') assinatura: string | undefined,
  ) {
    const ok = await this.mensagens.estadoTwilio(
      parametrosTwilio(body),
      assinatura,
    );
    if (!ok) throw new ForbiddenException('Assinatura do Twilio inválida.');
  }
}
