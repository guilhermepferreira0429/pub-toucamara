import Anthropic from '@anthropic-ai/sdk';
import { ErroApi } from '../../common/erros.js';
import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { UtilizadorPainel } from '../../common/pedido.js';
import { correrPergunta, EventoPergunta, OpcoesPergunta } from './loop.js';
import { resultados, simulado, texto, usar, Volta } from './modelo-simulado.js';
import { erroIa, PerguntasChefiaService } from './perguntas-chefia.service.js';
import {
  ConsultaGuardada,
  esquemaResponder,
  resolverResposta,
} from './resposta.js';

const responder = (input: Record<string, unknown> = {}) =>
  usar('r1', 'responder', {
    resposta: 'Há {1} processos de obras atrasados.',
    numeros_chave: [
      { rotulo: 'Atrasados', consulta: 'c1', campo: 'total', linha: null },
    ],
    tabela: null,
    sugestoes: [],
    sem_dados: false,
    ...input,
  });

/** Opções com consultas falsas: contar_processos devolve 7; "falha" dá erro. */
function opcoes(voltas: Volta[], extra: Partial<OpcoesPergunta> = {}) {
  const modelo = simulado(voltas);
  const guardadas: ConsultaGuardada[] = [];
  const eventos: EventoPergunta[] = [];
  const o: OpcoesPergunta = {
    abrir: modelo.abrir,
    modelo: 'claude-sonnet-5-5',
    sistema: [{ type: 'text', text: 'sistema' }],
    ferramentas: [],
    mensagem:
      'Hoje: ...\n\nPergunta: Quantos processos de obras estão atrasados?',
    consultar: (nome, entrada, inicio) => {
      const c: ConsultaGuardada = {
        id: `c${guardadas.length + 1}`,
        ferramenta: nome,
        parametros: entrada,
        resultado:
          nome === 'falha'
            ? null
            : {
                valores: { total: 7 },
                unidades: { total: 'processos' },
                fonte: 'Processos',
              },
        erro:
          nome === 'falha'
            ? { codigo: 'tipo_desconhecido', mensagem: 'Nenhum tipo.' }
            : null,
        ms: 1,
      };
      guardadas.push(c);
      inicio(c.id);
      return Promise.resolve(c);
    },
    responder: (entrada) => {
      const v = esquemaResponder.safeParse(entrada);
      if (!v.success) return { ok: false, erros: ['inválido'] };
      return resolverResposta(v.data, {
        pergunta: 'p',
        hoje: '2026-10-19',
        consultas: guardadas,
      });
    },
    emitir: (e) => eventos.push(e),
    sinal: new AbortController().signal,
    ...extra,
  };
  return { o, modelo, guardadas, eventos };
}

describe('correrPergunta', () => {
  it('pergunta → contar_processos → responder com o número da consulta', async () => {
    const { o, modelo, eventos } = opcoes([
      {
        blocos: [
          usar('t1', 'contar_processos', { tipo: 'obras', atrasados: true }),
        ],
        stop: 'tool_use',
      },
      { blocos: [responder()], stop: 'tool_use' },
    ]);
    const r = await correrPergunta(o);
    expect(r.fim).toBe('concluido');
    expect(r.voltas).toBe(2);
    expect(r.tokens).toBe(240);
    expect(r.resposta?.resposta).toBe('Há 7 processos de obras atrasados.');
    expect(r.resposta?.numeros_chave[0].valor).toBe(7);
    expect(eventos.map((e) => e.tipo)).toEqual([
      'consulta_inicio',
      'consulta_fim',
    ]);
    expect(modelo.params[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      tool_choice: { type: 'auto' },
      output_config: { effort: 'medium' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    expect(modelo.params[0]).not.toHaveProperty('thinking');
    const [res] = resultados(modelo.pedidos[1]);
    expect(res.tool_use_id).toBe('t1');
    expect(JSON.parse(res.content as string)).toMatchObject({
      consulta: 'c1',
      valores: { total: 7 },
    });
  });

  it('várias consultas na mesma volta voltam todas numa só mensagem', async () => {
    const { o, modelo } = opcoes([
      {
        blocos: [usar('t1', 'contar_processos', {}), usar('t2', 'falha', {})],
        stop: 'tool_use',
      },
      { blocos: [responder()], stop: 'tool_use' },
    ]);
    await correrPergunta(o);
    const res = resultados(modelo.pedidos[1]);
    expect(res.map((x) => [x.tool_use_id, x.is_error ?? false])).toEqual([
      ['t1', false],
      ['t2', true],
    ]);
    expect(JSON.parse(res[1].content as string)).toEqual({
      consulta: 'c2',
      erro: { codigo: 'tipo_desconhecido', mensagem: 'Nenhum tipo.' },
    });
  });

  it('referência errada no responder volta como erro e o modelo corrige', async () => {
    const { o, modelo } = opcoes([
      { blocos: [usar('t1', 'contar_processos', {})], stop: 'tool_use' },
      {
        blocos: [
          responder({
            numeros_chave: [
              { rotulo: 'X', consulta: 'c7', campo: 'total', linha: null },
            ],
          }),
        ],
        stop: 'tool_use',
      },
      { blocos: [responder()], stop: 'tool_use' },
    ]);
    const r = await correrPergunta(o);
    expect(r.fim).toBe('concluido');
    expect(r.voltas).toBe(3);
    const [erro] = resultados(modelo.pedidos[2]);
    expect(erro.is_error).toBe(true);
    expect(erro.content).toContain('A consulta \\"c7\\" não existe.');
  });

  it('acabar só com texto: pede a ferramenta responder', async () => {
    const { o, modelo } = opcoes([
      { blocos: [usar('t1', 'contar_processos', {})], stop: 'tool_use' },
      { blocos: [texto('São 7.')], stop: 'end_turn' },
      { blocos: [responder()], stop: 'tool_use' },
    ]);
    const r = await correrPergunta(o);
    expect(r.fim).toBe('concluido');
    const ultimo = modelo.pedidos[2];
    const pedido = ultimo[ultimo.length - 1];
    expect(pedido.role).toBe('user');
    expect(pedido.content).toContain('ferramenta responder');
  });

  it('para ao fim de 6 voltas', async () => {
    const voltas = Array.from({ length: 10 }, (_, i) => ({
      blocos: [usar(`t${i}`, 'contar_processos', {})],
      stop: 'tool_use' as const,
    }));
    const { o, modelo } = opcoes(voltas);
    const r = await correrPergunta(o);
    expect(r.fim).toBe('limite');
    expect(r.resposta).toBeNull();
    expect(modelo.pedidos).toHaveLength(6);
  });

  it('recusa e max_tokens acabam sem correr consultas', async () => {
    const recusa = opcoes([
      { blocos: [usar('t1', 'contar_processos', {})], stop: 'refusal' },
    ]);
    const consultar = jest.fn();
    expect((await correrPergunta({ ...recusa.o, consultar })).fim).toBe(
      'recusa',
    );
    const cortado = opcoes([
      { blocos: [usar('t1', 'contar_processos', {})], stop: 'max_tokens' },
    ]);
    expect((await correrPergunta({ ...cortado.o, consultar })).fim).toBe(
      'cortado',
    );
    expect(consultar).not.toHaveBeenCalled();
  });

  it('não chama o modelo se a ligação já fechou', async () => {
    const controlo = new AbortController();
    controlo.abort();
    const { o, modelo } = opcoes([], { sinal: controlo.signal });
    expect((await correrPergunta(o)).fim).toBe('interrompido');
    expect(modelo.pedidos).toHaveLength(0);
  });

  it('erros da API sobem (o serviço passa-os a 503/502)', async () => {
    const { o } = opcoes([]);
    const erro = new Anthropic.InternalServerError(
      500,
      undefined,
      'x',
      new Headers(),
    );
    await expect(
      correrPergunta({
        ...o,
        abrir: () => {
          throw erro;
        },
      }),
    ).rejects.toBe(erro);
    expect(erroIa(erro)).toMatchObject({ codigo: 'ia_indisponivel' });
    expect(
      erroIa(new Anthropic.BadRequestError(400, undefined, 'x', new Headers())),
    ).toMatchObject({
      codigo: 'ia_erro',
    });
    const proprio = new ErroApi(HttpStatus.BAD_REQUEST, 'x', 'x');
    expect(erroIa(proprio)).toBe(proprio);
  });
});

/** O código do ErroApi que a função lança (null se não lançar). */
function codigoDe(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as ErroApi).codigo;
  }
}

describe('PerguntasChefiaService.preparar', () => {
  const u = { id: 'u1' } as UtilizadorPainel;
  const servico = (apiKey: string) =>
    new PerguntasChefiaService(
      {
        getOrThrow: () => ({ apiKey, modelo: 'claude-sonnet-5-5' }),
      } as unknown as ConfigService,
      null as never,
      null as never,
      null as never,
      null as never,
    );

  it('sem IA: 503 ia_indisponivel', () => {
    expect(codigoDe(() => servico('').preparar(u))).toBe('ia_indisponivel');
  });

  it('30 perguntas por hora por utilizador', () => {
    const s = servico('chave-falsa');
    for (let i = 0; i < 30; i++) s.preparar(u);
    expect(codigoDe(() => s.preparar(u))).toBe('demasiados_pedidos');
    // Outro utilizador não conta para o mesmo limite.
    expect(() => s.preparar({ id: 'u2' } as UtilizadorPainel)).not.toThrow();
  });
});
