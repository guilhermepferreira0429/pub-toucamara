import { Global, Module } from '@nestjs/common';
import { ArmazenamentoService } from './armazenamento.service.js';

@Global()
@Module({
  providers: [ArmazenamentoService],
  exports: [ArmazenamentoService],
})
export class ArmazenamentoModule {}
