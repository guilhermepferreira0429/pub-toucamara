import { Global, Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import {
  ChamadasSaidaController,
  LigarProcessoController,
} from './chamadas-saida.controller.js';
import { ferramentasChamadasSaida } from './chamadas-saida.ferramentas.js';
import { ChamadasSaidaService } from './chamadas-saida.service.js';

export const FILA_CHAMADAS_SAIDA = 'chamadas_saida';

/**
 * Chamadas de saída do agente. Global: os avisos dos processos agendam
 * (`agendar`) e o webhook do fim da chamada dá o resultado, sem importarem
 * este módulo (e sem ciclos com eles).
 */
@Global()
@Module({
  controllers: [ChamadasSaidaController, LigarProcessoController],
  providers: [ChamadasSaidaService],
  exports: [ChamadasSaidaService],
})
export class ChamadasSaidaModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly chamadas: ChamadasSaidaService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasChamadasSaida(this.chamadas));
    this.jobs.trabalhar(
      FILA_CHAMADAS_SAIDA,
      async () => {
        await this.chamadas.processar();
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar(FILA_CHAMADAS_SAIDA, '* * * * *');
  }
}
