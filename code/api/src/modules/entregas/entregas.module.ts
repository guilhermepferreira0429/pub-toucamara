import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ProcessosModule } from '../processos/processos.module.js';
import {
  EntregasPainelController,
  EntregasPublicoController,
} from './entregas.controller.js';
import {
  entradaEntregar,
  EntregasService,
  FILA_EXPIRAR_ENTREGAS,
} from './entregas.service.js';

/**
 * Entregar o pedido em nome da pessoa no balcão online (migração 0065):
 * a ferramenta `entregar_pedido`, a página de autorização (Chave Móvel
 * Digital simulada até haver credenciação na AMA), a submissão (simulada)
 * com comprovativo, e o estado no painel.
 */
@Module({
  imports: [ProcessosModule],
  controllers: [EntregasPublicoController, EntregasPainelController],
  providers: [EntregasService],
  exports: [EntregasService],
})
export class EntregasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly entregas: EntregasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'entregar_pedido',
        descricao:
          'Quando pede para entregarmos o requerimento concluído no balcão online, em nome dela. Na confirmação manda o codigo_resumo e as palavras_do_municipe; depois a pessoa autoriza com a Chave Móvel Digital pelo link do SMS. ' +
          'É simulado, sem validade legal: diz isso. requerimento_por_concluir → conclui primeiro.',
        entrada: entradaEntregar,
        executar: (ctx, e) => this.entregas.entregarPedido(ctx, e),
      }),
    );
    this.jobs.trabalhar(
      FILA_EXPIRAR_ENTREGAS,
      async () => {
        await this.entregas.expirarVencidas();
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar(FILA_EXPIRAR_ENTREGAS, '11-59/15 * * * *');
  }
}
