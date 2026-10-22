import { Module } from '@nestjs/common';
import { ConcelhoController } from './concelho.controller.js';
import { ConcelhoService } from './concelho.service.js';

/**
 * "Pergunte ao concelho": o que os munícipes sentem, lido nas conversas
 * (`/v1/painel/concelho/*`). O ClaudeService e a auditoria são globais.
 */
@Module({
  controllers: [ConcelhoController],
  providers: [ConcelhoService],
  exports: [ConcelhoService],
})
export class ConcelhoModule {}
