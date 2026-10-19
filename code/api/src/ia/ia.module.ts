import { Global, Module } from '@nestjs/common';
import { ClaudeService } from './claude.service.js';

@Global()
@Module({
  providers: [ClaudeService],
  exports: [ClaudeService],
})
export class IaModule {}
