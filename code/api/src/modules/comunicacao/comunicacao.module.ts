import { Global, Module } from '@nestjs/common';
import { LinksCurtosController } from './links-curtos.controller.js';
import { LinksCurtosService } from './links-curtos.service.js';
import { MensagensService } from './mensagens.service.js';

@Global()
@Module({
  controllers: [LinksCurtosController],
  providers: [MensagensService, LinksCurtosService],
  exports: [MensagensService, LinksCurtosService],
})
export class ComunicacaoModule {}
