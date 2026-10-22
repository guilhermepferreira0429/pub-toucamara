import { Global, Module } from '@nestjs/common';
import { ClaudeService } from './claude.service.js';
import { UsoIaController } from './uso-ia.controller.js';
import { UsoIaService } from './uso-ia.service.js';
import { VisaoService } from './visao.service.js';

@Global()
@Module({
  controllers: [UsoIaController],
  providers: [ClaudeService, VisaoService, UsoIaService],
  exports: [ClaudeService, VisaoService, UsoIaService],
})
export class IaModule {}
