import { Global, Module } from '@nestjs/common';
import { RegistoFerramentas } from './registo-ferramentas.service.js';

@Global()
@Module({
  providers: [RegistoFerramentas],
  exports: [RegistoFerramentas],
})
export class FerramentasModule {}
