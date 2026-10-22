import { Module } from '@nestjs/common';
import { PesquisaController } from './pesquisa.controller.js';
import { PesquisaService } from './pesquisa.service.js';

/** Pesquisa global do painel (⌘K). */
@Module({
  controllers: [PesquisaController],
  providers: [PesquisaService],
})
export class PesquisaModule {}
