import { Module } from '@nestjs/common';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module.js';
import { PainelModule } from '../painel/painel.module.js';
import { PerguntasChefiaController } from './perguntas-chefia.controller.js';
import { PerguntasChefiaService } from './perguntas-chefia.service.js';

/**
 * Perguntas da chefia em linguagem normal ("Quantos processos de obras estão
 * atrasados?"): `POST /v1/painel/perguntar` (e `/stream` em SSE), histórico
 * e sugestões. Reutiliza as leituras das vistas do painel e o resumo das
 * melhorias ao portal.
 */
@Module({
  imports: [PainelModule, ConhecimentoModule],
  controllers: [PerguntasChefiaController],
  providers: [PerguntasChefiaService],
})
export class PerguntasChefiaModule {}
