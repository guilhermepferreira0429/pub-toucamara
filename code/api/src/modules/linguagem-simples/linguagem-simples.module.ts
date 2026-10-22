import { Module, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { GlossarioService } from './glossario.service.js';
import {
  DocumentosPublicoController,
  GlossarioPainelController,
  GlossarioPublicoController,
  LinguagemSimplesPainelController,
} from './linguagem-simples.controller.js';
import { LinguagemSimplesService } from './linguagem-simples.service.js';

/**
 * Linguagem simples nos editais e regulamentos (FUN §14) e glossário
 * administrativo (CONC, ideia 5). Ferramentas do agente (chat e voz):
 * `explicar_termo` e `documento_simples`; o `procurar_conhecimento` junta
 * as versões simples publicadas das fontes que encontra (ConhecimentoModule).
 */
@Module({
  controllers: [
    LinguagemSimplesPainelController,
    GlossarioPainelController,
    DocumentosPublicoController,
    GlossarioPublicoController,
  ],
  providers: [LinguagemSimplesService, GlossarioService],
  exports: [LinguagemSimplesService, GlossarioService],
})
export class LinguagemSimplesModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly simples: LinguagemSimplesService,
    private readonly glossario: GlossarioService,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'explicar_termo',
        descricao:
          'Quando pergunta o que quer dizer uma palavra (alvará, deferimento tácito) ou tens de usar um termo técnico: a explicação simples do glossário da câmara.',
        entrada: z.object({
          termo: z
            .string()
            .trim()
            .min(2)
            .max(200)
            .describe('O termo, ou a pergunta da pessoa.'),
        }),
        executar: (ctx, e) =>
          this.glossario.explicar(ctx.municipio.id, e.termo),
      }),
      ferramenta({
        nome: 'documento_simples',
        descricao:
          'Quando pergunta o que diz um edital, regulamento, aviso ou deliberação: o resumo simples revisto pela câmara e o link. Não contradigas o texto oficial (é o que vale).',
        entrada: z.object({
          pesquisa: z
            .string()
            .trim()
            .min(2)
            .max(300)
            .describe('O documento ou o assunto.'),
        }),
        executar: (ctx, e) =>
          this.simples.paraAgente(ctx.municipio.id, e.pesquisa),
      }),
    );
  }
}
