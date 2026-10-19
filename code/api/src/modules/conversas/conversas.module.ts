import { Global, Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { AtendimentoModule } from '../atendimento/atendimento.module.js';
import {
  PainelConversasController,
  ResumosPublicosController,
} from './conversas.controller.js';
import { ConversasService } from './conversas.service.js';
import { FimChamadaService } from './fim-chamada.service.js';
import { PainelConversasService } from './painel-conversas.service.js';
import { ferramentasRetomar } from './retomar.ferramentas.js';
import { RetomarService } from './retomar.service.js';
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
    RetomarService,
  ],
  // RetomarService: o chat liga as sessões à conversa anterior.
  exports: [ConversasService, RetomarService],
})
export class ConversasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly retomar: RetomarService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasRetomar(this.retomar));
  }
}
