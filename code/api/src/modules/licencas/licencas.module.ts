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
import { entradaRenovar, LicencasAvisosService } from './avisos.service.js';
import { ENTRADAS } from './tipos.js';

/** O fim de todas as descrições: o que fazer com o resultado. */
const DEPOIS =
  'Se vier proposta "aprovar": diz que cumpre as regras, o valor da taxa e o que vem em "dizer" (é pagamento de teste, nada é cobrado); ' +
  'diz também as condições. Se vier "tecnico": explica que regra não cumpre e que um técnico vai ver. ' +
  'Se vier precisa_identificacao, segue a instrução.';

export const FILA_LICENCAS = 'licencas_pagas';
/** Avisos antes de uma licença expirar (todos os dias de manhã). */
export const FILA_AVISOS_LICENCAS = 'licencas_avisos';

/**
 * Licenças decididas na chamada: regras em código, taxa em modo de teste,
 * aprovação num clique e a licença com QR por SMS.
 */
@Module({
  imports: [PagamentosModule],
  controllers: [LicencasPainelController, LicencasPublicoController],
  providers: [LicencasService, LicencasAvisosService],
  // As regras públicas e o verificador usam o mesmo motor.
  exports: [LicencasService],
})
export class LicencasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly licencas: LicencasService,
    private readonly avisos: LicencasAvisosService,
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
    this.registo.registar(
      ferramenta({
        nome: 'pedir_licenca_publicidade',
        descricao:
          'Pede a licença de publicidade (placa, letras, tabuleta, toldo, lona na fachada, bandeirola ou cavalete com um anúncio) e verifica as regras da câmara na hora. ' +
          'O anúncio pequeno do próprio estabelecimento não precisa de licença: fica uma mera comunicação, sem taxa. ' +
          'Antes, pergunta que suporte é, o nome do estabelecimento ou da marca, o que diz o anúncio, a morada, a largura e a altura em metros, se é iluminado, se fica no próprio estabelecimento, se é no centro histórico, a partir de que dia e por quantos meses; confirma tudo com a pessoa. ' +
          DEPOIS,
        entrada: ENTRADAS.publicidade,
        executar: (ctx, e) => this.licencas.pedir('publicidade', ctx, e),
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'pedir_licenca_recinto_improvisado',
        descricao:
          'Pede a licença de recinto improvisado (arraial, festa, concerto ou espetáculo ao ar livre com palco, tenda, barracas ou bancadas montados para o evento) e verifica as regras da câmara na hora. ' +
          'Antes, pergunta o que é o evento, o local, o primeiro dia e quantos dias dura, quantas pessoas no máximo ao mesmo tempo, que estruturas monta e se há música ou som; confirma tudo com a pessoa. ' +
          'Se houver música, a pessoa precisa também da licença especial de ruído: depois desta, pede-a com pedir_licenca_ruido (vem tambem_ruido: true). ' +
          DEPOIS,
        entrada: ENTRADAS.recinto_improvisado,
        executar: async (ctx, e) => {
          const r = await this.licencas.pedir('recinto_improvisado', ctx, e);
          if (!e.musica || !('dizer' in r)) return r;
          return {
            ...r,
            tambem_ruido: true,
            dizer: `${r.dizer} Como vai haver música, precisa também da licença especial de ruído: trato já dela consigo?`,
          };
        },
      }),
    );
    this.registo.registar(
      ferramenta({
        nome: 'renovar_licenca',
        descricao:
          'Renova uma licença que está a expirar (esplanada, dístico de residente, publicidade, ocupação da via pública), com os mesmos dados da anterior. ' +
          'Chama primeiro sem confirmar: encontra as licenças da pessoa a expirar e devolve os dados. Lê-os à pessoa, pergunta só o que mudou e chama outra vez com confirmar: true e as alteracoes. ' +
          'Se vier escolher: true, pergunta qual quer renovar e passa o numero. ' +
          DEPOIS,
        entrada: entradaRenovar,
        executar: (ctx, e) => this.avisos.renovar(ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_AVISOS_LICENCAS, async () => {
      await this.avisos.avisar();
    });
    // Todos os dias às 9h47 (Lisboa), dentro do horário em que se pode ligar.
    this.jobs.agendar(FILA_AVISOS_LICENCAS, '47 9 * * *');
    this.jobs.trabalhar(FILA_LICENCAS, async () => {
      await this.licencas.sincronizar();
    });
    this.jobs.agendar(FILA_LICENCAS, '* * * * *');
  }
}
