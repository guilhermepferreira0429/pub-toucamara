import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { ChatFimService } from './chat-fim.service.js';
import { ChatController } from './chat.controller.js';
import { ferramentasChat } from './chat.ferramentas.js';
import { ChatService } from './chat.service.js';

@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatFimService],
  exports: [ChatService],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly claude: ClaudeService,
  ) {}

  onModuleInit() {
    // `redigir` serve o chat e a chamada (POST /v1/agent/tools/redigir).
    this.registo.registar(...ferramentasChat(this.claude));
  }
}
