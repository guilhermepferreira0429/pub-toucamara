import { Global, Module } from '@nestjs/common';
import { ClaudeService } from './claude.service.js';
import { VisaoService } from './visao.service.js';

@Global()
@Module({
  providers: [ClaudeService, VisaoService],
  exports: [ClaudeService, VisaoService],
})
export class IaModule {}
