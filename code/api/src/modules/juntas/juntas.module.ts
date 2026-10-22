import { Module, OnModuleInit } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { z } from 'zod';
import { validar } from '../../common/validacao.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import {
  type AreaServico,
  RegistoServicos,
  servico,
} from '../../ferramentas/servicos.js';
import { respostaCatalogo, respostaPedido } from '../servicos/catalogo.js';
import {
  AREA_JUNTA,
  decidirFerramenta,
  DESCRICAO_AREA_JUNTA,
} from './funcionalidades.js';
import { FuncionalidadesInterceptor } from './funcionalidades.interceptor.js';
import {
  AtestadosPainelController,
  AtestadosPublicoController,
  JuntasPainelController,
  JuntasPublicoController,
} from './juntas.controller.js';
import { JuntasDemoService } from './juntas.demo.js';
import { JuntasService } from './juntas.service.js';

/**
 * A área `junta` ainda não está em AREAS (ferramentas/servicos.ts): o tipo
 * aceita-a aqui e o filtro abaixo trata `outros_servicos`/`pedir_servico`
 * com area = 'junta' antes da validação do enum.
 */
const AREA = AREA_JUNTA as AreaServico;

const campoNome = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .describe('Nome completo da pessoa para quem é o atestado.');
const campoMorada = z
  .string()
  .trim()
  .min(5)
  .max(300)
  .describe('Morada completa (rua, número, lugar).');
const campoFreguesia = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .optional()
  .describe('De que freguesia é a morada?');
const campoFinalidade = z
  .string()
  .trim()
  .max(200)
  .optional()
  .describe('Para que é o atestado (ex.: escola, banco, Segurança Social)?');

const entradaPedirJunta = z.object({
  area: z.literal(AREA_JUNTA),
  acao: z.string().min(2),
  dados: z
    .array(z.object({ campo: z.string(), valor: z.string() }))
    .default([]),
});

const entradaOutrosJunta = z.object({ area: z.literal(AREA_JUNTA) });

/**
 * Versão para juntas de freguesia (FUN §14): a junta é um município com
 * tipo 'junta' (migração 0090) e reusa o agente, o chat, o conhecimento,
 * as ocorrências e o painel. Aqui: as ações da junta no catálogo de
 * serviços, os atestados no painel, o PDF e a página do SMS, as feature
 * flags por tipo (painel e agente) e a junta de demonstração.
 */
@Module({
  controllers: [
    AtestadosPainelController,
    JuntasPainelController,
    AtestadosPublicoController,
    JuntasPublicoController,
  ],
  providers: [
    JuntasService,
    JuntasDemoService,
    { provide: APP_INTERCEPTOR, useClass: FuncionalidadesInterceptor },
  ],
  exports: [JuntasService, JuntasDemoService],
})
export class JuntasModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly servicos: RegistoServicos,
    private readonly juntas: JuntasService,
  ) {}

  onModuleInit() {
    this.servicos.registar(
      servico({
        area: AREA,
        acao: 'pedir_atestado',
        titulo: 'Atestado de residência, agregado ou situação económica',
        quando:
          'Quando pede um atestado da junta; na câmara, encaminha para a junta da freguesia da morada.',
        altera: true,
        entrada: z.object({
          tipo: z
            .enum(['residencia', 'agregado_familiar', 'situacao_economica'])
            .describe(
              'Que atestado: residência, agregado familiar ou situação económica?',
            ),
          nome: campoNome,
          morada: campoMorada,
          freguesia: campoFreguesia,
          finalidade: campoFinalidade,
          agregado: z
            .array(z.string())
            .optional()
            .describe(
              'Só no agregado familiar: quem vive consigo, nome e parentesco de cada um.',
            ),
          rendimento_mensal: z
            .number()
            .min(0)
            .optional()
            .describe(
              'Só na situação económica: rendimento mensal do agregado, em euros.',
            ),
        }),
        executar: (ctx, e) => this.juntas.pedir(ctx, e),
      }),
      servico({
        area: AREA,
        acao: 'prova_de_vida',
        titulo: 'Prova de vida para a pensão',
        quando:
          'Quando precisa da prova de vida (para a pensão) passada pela junta.',
        altera: true,
        entrada: z.object({
          nome: campoNome,
          morada: campoMorada,
          freguesia: campoFreguesia,
          entidade_pensao: z
            .string()
            .trim()
            .max(120)
            .optional()
            .describe(
              'Para que entidade é (ex.: Segurança Social, CGA, pensão estrangeira)?',
            ),
          pode_deslocar: z
            .boolean()
            .optional()
            .describe(
              'Consegue ir à junta? (se não, a junta combina a visita)',
            ),
        }),
        executar: (ctx, e) =>
          this.juntas.pedir(ctx, { ...e, tipo: 'prova_vida' }),
      }),
      servico({
        area: AREA,
        acao: 'estado_atestado',
        titulo: 'Em que ponto está o meu atestado',
        quando:
          'Quando pergunta pelo atestado ou pela prova de vida que pediu.',
        entrada: z.object({
          numero: z
            .string()
            .trim()
            .max(20)
            .optional()
            .describe('O número do pedido (ex.: AT 12/2026), se o tiver.'),
        }),
        executar: (ctx, e) => this.juntas.estado(ctx, e.numero),
      }),
    );

    this.registo.filtrar((nome, ctx, entrada) =>
      this.filtro(nome, ctx, entrada),
    );
  }

  /** Feature flags do agente por tipo de município (ver funcionalidades.ts). */
  private async filtro(
    nome: string,
    ctx: ContextoFerramenta,
    entrada: unknown,
  ): Promise<unknown> {
    switch (decidirFerramenta(ctx.municipio.tipo, nome, entrada)) {
      case 'seguir':
        return undefined;
      case 'so_camara':
        return this.juntas.respostaSoCamara(ctx);
      case 'catalogo_junta':
        return {
          ...respostaCatalogo(this.servicos),
          areas: [this.areaJunta()],
        };
      case 'catalogo_camara': {
        const r = respostaCatalogo(this.servicos);
        const camara = await this.juntas.camaraDe(ctx.municipio);
        const temJuntas =
          (await this.juntas.juntasDoConcelho(camara.id)).length > 0;
        return temJuntas
          ? { ...r, areas: [...(r.areas ?? []), this.areaJunta()] }
          : r;
      }
      case 'area_junta':
        if (nome === 'outros_servicos') {
          validar(entradaOutrosJunta, entrada);
          return respostaCatalogo(this.servicos, AREA_JUNTA);
        } else {
          const e = validar(entradaPedirJunta, entrada);
          return respostaPedido(this.servicos, ctx, e.area, e.acao, e.dados);
        }
    }
  }

  private areaJunta() {
    return {
      area: AREA_JUNTA,
      o_que_e: DESCRICAO_AREA_JUNTA,
      acoes: this.servicos
        .daArea(AREA)
        .map((s) => ({ acao: s.acao, titulo: s.titulo })),
    };
  }
}
