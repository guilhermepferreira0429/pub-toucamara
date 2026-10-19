import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { eDificil, escolherAmostra } from './amostra.js';

test('escolherAmostra: todas as difíceis + a primeira de cada outra categoria, por ordem', () => {
  const ps = [
    { ordem: 5, categoria: 'Obras' },
    { ordem: 1, categoria: 'Obras' },
    { ordem: 2, categoria: 'Perguntas difíceis' },
    { ordem: 3, categoria: 'Taxas' },
    { ordem: 4, categoria: 'Perguntas difíceis' },
  ];
  assert.deepEqual(
    escolherAmostra(ps).map((p) => p.ordem),
    [1, 2, 3, 4],
  );
  // Determinística e sem mexer na entrada.
  assert.deepEqual(escolherAmostra(ps), escolherAmostra([...ps].reverse()));
  assert.equal(ps[0].ordem, 5);
});

test('eDificil: com e sem acentos', () => {
  assert.ok(eDificil('Perguntas difíceis'));
  assert.ok(eDificil('DIFICIL'));
  assert.ok(!eDificil('Água e saneamento'));
});

test('escolherAmostra: nas 180 perguntas base dá ~20', () => {
  const base = JSON.parse(
    readFileSync(
      new URL('../perguntas/perguntas-base.json', import.meta.url),
      'utf8',
    ),
  ) as { ordem: number; categoria: string }[];
  const a = escolherAmostra(base);
  const categorias = new Set(base.map((p) => p.categoria));
  const dificeis = base.filter((p) => eDificil(p.categoria)).length;
  assert.equal(a.length, dificeis + categorias.size - 1);
  assert.ok(a.length >= 15 && a.length <= 30, `${a.length}`);
});
