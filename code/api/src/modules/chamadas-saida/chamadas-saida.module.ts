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
          'Quando pede para juntar à chamada um familiar ou alguém de confiança (nunca em emergências). Confirma o número em voz alta antes. ' +
          'modo "conferencia": depois do "dizer" não digas mais nada (voltas logo). precisa_autorizacao: pergunta e, com o sim, chama com autorizou: true. modo "web": o que o familiar escrever chega-te como contexto.',
        // Também nas chamadas da câmara (ex.: campanhas a pessoas idosas).
        agentes: ['entrada', 'saida', 'chat'],
        entrada: entradaJuntarFamiliar,
        executar: (ctx, e) => this.juncoes.pedir(ctx, e),
      }),
      ferramenta({
        nome: 'estado_familiar',
        descricao:
          'Quando voltaste à chamada para juntar um familiar (tipo_chamada juncao_familiar): se já atendeu.',
        // O agente volta à sala ligando para a linha da câmara: entra pelo
        // agente de entrada (é o número da linha que escolhe o agente).
        agentes: ['entrada'],
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
