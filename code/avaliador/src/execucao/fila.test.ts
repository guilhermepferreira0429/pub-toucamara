import assert from 'node:assert/strict';
import { test } from 'node:test';
import { correrFila, dormir } from './fila.js';

test('correrFila: paralelo 1 com pausa entre perguntas (não depois da última)', async () => {
  const eventos: string[] = [];
  await correrFila([1, 2, 3], {
    paralelo: 1,
    pausa: () => 25,
    trabalhar: async (n) => void eventos.push(`p${n}`),
    dormir: async (ms) => void eventos.push(`pausa ${ms}`),
  });
  assert.deepEqual(eventos, ['p1', 'pausa 25', 'p2', 'pausa 25', 'p3']);
});

test('correrFila: respeita o paralelismo', async () => {
  let agora = 0;
  let max = 0;
  await correrFila(
    Array.from({ length: 10 }, (_, i) => i),
    {
      paralelo: 4,
      pausa: () => 0,
      trabalhar: async () => {
        agora++;
        max = Math.max(max, agora);
        await dormir(5);
        agora--;
      },
    },
  );
  assert.equal(max, 4);
});

test('correrFila: abortar não começa mais, mas deixa acabar as em curso', async () => {
  const c = new AbortController();
  const feitas: number[] = [];
  await correrFila([1, 2, 3, 4], {
    paralelo: 1,
    pausa: () => 1_000,
    sinal: c.signal,
    trabalhar: async (n) => {
      if (n === 2) c.abort();
      await dormir(5);
      feitas.push(n);
    },
  });
  assert.deepEqual(feitas, [1, 2]);
});

test('correrFila: um erro para a fila e é relançado', async () => {
  const feitas: number[] = [];
  await assert.rejects(
    correrFila([1, 2, 3], {
      paralelo: 1,
      pausa: () => 0,
      trabalhar: async (n) => {
        if (n === 2) throw new Error('bd em baixo');
        feitas.push(n);
      },
    }),
    /bd em baixo/,
  );
  assert.deepEqual(feitas, [1]);
});
