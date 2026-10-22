import { Global, Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import {
  ChamadasSaidaController,
  LigarProcessoController,
} from './chamadas-saida.controller.js';
import { ferramentasChamadasSaida } from './chamadas-saida.ferramentas.js';
import { ChamadasSaidaService } from './chamadas-saida.service.js';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { z } from 'zod';
import {
  entradaJuntarFamiliar,
  FILA_JUNTAR_FAMILIAR,
  JuncaoFamiliarService,
} from './juncao-familiar.service.js';
import { JuncoesTwilioController } from './juncoes-twilio.controller.js';

export const FILA_CHAMADAS_SAIDA = 'chamadas_saida';

/**
 * Chamadas de saída do agente. Global: os avisos dos processos agendam
 * (`agendar`) e o webhook do fim da chamada dá o resultado, sem importarem
 * este módulo (e sem ciclos com eles).
 */
@Global()
@Module({
  controllers: [
    ChamadasSaidaController,
    LigarProcessoController,
    JuncoesTwilioController,
  ],
  providers: [ChamadasSaidaService, JuncaoFamiliarService],
  exports: [ChamadasSaidaService, JuncaoFamiliarService],
})
export class ChamadasSaidaModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly chamadas: ChamadasSaidaService,
    private readonly juncoes: JuncaoFamiliarService,
  ) {}

  onModuleInit() {
    this.registo.registar(...ferramentasChamadasSaida(this.chamadas));
    this.registo.registar(
      ferramenta({
        nome: 'juntar_familiar',
        descricao:
          'Quando a pessoa pede para juntar um familiar ou alguém de confiança à chamada ("fale com o meu filho"). ' +
          'Pergunta o número e confirma-o em voz alta antes de chamar. Diz o texto de "dizer" e, se modo for "conferencia", ' +
          'não digas mais nada: a chamada muda e voltas logo a seguir. Nunca para emergências (aí é o 112).',
        entrada: entradaJuntarFamiliar,
        executar: (ctx, e) => this.juncoes.pedir(ctx, e),
      }),
      ferramenta({
        nome: 'estado_familiar',
        descricao:
          'Numa chamada em que voltaste para juntar um familiar (tipo_chamada juncao_familiar): diz se o familiar já atendeu. Diz o texto de "dizer".',
        entrada: z.object({}),
        executar: (ctx) => this.juncoes.estadoParaAgente(ctx),
      }),
    );
    this.jobs.trabalhar<{ juncaoId: string }>(
      FILA_JUNTAR_FAMILIAR,
      async ({ juncaoId }) => {
        await this.juncoes.executar(juncaoId);
      },
      { concorrencia: 2 },
    );
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
