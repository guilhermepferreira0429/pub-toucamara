import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { PagamentosModule } from '../pagamentos/pagamentos.module.js';
import {
  LicencasPainelController,
  LicencasPublicoController,
} from './licencas.controller.js';
import { entradaPedirRuido, LicencasService } from './licencas.service.js';

export const FILA_LICENCAS = 'licencas_pagas';

/**
 * Licenças decididas na chamada: regras em código, taxa em modo de teste,
 * aprovação num clique e a licença com QR por SMS.
 */
@Module({
  imports: [PagamentosModule],
  controllers: [LicencasPainelController, LicencasPublicoController],
  providers: [LicencasService],
})
export class LicencasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly licencas: LicencasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'pedir_licenca_ruido',
        descricao:
          'Pede a licença especial de ruído (festa, evento ou obra com barulho) e verifica as regras da câmara na hora. ' +
          'Antes, pergunta o que é, a morada, o dia, a hora de início e de fim, quantas pessoas e se há música alta; confirma tudo com a pessoa. ' +
          'Se vier proposta "aprovar": diz que cumpre as regras, o valor da taxa e o que vem em "dizer" (é pagamento de teste, nada é cobrado); ' +
          'diz também as condições. Se vier "tecnico": explica que regra não cumpre e que um técnico vai ver. ' +
          'Se vier precisa_identificacao, segue a instrução.',
        entrada: entradaPedirRuido,
        executar: (ctx, e) => this.licencas.pedirRuido(ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_LICENCAS, async () => {
      await this.licencas.sincronizar();
    });
    this.jobs.agendar(FILA_LICENCAS, '* * * * *');
  }
}
