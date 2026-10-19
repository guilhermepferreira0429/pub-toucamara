import { Global, Module } from '@nestjs/common';
import { AtendimentoModule } from '../atendimento/atendimento.module.js';
import {
  PainelConversasController,
  ResumosPublicosController,
} from './conversas.controller.js';
import { ConversasService } from './conversas.service.js';
import { FimChamadaService } from './fim-chamada.service.js';
import { PainelConversasService } from './painel-conversas.service.js';
import { ResumoService } from './resumo.service.js';
import { WebhookElevenLabsController } from './webhook-elevenlabs.controller.js';

@Global()
@Module({
  // HorarioService (fora_de_horas no fim da chamada).
  imports: [AtendimentoModule],
  controllers: [
    WebhookElevenLabsController,
    PainelConversasController,
    ResumosPublicosController,
  ],
  providers: [
    ConversasService,
    FimChamadaService,
    ResumoService,
    PainelConversasService,
  ],
  exports: [ConversasService],
})
export class ConversasModule {}
