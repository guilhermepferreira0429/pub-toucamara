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
          'Só para uma reclamação FORMAL (registada pela câmara, com prazo de resposta; não é o Livro de Reclamações oficial nem o substitui) sobre um serviço, funcionário ou atendimento da câmara; não para problemas na rua (registar_ocorrencia), pedidos ou dúvidas. Se não for claro, pergunta. ' +
          'Pergunta o nome, o serviço, o que aconteceu e o que pede. Fica com número e prazo legal de resposta.',
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
