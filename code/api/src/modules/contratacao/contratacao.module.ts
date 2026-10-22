import { Module } from '@nestjs/common';
import { ContratacaoController } from './contratacao.controller.js';
import { ContratacaoService } from './contratacao.service.js';

/**
 * Contratação pública (V3 · n.º 8): confirmar se um pedido cabe no ajuste
 * direto e preparar o procedimento com o rascunho das peças. Só painel:
 * não há ferramenta do agente nem rota pública. O serviço é exportado para
 * o assistente interno responder a "cabe no ajuste direto?".
 */
@Module({
  controllers: [ContratacaoController],
  providers: [ContratacaoService],
  exports: [ContratacaoService],
})
export class ContratacaoModule {}
