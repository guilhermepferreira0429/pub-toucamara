import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { ferramentasConhecimento } from './conhecimento.ferramentas.js';
import { ConhecimentoService } from './conhecimento.service.js';
import {
  ContradicoesService,
  DadosContradicoes,
} from './contradicoes.service.js';
import { EmbeddingsService } from './embeddings.service.js';
import { DadosReindexar, IndexacaoService } from './indexacao.service.js';
import {
  DadosIngestao,
  IngestaoService,
  JOB_CONTRADICOES,
  JOB_INGESTAO,
  JOB_PROPOR,
} from './ingestao.service.js';
import { PainelConhecimentoController } from './painel-conhecimento.controller.js';
import {
  JOB_REINDEXAR,
  PainelConhecimentoService,
} from './painel-conhecimento.service.js';
import { DadosPropor, PropostasService } from './propostas.service.js';

/**
 * Conhecimento: pesquisa do agente (`procurar_conhecimento`), leitura das
 * fontes, alterações, contradições e o painel.
 *
 * Jobs: `ingestao_fontes` (03:00 e "Ler agora"), `propor_respostas` (depois
 * de uma alteração com respostas afetadas), `detetar_contradicoes` (depois
 * de uma ingestão com mudanças) e `reindexar_embeddings` (manual).
 */
@Module({
  controllers: [PainelConhecimentoController],
  providers: [
    ConhecimentoService,
    EmbeddingsService,
    IndexacaoService,
    IngestaoService,
    PropostasService,
    ContradicoesService,
    PainelConhecimentoService,
  ],
  exports: [ConhecimentoService, EmbeddingsService],
})
export class ConhecimentoModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly conhecimento: ConhecimentoService,
    private readonly conversas: ConversasService,
    private readonly jobs: JobsService,
    private readonly ingestao: IngestaoService,
    private readonly propostas: PropostasService,
    private readonly contradicoes: ContradicoesService,
    private readonly indexacao: IndexacaoService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ...ferramentasConhecimento(this.conhecimento, this.conversas),
    );

    // Uma ingestão de cada vez: duas leituras da mesma fonte em paralelo só
    // gastavam pedidos (a transação já as serializa).
    this.jobs.trabalhar<DadosIngestao>(
      JOB_INGESTAO,
      (d) => this.ingestao.correr(d),
      { concorrencia: 1 },
    );
    this.jobs.agendar(JOB_INGESTAO, '0 3 * * *');
    this.jobs.trabalhar<DadosPropor>(JOB_PROPOR, (d) =>
      this.propostas.correr(d),
    );
    this.jobs.trabalhar<DadosContradicoes>(
      JOB_CONTRADICOES,
      async (d) => {
        await this.contradicoes.correr(d);
      },
      { concorrencia: 1 },
    );
    this.jobs.trabalhar<DadosReindexar>(
      JOB_REINDEXAR,
      async (d) => {
        await this.indexacao.reindexar(d);
      },
      { concorrencia: 1 },
    );
  }
}
