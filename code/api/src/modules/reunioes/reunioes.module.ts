import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { JobsService } from '../../jobs/jobs.service.js';
import { ConhecimentoModule } from '../conhecimento/conhecimento.module.js';
import {
  DeliberacoesService,
  entradaProcurarDeliberacoes,
} from './deliberacoes.service.js';
import {
  AtasPublicoController,
  DeliberacoesPublicoController,
  ReunioesPainelController,
} from './reunioes.controller.js';
import { FILA_TRANSCREVER, ReunioesService } from './reunioes.service.js';

/**
 * Reuniões de câmara e assembleia: atas feitas a partir da gravação (ou da
 * transcrição em texto), aprovação, PDF e publicação; as deliberações
 * publicadas ficam pesquisáveis no painel, na página pública e pelo agente.
 */
@Module({
  imports: [ConhecimentoModule],
  controllers: [
    ReunioesPainelController,
    DeliberacoesPublicoController,
    AtasPublicoController,
  ],
  providers: [ReunioesService, DeliberacoesService],
  exports: [ReunioesService, DeliberacoesService],
})
export class ReunioesModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly jobs: JobsService,
    private readonly reunioes: ReunioesService,
    private readonly deliberacoes: DeliberacoesService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'procurar_deliberacoes',
        descricao:
          'Quando pergunta se a câmara ou a assembleia já decidiu algo: as deliberações das atas publicadas, com a data, o órgão e o resultado (o PDF da ata em ata_pdf, se quiser ler).',
        entrada: entradaProcurarDeliberacoes,
        executar: (ctx, e) => this.deliberacoes.ferramenta(ctx, e),
      }),
    );
    this.jobs.trabalhar<{ reuniao_id: string }>(FILA_TRANSCREVER, async (d) => {
      await this.reunioes.transcreverGravacao(d.reuniao_id);
    });
  }
}
