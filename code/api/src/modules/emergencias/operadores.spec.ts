import { ErroApi } from '../../common/erros';
import {
  CellBroadcast,
  CellBroadcastReal,
  CellBroadcastSimulado,
  cellBroadcastDoAmbiente,
  FonteOperadores,
  FonteOperadoresReal,
  FonteOperadoresSimulada,
  fonteOperadoresDoAmbiente,
  MENSAGEM_POR_CONFIGURAR_CELL_BROADCAST,
  MENSAGEM_POR_CONFIGURAR_OPERADORES,
  opcoesSimulada,
} from './operadores';

const pedido = {
  municipioId: 'mun-1',
  zona: { geo: null, freguesias: ['Azurém'] },
};
const ambiente =
  (v: Record<string, string>) =>
  (n: string): string =>
    v[n] ?? '';

/** O erro com que a promessa é recusada. */
async function recusa(p: Promise<unknown>): Promise<ErroApi> {
  try {
    await p;
  } catch (e) {
    return e as ErroApi;
  }
  throw new Error('Devia ter recusado.');
}

describe('escolha pelo ambiente', () => {
  it('por omissão tudo simulado', () => {
    expect(fonteOperadoresDoAmbiente(ambiente({}))).toBeInstanceOf(
      FonteOperadoresSimulada,
    );
    expect(cellBroadcastDoAmbiente(ambiente({}))).toBeInstanceOf(
      CellBroadcastSimulado,
    );
    expect(opcoesSimulada(ambiente({}))).toEqual({
      escala: 0.02,
      latenciaMs: 200,
      taxaErro: 0,
    });
  });

  it('valores fora dos limites ficam nos limites', () => {
    expect(
      opcoesSimulada(
        ambiente({
          EMERGENCIAS_SIMULADA_ESCALA: '3',
          EMERGENCIAS_SIMULADA_LATENCIA_MS: '-5',
          EMERGENCIAS_SIMULADA_TAXA_ERRO: 'abc',
        }),
      ),
    ).toEqual({ escala: 1, latenciaMs: 0, taxaErro: 0 });
  });

  it('modo desconhecido: nunca a simulada às escondidas, a real (que recusa)', () => {
    const f = fonteOperadoresDoAmbiente(
      ambiente({ EMERGENCIAS_OPERADORES: 'meo' }),
    );
    expect(f.simulada).toBe(false);
    expect(f.emFalta()).toEqual(['OPERADORES_URL', 'OPERADORES_CREDENCIAL']);
    const c = cellBroadcastDoAmbiente(
      ambiente({ EMERGENCIAS_CELL_BROADCAST: 'x' }),
    );
    expect(c.simulada).toBe(false);
  });
});

describe('operadores reais (esqueleto)', () => {
  it('sem configuração recusa com "por configurar — falta acordo com a ANEPC / operadores"', async () => {
    const f = fonteOperadoresDoAmbiente(
      ambiente({ EMERGENCIAS_OPERADORES: 'operadores' }),
    );
    expect(f).toBeInstanceOf(FonteOperadoresReal);
    for (const p of [f.estimar(pedido), f.pagina(pedido, null, 10)]) {
      const e = await recusa(p);
      expect(e).toBeInstanceOf(ErroApi);
      expect(e.getStatus()).toBe(503);
      expect(e.codigo).toBe('operadores_por_configurar');
      expect(e.message).toBe(MENSAGEM_POR_CONFIGURAR_OPERADORES);
      expect(e.message).toMatch(
        /por configurar — falta acordo com a ANEPC \/ operadores/,
      );
      expect(e.detalhes).toEqual({
        em_falta: ['OPERADORES_URL', 'OPERADORES_CREDENCIAL'],
      });
    }
  });

  it('configurada mas por ligar: recusa sem fingir números', async () => {
    const f: FonteOperadores = new FonteOperadoresReal({
      url: 'https://operadores.teste',
      credencial: 'x',
    });
    expect(f.emFalta()).toEqual([]);
    const e = await recusa(f.pagina(pedido, null, 10));
    expect(e.codigo).toBe('operadores_por_ligar');
    expect(e.message).not.toContain('x'.repeat(2));
  });
});

describe('cell broadcast real (esqueleto)', () => {
  it('sem configuração recusa pedir, consultar, estimar e cancelar', async () => {
    const c: CellBroadcast = new CellBroadcastReal({ url: '', credencial: '' });
    const promessas = [
      c.estimar(pedido),
      c.pedir({
        ...pedido,
        referencia: 'r',
        texto: 't',
        validaAte: new Date(),
      }),
      c.consultar({ referencia_externa: null, pedida_em: new Date() }),
      c.cancelar({ referencia_externa: null }),
    ];
    for (const p of promessas) {
      const e = await recusa(p);
      expect(e.codigo).toBe('cell_broadcast_por_configurar');
      expect(e.message).toBe(MENSAGEM_POR_CONFIGURAR_CELL_BROADCAST);
      expect(e.detalhes).toEqual({
        em_falta: ['CELL_BROADCAST_URL', 'CELL_BROADCAST_CREDENCIAL'],
      });
    }
  });
});

describe('simuladas', () => {
  it('operadores: estimativa antes de buscar e páginas com cursor', async () => {
    const f = new FonteOperadoresSimulada({
      escala: 0.02,
      latenciaMs: 0,
      taxaErro: 0,
    });
    const e = await f.estimar(pedido);
    expect(e).toMatchObject({
      pessoas: 9_500,
      com_telemovel: 8_550,
      a_devolver: 171,
      demonstracao: true,
    });
    const p1 = await f.pagina(pedido, null, 100);
    expect(p1.destinatarios).toHaveLength(100);
    expect(p1.seguinte).toBe('100');
    expect(p1.destinatarios[0]).toMatchObject({
      zona_aproximada: 'Azurém',
      origem: 'operadores (simulado)',
    });
    const p2 = await f.pagina(pedido, p1.seguinte, 100);
    expect(p2.destinatarios).toHaveLength(71);
    expect(p2.seguinte).toBeNull();
  });

  it('cell broadcast: referência DEMO e estado pelo tempo', async () => {
    const c = new CellBroadcastSimulado();
    const t0 = new Date('2026-10-22T10:00:00Z');
    const r = await c.pedir(
      { ...pedido, referencia: 'abcdef12-0000', texto: 't', validaAte: t0 },
      t0,
    );
    expect(r).toMatchObject({
      estado: 'pedida',
      referencia_externa: 'CB-DEMO-ABCDEF12',
    });
    const depois = await c.consultar(
      { referencia_externa: r.referencia_externa, pedida_em: t0 },
      new Date(t0.getTime() + 60_000),
    );
    expect(depois.estado).toBe('em_difusao');
  });
});
