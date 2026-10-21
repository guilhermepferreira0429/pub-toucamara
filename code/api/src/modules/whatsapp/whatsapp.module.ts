import { Module, OnModuleInit } from '@nestjs/common';
import { JobsService } from '../../jobs/jobs.service.js';
import { ChatModule } from '../chat/chat.module.js';
import { ConversasModule } from '../conversas/conversas.module.js';
import { SmsEntradaModule } from '../sms-entrada/sms-entrada.module.js';
import { WhatsappController } from './whatsapp.controller.js';
import { FILA_WHATSAPP, WhatsappService } from './whatsapp.service.js';

/** WhatsApp: o mesmo agente do chat, pelo número da câmara no WhatsApp. */
@Module({
  imports: [ChatModule, ConversasModule, SmsEntradaModule],
  controllers: [WhatsappController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsService,
    private readonly whatsapp: WhatsappService,
  ) {}

  onModuleInit() {
    this.jobs.trabalhar<{ conversaId: string }>(
      FILA_WHATSAPP,
      async ({ conversaId }) => {
        await this.whatsapp.responder(conversaId);
      },
      { concorrencia: 2 },
    );
  }
}
