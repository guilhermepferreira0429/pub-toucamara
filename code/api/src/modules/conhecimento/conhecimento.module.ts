import { Module, OnModuleInit } from '@nestjs/common';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ConversasService } from '../conversas/conversas.service.js';
import { LinguagemSimplesModule } from '../linguagem-simples/linguagem-simples.module.js';
import { LinguagemSimplesService } from '../linguagem-simples/linguagem-simples.service.js';
import { AvaliacaoPublicaController } from './avaliacao-publica.controller.js';
import { AvaliacaoService } from './avaliacao.service.js';
import { ferramentasConhecimento } from './conhecimento.ferramentas.js';
import { EdicaoService } from './edicao.service.js';
import { ConhecimentoService } from './conhecimento.service.js';
import {
  ContradicoesService,
  DadosContradicoes,
} from './contradicoes.service.js';
import { DescarregadorService } from './descarregador.service.js';
import {
  DadosDescobrir,
  DescobertaService,
  JOB_DESCOBRIR,
} from './descoberta.service.js';
import { EmbeddingsService } from './embeddings.service.js';
import { DadosReindexar, IndexacaoService } from './indexacao.service.js';
import {
  DadosIngestao,
  IngestaoService,
  JOB_CONTRADICOES,
  JOB_INGESTAO,
  JOB_PROPOR,
  JOB_RECOLHA_TICK,
} from './ingestao.service.js';
import {
  DadosMelhorias,
  JOB_MELHORIAS,
  MelhoriasService,
} from './melhorias.service.js';
import { PainelConhecimentoController } from './painel-conhecimento.controller.js';
import { PainelRecolhaController } from './painel-recolha.controller.js';
import { PainelRecolhaService } from './painel-recolha.service.js';
import {
  JOB_REINDEXAR,
  PainelConhecimentoService,
} from './painel-conhecimento.service.js';
import { DadosPropor, PropostasService } from './propostas.service.js';

/**
 * Conhecimento: pesquisa do agente (`procurar_conhecimento`), leitura das
 * fontes, alterações, contradições e o painel.
 *
 * Jobs: `recolha_tick` (de 5 em 5 minutos: fontes vencidas à hora de recolha
 * do município e sites a descobrir), `ingestao_fontes` (do tick e "Ler
 * agora"), `descobrir_site` (páginas novas de um site), `propor_respostas` (depois
 * de uma alteração com respostas afetadas), `detetar_contradicoes` (depois
 * de uma ingestão com mudanças), `reindexar_embeddings` (manual) e
 * `propor_melhorias` (segunda 07:00, antes do relatório semanal das 08:00, e
 * "Gerar agora" no painel).
 */
@Module({
  // As versões em linguagem simples publicadas entram no resultado de
  // procurar_conhecimento (link da página com o resumo e o texto oficial).
  imports: [LinguagemSimplesModule],
  controllers: [
    PainelConhecimentoController,
    PainelRecolhaController,
    AvaliacaoPublicaController,
  ],
  providers: [
    ConhecimentoService,
    EmbeddingsService,
    IndexacaoService,
    IngestaoService,
    DescarregadorService,
    DescobertaService,
    PropostasService,
    ContradicoesService,
    PainelConhecimentoService,
    PainelRecolhaService,
    AvaliacaoService,
    EdicaoService,
    MelhoriasService,
  ],
  exports: [ConhecimentoService, EmbeddingsService, MelhoriasService],
})
export class ConhecimentoModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly conhecimento: ConhecimentoService,
    private readonly conversas: ConversasService,
    private readonly jobs: JobsService,
    private readonly ingestao: IngestaoService,
    private readonly descoberta: DescobertaService,
    private readonly propostas: PropostasService,
    private readonly contradicoes: ContradicoesService,
    private readonly indexacao: IndexacaoService,
    private readonly melhorias: MelhoriasService,
    private readonly simples: LinguagemSimplesService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ...ferramentasConhecimento(
        this.conhecimento,
        this.conversas,
        this.simples,
      ),
    );

    // Uma ingestão de cada vez: duas leituras da mesma fonte em paralelo só
    // gastavam pedidos (a transação já as serializa).
    this.jobs.trabalhar<DadosIngestao>(
      JOB_INGESTAO,
      (d) => this.ingestao.correr(d),
      { concorrencia: 1 },
    );
    // A hora de cada município (municipios.hora_recolha) decide quando as
    // fontes vencem; o tick só olha de 5 em 5 minutos.
    this.jobs.trabalhar(
      JOB_RECOLHA_TICK,
      async () => {
        await this.ingestao.tick();
        for (const site_id of await this.descoberta.vencidos()) {
          await this.jobs.enviar(
            JOB_DESCOBRIR,
            { site_id },
            { singletonKey: `descobrir:${site_id}` },
          );
        }
      },
      { concorrencia: 1 },
    );
    this.jobs.agendar(JOB_RECOLHA_TICK, '*/5 * * * *');
    this.jobs.trabalhar<DadosDescobrir>(
      JOB_DESCOBRIR,
      async (d) => {
        // Páginas novas: lêem-se já, sem esperar pelo tick.
        const r = await this.descoberta.descobrir(d.site_id);
        if (r.novas > 0 && r.municipio_id) {
          await this.jobs.enviar(
            JOB_INGESTAO,
            { municipio_id: r.municipio_id },
            { singletonKey: `ingestao:${r.municipio_id}` },
          );
        }
      },
      { concorrencia: 1 },
    );
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
    this.jobs.trabalhar<DadosMelhorias>(
      JOB_MELHORIAS,
      (d) => this.melhorias.correr(d),
      { concorrencia: 1 },
    );
    this.jobs.agendar(JOB_MELHORIAS, '0 7 * * 1');
  }
}
