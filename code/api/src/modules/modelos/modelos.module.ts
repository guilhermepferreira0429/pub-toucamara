import { Module } from '@nestjs/common';
import { ProcessosModule } from '../processos/processos.module.js';
import { ModelosController } from './modelos.controller.js';
import { ModelosService } from './modelos.service.js';

/**
 * Modelos de resposta aprovados pela câmara (V2): ofícios, emails e SMS com
 * variáveis, versões e aprovação. Os documentos em falta da
 * pré-visualização vêm do `ProcessosService`.
 */
@Module({
  imports: [ProcessosModule],
  controllers: [ModelosController],
  providers: [ModelosService],
})
export class ModelosModule {}
