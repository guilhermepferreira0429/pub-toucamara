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
          'Pedido para consultar um processo ANTIGO no arquivo municipal (obras, licenças, plantas de casas antigas: "quero ver o processo da casa do meu avô", "preciso da planta antiga", "como consulto um processo no arquivo?"). ' +
          'NÃO é para o estado de um processo em curso (usa estado_processo). ' +
          'Pergunta o que a pessoa sabe: a morada do prédio, o ano (mesmo aproximado) e o nome de quem fez o pedido na altura (ou o número antigo). Chama com isso: a ferramenta procura nas digitalizações e diz só QUANTOS documentos prováveis há. Nunca digas nomes, moradas ou conteúdos de documentos: não os recebes. ' +
          'Depois segue o "motivo": precisa_identificacao (pede o NIF e usa identificar_municipe), falta_qualidade (explica a regra de acesso e pergunta se é o titular ou qual é o interesse), falta_modalidade (explica presencial ou cópia certificada com os valores tal como vêm e diz que são de demonstração se vier valores_de_demonstracao), falta_confirmar (lê "ler_a_pessoa" e chama com confirmado: true). ' +
          'No fim diz o "dizer" tal como vem (número do pedido e prazo). A regra legal é "a confirmar com o arquivo": não a apresentes como certa.',
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
