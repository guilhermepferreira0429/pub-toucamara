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
          'Explica em linguagem simples um termo administrativo ou jurídico ("o que é a comunicação prévia?", "o que quer dizer deferimento tácito?", "o que é um alvará?"), pelo glossário da câmara. ' +
          'Usa quando a pessoa pergunta o que é ou o que quer dizer uma palavra, ou quando tens de usar um termo técnico. ' +
          'Diz a explicação por palavras simples, curta, como vem em "dizer"; se vier valores_de_demonstracao, diz que a explicação ainda está por validar pela câmara. ' +
          'Se vier encontrado: false, segue o "dizer" (não inventes a definição).',
        entrada: z.object({
          termo: z
            .string()
            .trim()
            .min(2)
            .max(200)
            .describe(
              'O termo, ou a pergunta da pessoa (ex.: "deferimento tácito" ou "o que é a audiência prévia").',
            ),
        }),
        executar: (ctx, e) =>
          this.glossario.explicar(ctx.municipio.id, e.termo),
      }),
      ferramenta({
        nome: 'documento_simples',
        descricao:
          'Procura a versão em linguagem simples (revista pela câmara) de um edital, regulamento, aviso ou deliberação, com o link da página que tem o resumo e o texto oficial completo. ' +
          'Usa quando a pessoa pergunta o que diz um edital ou regulamento ("o que diz o regulamento das esplanadas?", "explique-me o edital da feira"). ' +
          'Responde com base no resumo, por palavras simples, sem contradizer o texto oficial; diz que o que vale legalmente é o texto oficial e manda o link. ' +
          'Se vier encontrado: false, usa procurar_conhecimento.',
        entrada: z.object({
          pesquisa: z
            .string()
            .trim()
            .min(2)
            .max(300)
            .describe(
              'O documento ou o assunto (ex.: "regulamento das esplanadas").',
            ),
        }),
        executar: (ctx, e) =>
          this.simples.paraAgente(ctx.municipio.id, e.pesquisa),
      }),
    );
  }
}
