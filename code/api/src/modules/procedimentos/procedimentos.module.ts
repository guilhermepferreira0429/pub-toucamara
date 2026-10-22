import { Module } from '@nestjs/common';
import { ContratacaoModule } from '../contratacao/contratacao.module.js';
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
 * pública — nada disto sai para o munícipe. O assistente usa o motor da
 * contratação pública para "cabe no ajuste direto?".
 */
@Module({
  imports: [ContratacaoModule],
  controllers: [ProcedimentosController, AssistenteController],
  providers: [ProcedimentosService, EntrevistasService, AssistenteService],
})
export class ProcedimentosModule {}
