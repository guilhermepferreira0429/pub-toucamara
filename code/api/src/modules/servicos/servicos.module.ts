import { Module, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { ferramenta } from '../../ferramentas/ferramenta.js';
import { RegistoFerramentas } from '../../ferramentas/registo-ferramentas.service.js';
import { LISTA_AREAS, RegistoServicos } from '../../ferramentas/servicos.js';
import { respostaCatalogo, respostaPedido } from './catalogo.js';

const area = z.enum(LISTA_AREAS as [string, ...string[]]).describe('A área.');

export const entradaOutrosServicos = z.object({
  area: area.optional(),
});

export const entradaPedirServico = z.object({
  area,
  acao: z.string().min(2).describe('A ação, como em outros_servicos.'),
  dados: z
    .array(
      z.object({
        campo: z.string().describe('Como em outros_servicos.'),
        valor: z.string().describe('Datas AAAA-MM-DD, horas HH:MM, sim/não.'),
      }),
    )
    .describe('Os campos da ação (vazia se não tiver).'),
});

/**
 * O catálogo de serviços municipais (V4) em duas ferramentas, para não pesar
 * no agente de voz: cada módulo regista as suas ações em RegistoServicos
 * (ferramentas/servicos.ts).
 */
@Module({})
export class ServicosModule implements OnModuleInit {
  constructor(
    private readonly registo: RegistoFerramentas,
    private readonly servicos: RegistoServicos,
  ) {}

  onModuleInit() {
    this.registo.registar(
      ferramenta({
        nome: 'outros_servicos',
        descricao:
          'Escolas, reservas, estacionamento, habitação municipal, cemitérios, animais, água. Sem área: as ações de cada área; com área: os campos a perguntar.',
        entrada: entradaOutrosServicos,
        executar: (_ctx, e) =>
          Promise.resolve(respostaCatalogo(this.servicos, e.area)),
      }),
      ferramenta({
        nome: 'pedir_servico',
        descricao:
          'Corre uma ação de outros_servicos. Se faltar ou estiver mal um campo, devolve em_falta/invalidos.',
        entrada: entradaPedirServico,
        executar: (ctx, e) =>
          respostaPedido(this.servicos, ctx, e.area, e.acao, e.dados),
      }),
    );
  }
}
