import { Module } from '@nestjs/common';
import {
  SatisfacaoPainelController,
  SatisfacaoPublicaController,
} from './satisfacao.controller.js';
import { SatisfacaoService } from './satisfacao.service.js';

/** Inquérito de satisfação na página do resumo e o cartão do painel. */
@Module({
  controllers: [SatisfacaoPublicaController, SatisfacaoPainelController],
  providers: [SatisfacaoService],
})
export class SatisfacaoModule {}
