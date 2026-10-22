import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module.js';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import { OrdenamentoModule } from '../ordenamento/ordenamento.module.js';
import {
  ProcessosPainelController,
  ProcessosPublicoController,
  RascunhosController,
  TiposProcessoController,
} from './processos.controller.js';
import { ferramentasProcessos } from './processos.ferramentas.js';
import { ProcessosApoioService } from './processos-apoio.service.js';
import { ProcessosAvisosService } from './processos-avisos.service.js';
import { ProcessosDemonstracaoService } from './processos-demonstracao.service.js';
import { ProcessosVerificacoesService } from './processos-verificacoes.service.js';
import { OrdemSimulada, VERIFICADOR_ORDEM } from './verificacoes.js';
import { ProcessosPainelService } from './processos-painel.service.js';
import { ProcessosService } from './processos.service.js';
import { TiposProcessoService } from './tipos-processo.service.js';

@Module({
  // Pesquisa no conhecimento para o regulamento aplicável; zonas do PDM e
  // geocodificação para as verificações automáticas.
  imports: [ConhecimentoModule, OrdenamentoModule, OcorrenciasModule],
  controllers: [
    ProcessosPainelController,
    RascunhosController,
    TiposProcessoController,
    ProcessosPublicoController,
  ],
  providers: [
    ProcessosService,
    ProcessosPainelService,
    ProcessosAvisosService,
    ProcessosApoioService,
    ProcessosVerificacoesService,
    ProcessosDemonstracaoService,
    TiposProcessoService,
    // Não há API pública da Ordem: simulado até haver uma ligação real.
    { provide: VERIFICADOR_ORDEM, useClass: OrdemSimulada },
  ],
  exports: [ProcessosService, TiposProcessoService],
})
export class ProcessosModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly processos: ProcessosService,
    private readonly avisos: ProcessosAvisosService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasProcessos(this.processos));
    // Lembretes do prazo de resposta do munícipe (o `lembretes` é o das marcações).
    this.jobs.trabalhar(
      'lembretes_prazos',
      async () => {
        await this.avisos.lembrarPrazos();
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar('lembretes_prazos', '*/15 * * * *');
  }
}
