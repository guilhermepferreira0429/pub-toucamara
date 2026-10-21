import { Module } from '@nestjs/common';
import { AssistenteService } from './assistente.service.js';
import { EntrevistasService } from './entrevistas.service.js';
import {
  AssistenteController,
  ProcedimentosController,
} from './procedimentos.controller.js';
import { ProcedimentosService } from './procedimentos.service.js';

/**
 * Procedimentos internos ("a memória da câmara"): o "como se faz" escrito,
 * a entrevista a quem se vai reformar e o assistente interno para os
 * funcionários novos. Só painel: não há ferramenta do agente nem rota
 * pública — nada disto sai para o munícipe.
 */
@Module({
  controllers: [ProcedimentosController, AssistenteController],
  providers: [ProcedimentosService, EntrevistasService, AssistenteService],
})
export class ProcedimentosModule {}
