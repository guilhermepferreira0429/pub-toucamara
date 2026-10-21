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
import { ENTRADAS } from './tipos.js';

/** O fim de todas as descrições: o que fazer com o resultado. */
const DEPOIS =
  'Se vier proposta "aprovar": diz que cumpre as regras, o valor da taxa e o que vem em "dizer" (é pagamento de teste, nada é cobrado); ' +
  'diz também as condições. Se vier "tecnico": explica que regra não cumpre e que um técnico vai ver. ' +
  'Se vier precisa_identificacao, segue a instrução.';

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
          DEPOIS,
        entrada: entradaPedirRuido,
        executar: (ctx, e) => this.licencas.pedirRuido(ctx, e),
      }),
    );
    // Uma ferramenta por tipo: cada uma pede coisas diferentes, e assim o
    // modelo vê só os campos daquele pedido (e o ElevenLabs aceita-os sem
    // esquemas condicionais).
    this.registo.registar(
      ferramenta({
        nome: 'pedir_licenca_ocupacao_via',
        descricao:
          'Pede a licença de ocupação da via pública por causa de obras (andaime, contentor de entulho, materiais na rua ou plataforma elevatória) e verifica as regras da câmara na hora. ' +
          'Antes, pergunta o que vai pôr na rua e para que obra, a morada, o primeiro dia, quantos dias, quantos m² ocupa, quantos metros de passeio ficam livres para as pessoas passarem e se ocupa a estrada; confirma tudo com a pessoa. ' +
          DEPOIS,
        entrada: ENTRADAS.ocupacao_via,
        executar: (ctx, e) => this.licencas.pedir('ocupacao_via', ctx, e),
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'pedir_licenca_esplanada',
        descricao:
          'Pede a licença de esplanada (mesas e cadeiras no passeio, à frente de um café ou restaurante) e verifica as regras da câmara na hora. ' +
          'Antes, pergunta o nome do estabelecimento, a morada, a partir de que dia e por quantos meses, a área em m², quantas mesas, quantos metros de passeio ficam livres, se leva estrado ou estrutura fixa e se fica no centro histórico; confirma tudo com a pessoa. ' +
          DEPOIS,
        entrada: ENTRADAS.esplanada,
        executar: (ctx, e) => this.licencas.pedir('esplanada', ctx, e),
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'pedir_distico_residente',
        descricao:
          'Pede o dístico (cartão) de residente para estacionar o carro na zona onde a pessoa mora, e verifica as regras da câmara na hora. ' +
          'Antes, pergunta a morada, a matrícula, quantos dísticos já há para essa casa, se a morada está no cartão de cidadão e se o carro está em nome da pessoa; confirma tudo com a pessoa. ' +
          DEPOIS,
        entrada: ENTRADAS.distico_residente,
        executar: (ctx, e) => this.licencas.pedir('distico_residente', ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_LICENCAS, async () => {
      await this.licencas.sincronizar();
    });
    this.jobs.agendar(FILA_LICENCAS, '* * * * *');
  }
}
