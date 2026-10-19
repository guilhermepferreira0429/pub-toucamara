import { rrf, RRF_K } from './rrf.js';

describe('rrf', () => {
  const id = (x: { id: string }) => x.id;

  it('soma 1/(k+posição) em cada lista', () => {
    const r = rrf(
      [
        [{ id: 'a' }, { id: 'b' }],
        [{ id: 'b' }, { id: 'c' }],
      ],
      id,
    );
    expect(r.map((x) => x.item.id)).toEqual(['b', 'a', 'c']);
    expect(r[0].pontuacao).toBeCloseTo(1 / (RRF_K + 2) + 1 / (RRF_K + 1));
    expect(r[0].posicoes).toEqual([2, 1]);
    expect(r[1].posicoes).toEqual([1, null]);
  });

  it('empate: ganha quem aparece em mais listas e depois a melhor posição', () => {
    // a: 1.º só na lista 1; c: 1.º só na lista 2 -> mesma pontuação.
    const r = rrf([[{ id: 'a' }], [{ id: 'c' }]], id);
    expect(r.map((x) => x.item.id)).toEqual(['a', 'c']);
  });

  it('ignora duplicados dentro da mesma lista e listas vazias', () => {
    const r = rrf([[{ id: 'a' }, { id: 'a' }], []], id);
    expect(r).toHaveLength(1);
    expect(r[0].pontuacao).toBeCloseTo(1 / (RRF_K + 1));
  });

  it('fica com o primeiro objeto visto', () => {
    const r = rrf(
      [[{ id: 'a', v: 1 }], [{ id: 'a', v: 2 }]],
      (x: { id: string; v: number }) => x.id,
    );
    expect(r[0].item.v).toBe(1);
  });
});
