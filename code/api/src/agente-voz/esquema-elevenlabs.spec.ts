import { z } from 'zod';
import { entradaJuntarFamiliar } from '../modules/chamadas-saida/juncao-familiar.service.js';
import { entradaRedigir } from '../modules/chat/chat.ferramentas.js';
import { entradaConsultasAbertas } from '../modules/consultas-publicas/consultas-publicas.service.js';
import { entradaEsplanada } from '../modules/licencas/regras-esplanada.js';
import { entradaOQuePossoFazer } from '../modules/ordenamento/ordenamento.service.js';
import {
  converterZod,
  validarElevenLabs,
  LiteralEl,
  ListaEl,
  ObjetoEl,
} from './esquema-elevenlabs.js';

const prop = (o: ObjetoEl | null, k: string) => o!.properties[k];

describe('converter zod → esquema do ElevenLabs', () => {
  it('enums, opcionais, nullable e valores por omissão', () => {
    const { esquema, avisos } = converterZod(
      'teste',
      z.object({
        tipo: z.enum(['a', 'b']).describe('O tipo.'),
        nota: z.string().optional().describe('Uma nota.'),
        nome: z.string().nullish().describe('Nome, se o disse.'),
        limite: z.number().int().min(1).max(10).default(3).describe('Quantos.'),
        sim: z.boolean().describe('Sim ou não.'),
      }),
    );
    expect(avisos).toEqual([]);
    expect(esquema!.required).toEqual(['tipo', 'sim']);
    expect(prop(esquema, 'tipo')).toEqual({
      type: 'string',
      description: 'O tipo.',
      enum: ['a', 'b'],
    });
    expect(prop(esquema, 'nome')).toEqual({
      type: 'string',
      description: 'Nome, se o disse.',
    });
    // Mínimos, máximos e omissões não existem no ElevenLabs.
    expect(prop(esquema, 'limite')).toEqual({
      type: 'integer',
      description: 'Quantos.',
    });
    expect(validarElevenLabs(esquema!)).toEqual([]);
  });

  it('listas de objetos e objetos dentro de objetos', () => {
    const { esquema } = converterZod(
      'teste',
      z.object({
        itens: z
          .array(
            z.object({
              item: z.string().describe('O quê.'),
              qtd: z.number().int().describe('Quantos.'),
            }),
          )
          .describe('Os itens.'),
        local: z
          .object({ rua: z.string().describe('Rua.') })
          .optional()
          .describe('Onde.'),
        etiquetas: z.array(z.string()).describe('Etiquetas.'),
      }),
    );
    const itens = prop(esquema, 'itens') as ListaEl;
    expect(itens.type).toBe('array');
    expect((itens.items as ObjetoEl).required).toEqual(['item', 'qtd']);
    expect((prop(esquema, 'local') as ObjetoEl).properties.rua).toEqual({
      type: 'string',
      description: 'Rua.',
    });
    // Itens simples herdam uma descrição (o ElevenLabs pede uma fonte de valor).
    expect(
      ((prop(esquema, 'etiquetas') as ListaEl).items as LiteralEl).description,
    ).toBeTruthy();
    expect(validarElevenLabs(esquema!)).toEqual([]);
  });

  it('avisa do que não se consegue exprimir', () => {
    const { esquema, avisos } = converterZod(
      'teste',
      z.object({
        campos: z.record(z.string(), z.string()).describe('Por chave.'),
        misto: z.union([z.string(), z.number()]).describe('Texto ou número.'),
        nivel: z.union([z.literal(1), z.literal(2)]).describe('Nível.'),
        sem: z.string(),
      }),
    );
    expect(avisos.map((a) => [a.caminho, a.nivel])).toEqual([
      ['campos', 'perda'],
      ['misto', 'perda'],
      ['nivel', 'perda'],
      ['sem', 'nota'],
    ]);
    expect(prop(esquema, 'campos')).toEqual({
      type: 'object',
      description: 'Por chave.',
      properties: {},
    });
    expect((prop(esquema, 'nivel') as LiteralEl).description).toContain('1, 2');
    expect((prop(esquema, 'sem') as LiteralEl).description).toBe('sem');
    expect(validarElevenLabs(esquema!)).toEqual([]);
  });

  it('uniões de textos fixos passam a enum; datas levam a dica do formato', () => {
    const { esquema } = converterZod(
      'teste',
      z.object({
        quando: z
          .union([z.literal('hoje'), z.literal('amanha')])
          .describe('Quando.'),
        dia: z.iso.date().describe('O dia.'),
      }),
    );
    expect(prop(esquema, 'quando')).toEqual({
      type: 'string',
      description: 'Quando.',
      enum: ['hoje', 'amanha'],
    });
    expect((prop(esquema, 'dia') as LiteralEl).description).toBe(
      'O dia. Data no formato AAAA-MM-DD.',
    );
  });

  describe('ferramentas reais', () => {
    it('redigir: enum obrigatório e destinatário opcional', () => {
      const { esquema, avisos } = converterZod('redigir', entradaRedigir);
      expect(avisos).toEqual([]);
      expect((prop(esquema, 'tipo') as LiteralEl).enum).toEqual([
        'reclamacao',
        'email',
        'pedido',
      ]);
      expect(esquema!.required).toEqual(['tipo', 'assunto', 'factos']);
      expect(esquema!.required).not.toContain('destinatario');
    });

    it('juntar_familiar: o call_sid vem da variável do sistema e o modelo não o vê', () => {
      const { esquema } = converterZod(
        'juntar_familiar',
        entradaJuntarFamiliar,
      );
      expect(prop(esquema, 'call_sid')).toEqual({
        type: 'string',
        dynamic_variable: 'system__call_sid',
      });
      expect(esquema!.required).toEqual(['telefone', 'resumo']);
      expect(validarElevenLabs(esquema!)).toEqual([]);
    });

    it('sem parâmetros: vai sem corpo', () => {
      expect(
        converterZod('consultas_abertas', entradaConsultasAbertas).esquema,
      ).toBeNull();
    });

    it.each([
      ['o_que_posso_fazer', entradaOQuePossoFazer],
      ['pedir_licenca_esplanada', entradaEsplanada],
    ])('%s converte sem perdas', (nome, entrada) => {
      const { esquema, avisos } = converterZod(nome, entrada as z.ZodObject);
      expect(avisos.filter((a) => a.nivel === 'perda')).toEqual([]);
      expect(validarElevenLabs(esquema!)).toEqual([]);
    });
  });
});
