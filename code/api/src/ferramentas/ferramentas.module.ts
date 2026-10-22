import { Global, Module } from '@nestjs/common';
import { RegistoFerramentas } from './registo-ferramentas.service.js';
import { RegistoServicos } from './servicos.js';

@Global()
@Module({
  providers: [RegistoFerramentas, RegistoServicos],
  exports: [RegistoFerramentas, RegistoServicos],
})
export class FerramentasModule {}
