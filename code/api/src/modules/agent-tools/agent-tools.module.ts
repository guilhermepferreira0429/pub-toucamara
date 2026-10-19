import { Module } from '@nestjs/common';
import { IdempotenciaInterceptor } from '../../common/idempotencia.interceptor.js';
import { AgentToolsController } from './agent-tools.controller.js';
import { MunicipioGuard, SegredoAgenteGuard } from './agente.guard.js';

@Module({
  controllers: [AgentToolsController],
  providers: [SegredoAgenteGuard, MunicipioGuard, IdempotenciaInterceptor],
  exports: [SegredoAgenteGuard, MunicipioGuard],
})
export class AgentToolsModule {}
