import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module.js';
import { ArquivoIaService } from './arquivo-ia.service.js';
import { ArquivoPainelController } from './arquivo.controller.js';
import { ArquivoService, FILA_PROCESSAR } from './arquivo.service.js';
import { entradaPedir, PedidosArquivoService } from './pedidos.service.js';

/**
 * Arquivo antigo (V3 · FUN §13, ponto 5): digitalizações pesquisáveis, a
 * ferramenta para o munícipe pedir uma consulta e o painel do arquivo.
 */
@Module({
  imports: [ConhecimentoModule],
  controllers: [ArquivoPainelController],
  providers: [ArquivoService, ArquivoIaService, PedidosArquivoService],
  exports: [ArquivoService],
})
export class ArquivoModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly arquivo: ArquivoService,
    private readonly pedidos: PedidosArquivoService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'pedir_consulta_arquivo',
        descricao:
          'Para consultar um processo ANTIGO no arquivo (planta da casa do avô); não é para processos em curso. ' +
          'Pergunta a morada, o ano e quem pediu na altura (ou o número antigo): devolve só QUANTOS documentos há (nunca digas nomes, moradas ou conteúdos). ' +
          'Depois segue a instrucao de cada passo. A regra legal é "a confirmar com o arquivo": não a dês como certa.',
        entrada: entradaPedir,
        executar: (ctx, e) => this.pedidos.pedirPeloAgente(ctx, e),
      }),
    );
    this.jobs.trabalhar<{ documento_id: string }>(
      FILA_PROCESSAR,
      async ({ documento_id }) => {
        await this.arquivo.processar(documento_id);
      },
    );
  }
}
