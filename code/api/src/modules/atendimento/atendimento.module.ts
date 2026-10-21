import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { MunicipesService } from '../municipes/municipes.service.js';
import { ApoioPassagemService } from './apoio-passagem.service.js';
import { ferramentasAtendimento } from './atendimento.ferramentas.js';
import { EncaminhamentoController } from './encaminhamento.controller.js';
import { EncaminhamentoService } from './encaminhamento.service.js';
import { HorarioService } from './horario.service.js';
import { PassagensController } from './passagens.controller.js';
import { PassagensService } from './passagens.service.js';

/**
 * Atendimento: horário do balcão, "quem trata de quê", passagem a
 * funcionário e emergências. Exporta o HorarioService (fora de horas no fim
 * da chamada, próximo atendimento).
 */
@Module({
  controllers: [PassagensController, EncaminhamentoController],
  providers: [
    HorarioService,
    EncaminhamentoService,
    PassagensService,
    ApoioPassagemService,
  ],
  exports: [HorarioService],
})
export class AtendimentoModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly encaminhamento: EncaminhamentoService,
    private readonly passagens: PassagensService,
    private readonly municipes: MunicipesService,
    private readonly conversas: ConversasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ...ferramentasAtendimento(
        this.encaminhamento,
        this.passagens,
        this.municipes,
        this.conversas,
      ),
    );
  }
}
