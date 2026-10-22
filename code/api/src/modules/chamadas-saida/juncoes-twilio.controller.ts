import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { parametrosTwilio } from '../../common/twilio.js';
import { JuncaoFamiliarService } from './juncao-familiar.service.js';

/** StatusCallback do Twilio para o familiar chamado para a sala (assinado). */
@Controller('webhooks/twilio/juncoes')
export class JuncoesTwilioController {
  constructor(private readonly juncoes: JuncaoFamiliarService) {}

  @Post(':id')
  @HttpCode(204)
  async estado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-twilio-signature') assinatura: string | undefined,
  ) {
    const r = await this.juncoes.estadoTwilio(
      id,
      parametrosTwilio(body),
      assinatura,
    );
    if (!r.ok) throw new ForbiddenException('Assinatura do Twilio inválida.');
  }
}
