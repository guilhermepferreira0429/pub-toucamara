import type Anthropic from '@anthropic-ai/sdk';
import { HttpStatus } from '@nestjs/common';
import { ErroApi } from '../common/erros.js';
import {
  AbrirFluxo,
  correrTurno,
  EventoAgente,
  FluxoMensagem,
  OpcoesTurno,
  paraEco,
} from './agente-chat.js';

type Bloco = Anthropic.Beta.BetaContentBlock;
type Evento = Anthropic.Beta.BetaRawMessageStreamEvent;

/** Uma resposta simulada: os blocos finais e o stop_reason. */
interface Volta {
  blocos: Bloco[];
  stop: Anthropic.Beta.BetaStopReason;
}

const texto = (t: string): Bloco => ({
  type: 'text',
  text: t,
  citations: null,
});
const usar = (id: string, name: string, input: unknown): Bloco => ({
  type: 'tool_use',
  id,
  name,
  input,
});

/** Eventos de streaming coerentes com os blocos (só o que o loop lê). */
function eventos(blocos: Bloco[]): Evento[] {
  return blocos.flatMap((b, index) => {
    if (b.type === 'text') {
      return [
        {
          type: 'content_block_start',
          index,
          content_block: { ...b, text: '' },
        },
        {
          type: 'content_block_delta',
          index,
          delta: { type: 'text_delta', text: b.text },
        },
      ] as Evento[];
    }
    return [
      { type: 'content_block_start', index, content_block: b },
    ] as Evento[];
  });
}

/** Cliente simulado: devolve as voltas por ordem e guarda os pedidos. */
function simulado(voltas: Volta[]) {
  const pedidos: Anthropic.Beta.BetaMessageParam[][] = [];
  const params: Record<string, unknown>[] = [];
  const abrir: AbrirFluxo = (p) => {
    // Cópia: o loop continua a acrescentar ao mesmo array.
    pedidos.push(structuredClone(p.messages));
    params.push(p as unknown as Record<string, unknown>);
    const v = voltas.shift();
    if (!v) throw new Error('Pedido a mais ao modelo.');
    const fluxo: FluxoMensagem = {
      async *[Symbol.asyncIterator]() {
        for (const e of eventos(v.blocos)) yield await Promise.resolve(e);
      },
      finalMessage: () =>
        Promise.resolve({
          content: v.blocos,
          stop_reason: v.stop,
        } as Anthropic.Beta.BetaMessage),
    };
    return fluxo;
  };
  return { abrir, pedidos, params };
}

function opcoes(
  abrir: AbrirFluxo,
  extra: Partial<OpcoesTurno> = {},
): OpcoesTurno & { eventos: EventoAgente[] } {
  const ev: EventoAgente[] = [];
  return {
    abrir,
    modelo: 'claude-sonnet-5-5',
    sistema: [{ type: 'text', text: 'sistema' }],
    ferramentas: [],
    mensagens: [{ role: 'user', content: 'Olá' }],
    executar: () => Promise.resolve({ ok: true }),
    emitir: (e) => ev.push(e),
    sinal: new AbortController().signal,
    eventos: ev,
    ...extra,
  };
}

describe('correrTurno', () => {
  it('responde só com texto e acaba no end_turn', async () => {
    const c = simulado([{ blocos: [texto('Bom dia!')], stop: 'end_turn' }]);
    const o = opcoes(c.abrir);
    const r = await correrTurno(o);
    expect(r).toEqual({ texto: 'Bom dia!', fim: 'concluido' });
    expect(o.eventos).toEqual([{ tipo: 'texto', texto: 'Bom dia!' }]);
    expect(c.params[0]).toMatchObject({
      tool_choice: { type: 'auto' },
      output_config: { effort: 'low' },
      fallbacks: 'default',
    });
    expect(c.params[0]).not.toHaveProperty('thinking');
  });

  it('corre todas as ferramentas da volta e devolve os resultados numa só mensagem', async () => {
    const c = simulado([
      {
        blocos: [
          usar('t1', 'procurar_conhecimento', { pergunta: 'obras' }),
          usar('t2', 'encaminhar', { assunto: 'água' }),
        ],
        stop: 'tool_use',
      },
      { blocos: [texto('Segundo o RJUE...')], stop: 'end_turn' },
    ]);
    const chamadas: string[] = [];
    const o = opcoes(c.abrir, {
      executar: (nome) => {
        chamadas.push(nome);
        if (nome === 'encaminhar') {
          return Promise.reject(
            new ErroApi(HttpStatus.NOT_FOUND, 'sem_regra', 'Sem regra.'),
          );
        }
        return Promise.resolve({ sem_fonte: false });
      },
    });

    const r = await correrTurno(o);

    expect(r).toEqual({ texto: 'Segundo o RJUE...', fim: 'concluido' });
    expect(chamadas).toEqual(['procurar_conhecimento', 'encaminhar']);
    const segundo = c.pedidos[1];
    expect(segundo).toHaveLength(3);
    expect(segundo[1].role).toBe('assistant');
    expect(segundo[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't1',
          content: JSON.stringify({ sem_fonte: false }),
        },
        {
          type: 'tool_result',
          tool_use_id: 't2',
          is_error: true,
          content: JSON.stringify({
            erro: { codigo: 'sem_regra', mensagem: 'Sem regra.' },
          }),
        },
      ],
    });
    expect(o.eventos.filter((e) => e.tipo === 'ferramenta')).toEqual([
      { tipo: 'ferramenta', nome: 'procurar_conhecimento' },
      { tipo: 'ferramenta', nome: 'encaminhar' },
    ]);
    expect(
      o.eventos.filter((e) => e.tipo === 'resultado').map((e) => e.erro),
    ).toEqual([false, true]);
  });

  it('erro inesperado numa ferramenta volta ao modelo como erro_interno', async () => {
    const c = simulado([
      { blocos: [usar('t1', 'marcar', {})], stop: 'tool_use' },
      { blocos: [texto('Desculpe.')], stop: 'end_turn' },
    ]);
    const o = opcoes(c.abrir, {
      executar: () => Promise.reject(new Error('ligação à BD caiu')),
    });
    await correrTurno(o);
    const res = (
      c.pedidos[1][2].content as Anthropic.Beta.BetaToolResultBlockParam[]
    )[0];
    expect(res.is_error).toBe(true);
    const corpo = JSON.parse(res.content as string) as {
      erro: { codigo: string };
    };
    expect(corpo.erro.codigo).toBe('erro_interno');
  });

  it('continua depois de pause_turn sem correr ferramentas', async () => {
    const c = simulado([
      { blocos: [texto('A ver...')], stop: 'pause_turn' },
      { blocos: [texto('Pronto.')], stop: 'end_turn' },
    ]);
    const o = opcoes(c.abrir);
    const r = await correrTurno(o);
    expect(r.texto).toBe('A ver...\n\nPronto.');
    expect(c.pedidos[1][1]).toEqual({
      role: 'assistant',
      content: [texto('A ver...')],
    });
    // O separador entre voltas também vai para o ecrã.
    expect(o.eventos.map((e) => (e.tipo === 'texto' ? e.texto : ''))).toEqual([
      'A ver...',
      '\n\n',
      'Pronto.',
    ]);
  });

  it('numa recusa descarta o texto parcial', async () => {
    const c = simulado([{ blocos: [texto('Parcial')], stop: 'refusal' }]);
    const r = await correrTurno(opcoes(c.abrir));
    expect(r).toEqual({ texto: '', fim: 'recusa' });
  });

  it('não corre ferramentas de uma volta cortada por max_tokens', async () => {
    const c = simulado([
      { blocos: [usar('t1', 'marcar', { dia: '2026-' })], stop: 'max_tokens' },
    ]);
    const executar = jest.fn();
    const r = await correrTurno(opcoes(c.abrir, { executar }));
    expect(r.fim).toBe('cortado');
    expect(executar).not.toHaveBeenCalled();
  });

  it('para ao fim do limite de voltas', async () => {
    const voltas = Array.from({ length: 3 }, (_, i) => ({
      blocos: [usar(`t${i}`, 'ver_vagas', {})],
      stop: 'tool_use' as const,
    }));
    const c = simulado(voltas);
    const r = await correrTurno(opcoes(c.abrir, { maxIteracoes: 3 }));
    expect(r.fim).toBe('limite');
    expect(c.pedidos).toHaveLength(3);
  });

  it('não chama o modelo se a ligação já fechou', async () => {
    const c = simulado([]);
    const controlo = new AbortController();
    controlo.abort();
    const r = await correrTurno(opcoes(c.abrir, { sinal: controlo.signal }));
    expect(r.fim).toBe('interrompido');
    expect(c.pedidos).toHaveLength(0);
  });
});

describe('paraEco', () => {
  it('sem recurso devolve tudo', () => {
    const blocos = [texto('a'), usar('t1', 'x', {})];
    expect(paraEco(blocos)).toEqual(blocos);
  });

  it('depois de um recurso, antes da fronteira só passa texto', () => {
    const fallback = {
      type: 'fallback',
      from: { model: 'a' },
      to: { model: 'b' },
      trigger: { type: 'refusal' },
    } as unknown as Bloco;
    const pensamento = {
      type: 'thinking',
      thinking: '',
      signature: 's',
    } as Bloco;
    const r = paraEco([
      pensamento,
      texto('antes'),
      usar('t0', 'x', {}),
      fallback,
      usar('t1', 'y', {}),
    ]);
    expect(r.map((b) => b.type)).toEqual(['text', 'fallback', 'tool_use']);
  });
});
