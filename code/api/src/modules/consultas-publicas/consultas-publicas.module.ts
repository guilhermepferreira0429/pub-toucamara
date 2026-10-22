import { Module, OnModuleInit } from '@nestjs/common';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { CampanhasService } from '../campanhas/campanhas.service.js';
import { OcorrenciasModule } from '../ocorrencias/ocorrencias.module.js';
import {
  ConsultasPublicasPainelController,
  ConsultasPublicasPublicoController,
} from './consultas-publicas.controller.js';
import {
  ConsultasPublicasService,
  entradaConsultasAbertas,
  entradaParticipar,
} from './consultas-publicas.service.js';

/**
 * Consulta pública por telefone, com resultados por freguesia. O agente
 * explica a consulta e regista a opinião (telefone, chat e porta das IAs);
 * a página pública deixa participar com o telemóvel. As chamadas a muita
 * gente são as campanhas de sempre (CampanhasService, sem estado próprio).
 */
@Module({
  imports: [OcorrenciasModule],
  controllers: [
    ConsultasPublicasPainelController,
    ConsultasPublicasPublicoController,
  ],
  providers: [ConsultasPublicasService, CampanhasService],
})
export class ConsultasPublicasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly consultas: ConsultasPublicasService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'consultas_abertas',
        descricao:
          'Quando pergunta por consultas públicas ou quer dar opinião sobre um projeto da câmara (ou numa chamada nossa sobre uma: vem desta_chamada): o que está em causa, as perguntas e opções, até quando, e se já participou.',
        // Também nas campanhas das consultas (a câmara liga a perguntar).
        agentes: ['entrada', 'saida', 'chat'],
        entrada: entradaConsultasAbertas,
        executar: (ctx) => this.consultas.consultasAbertas(ctx),
      }),
      ferramenta({
        nome: 'participar_consulta',
        descricao:
          'Depois de explicar a consulta e confirmar as respostas: regista a opção de cada pergunta, a opinião (se der) e a freguesia (ou a morada). Chamar outra vez substitui a anterior. ' +
          'Não digas o que os outros responderam.',
        agentes: ['entrada', 'saida', 'chat'],
        entrada: entradaParticipar,
        executar: (ctx, e) => this.consultas.participar(ctx, e),
      }),
    );
  }
}
