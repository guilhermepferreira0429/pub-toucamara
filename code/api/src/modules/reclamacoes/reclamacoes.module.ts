import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import {
  ReclamacoesPainelController,
  ReclamacoesPublicoController,
} from './reclamacoes.controller.js';
import { entradaRegistar, ReclamacoesService } from './reclamacoes.service.js';

export const FILA_AVISOS_RECLAMACOES = 'reclamacoes_avisos';

/**
 * Livro de reclamações com prazo de resposta controlado: a ferramenta do
 * agente, o painel, a página pública e os avisos diários do prazo.
 */
@Module({
  controllers: [ReclamacoesPainelController, ReclamacoesPublicoController],
  providers: [ReclamacoesService],
  exports: [ReclamacoesService],
})
export class ReclamacoesModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly reclamacoes: ReclamacoesService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'registar_reclamacao',
        descricao:
          'Regista uma reclamação FORMAL no Livro de Reclamações da câmara: fica com número (REC n/ano) e a câmara tem um prazo legal para responder por escrito. ' +
          'Usa só quando a pessoa quer apresentar uma reclamação ou queixa formal sobre um serviço, um funcionário ou o atendimento da câmara ("quero reclamar", "livro de reclamações", "quero fazer queixa"). ' +
          'NÃO é para um problema na rua (buraco, lixo, iluminação: usa registar_ocorrencia), nem para um pedido, uma dúvida ou o estado de um processo; se não for claro, pergunta se quer apresentar uma reclamação formal. ' +
          'Antes, pergunta o nome, de que serviço se queixa, o que aconteceu (quando e onde) e o que pede à câmara. ' +
          'Chama primeiro com confirmado: false: vem o texto em "ler_a_pessoa"; lê-o à pessoa e, depois de ela confirmar (ou corrigir), chama outra vez com confirmado: true. ' +
          'No fim diz o "dizer" tal como vem (o número e a data-limite de resposta) e não prometas outro prazo. Se vier precisa_identificacao, segue a instrução.',
        entrada: entradaRegistar,
        executar: (ctx, e) => this.reclamacoes.registarPeloAgente(ctx, e),
      }),
    );
    this.jobs.trabalhar(FILA_AVISOS_RECLAMACOES, async () => {
      await this.reclamacoes.avisar();
    });
    // Dias úteis, de manhã (minuto desencontrado do resto).
    this.jobs.agendar(FILA_AVISOS_RECLAMACOES, '17 8 * * 1-5');
  }
}
