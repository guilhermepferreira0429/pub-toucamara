import { Module } from '@nestjs/common';
import { SmsEntradaController } from './sms-entrada.controller.js';
import { SmsEntradaService } from './sms-entrada.service.js';

/** SMS que as pessoas mandam para a câmara: estado do processo e PARAR. */
@Module({
  controllers: [SmsEntradaController],
  providers: [SmsEntradaService],
  exports: [SmsEntradaService],
})
export class SmsEntradaModule {}
