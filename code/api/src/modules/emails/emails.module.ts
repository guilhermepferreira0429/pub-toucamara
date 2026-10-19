import { Module } from '@nestjs/common';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module.js';
import {
  EmailsPainelController,
  EmailsWebhookController,
} from './emails.controller.js';
import { EmailsService } from './emails.service.js';

@Module({
  imports: [ConhecimentoModule],
  controllers: [EmailsWebhookController, EmailsPainelController],
  providers: [EmailsService],
  exports: [EmailsService],
})
export class EmailsModule {}
