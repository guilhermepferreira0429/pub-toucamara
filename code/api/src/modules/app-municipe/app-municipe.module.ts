import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module.js';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import { ProcessosModule } from '../processos/processos.module.js';
import {
  AppController,
  AppPainelController,
  AppPublicoController,
} from './app-municipe.controller.js';
import { AppMunicipeService } from './app-municipe.service.js';
import { AppSessaoService } from './app-sessao.service.js';
import { AppGuard } from './app.guard.js';

/**
 * A app dos munícipes (Flutter, Android): entrar com o telemóvel (código
 * por SMS), sessão longa e revogável, os dados da própria pessoa (processos,
 * ocorrências, marcações, pagamentos, licenças, reclamações, conversas,
 * avisos), reportar ocorrências com GPS e fotografia, chat identificado com
 * o agente e registo dos telemóveis para o push (PushModule).
 */
@Module({
  imports: [ChatModule, OcorrenciasModule, ProcessosModule],
  controllers: [AppPublicoController, AppController, AppPainelController],
  providers: [AppSessaoService, AppMunicipeService, AppGuard],
})
export class AppMunicipeModule {}
