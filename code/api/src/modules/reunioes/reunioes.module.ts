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
          'Procura nas deliberações das reuniões de câmara e da assembleia municipal (só atas publicadas). ' +
          'Usa quando a pessoa pergunta se a câmara ou a assembleia já decidiu alguma coisa sobre um assunto ("a câmara já aprovou o parque?", "o que se decidiu sobre a taxa de resíduos?"). ' +
          'Diz o "dizer", com a data, o órgão e o resultado; se a pessoa quiser ler, dá o link do PDF da ata (ata_pdf). ' +
          'Se vier sem_resultados: true, diz que não encontraste deliberações publicadas sobre isso e não inventes decisões.',
        entrada: entradaProcurarDeliberacoes,
        executar: (ctx, e) => this.deliberacoes.ferramenta(ctx, e),
      }),
    );
    this.jobs.trabalhar<{ reuniao_id: string }>(FILA_TRANSCREVER, async (d) => {
      await this.reunioes.transcreverGravacao(d.reuniao_id);
    });
  }
}
