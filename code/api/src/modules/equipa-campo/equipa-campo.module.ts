import { Module } from '@nestjs/common';
import { FiscalizacaoModule } from '../fiscalizacao/fiscalizacao.module.js';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import { EquipaCampoController } from './equipa-campo.controller.js';
import { EquipaCampoService } from './equipa-campo.service.js';

/**
 * App da equipa de campo (code/mobile, flavor `equipa`): tarefas do dia,
 * fotografias no terreno e fechar ocorrências com a foto do depois. Entrar
 * é em auth (painel/auth/app).
 */
@Module({
  imports: [FiscalizacaoModule, OcorrenciasModule],
  controllers: [EquipaCampoController],
  providers: [EquipaCampoService],
})
export class EquipaCampoModule {}
