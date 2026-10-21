import { Module } from '@nestjs/common';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import { ProcessosModule } from '../processos/processos.module.js';
import { FiscalizacaoController } from './fiscalizacao.controller.js';
import { FiscalizacaoService } from './fiscalizacao.service.js';

/**
 * Fiscalização (V3): planear as visitas e o relatório de vistoria ditado
 * por voz no terreno. Só API (sem ecrãs no painel por agora).
 */
@Module({
  imports: [OcorrenciasModule, ProcessosModule],
  controllers: [FiscalizacaoController],
  providers: [FiscalizacaoService],
  exports: [FiscalizacaoService],
})
export class FiscalizacaoModule {}
