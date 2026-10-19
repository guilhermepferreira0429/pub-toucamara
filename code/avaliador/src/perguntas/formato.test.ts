import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contarPorCategoria, validarPerguntas } from './formato.js';

const ler = (url: URL) => JSON.parse(readFileSync(url, 'utf8')) as unknown;
const base = ler(new URL('./perguntas-base.json', import.meta.url));
const exemplo = ler(
  new URL('../../test/fixtures/perguntas-exemplo.json', import.meta.url),
);

test('perguntas-base.json: 180 perguntas válidas, ordem 1..180', () => {
  const p = validarPerguntas(base);
  assert.equal(p.length, 180);
  assert.deepEqual(
    p.map((x) => x.ordem),
    Array.from({ length: 180 }, (_, i) => i + 1),
  );
});

test('perguntas-base.json: comportamentos como o documento manda', () => {
  const p = validarPerguntas(base);
  const de = (cat: string) => p.filter((x) => x.categoria === cat);
  assert.ok(
    de('Água e saneamento').every(
      (x) =>
        x.comportamento === 'encaminhar' && x.entidade_esperada === 'Vimágua',
    ),
  );
  assert.ok(
    de('Ocorrências na via pública').every(
      (x) => x.comportamento === 'ocorrencia',
    ),
  );
  const dificeis = de('Perguntas difíceis');
  assert.equal(dificeis.length, 12);
  // A indicação entre parênteses passa para a nota e sai do texto.
  assert.ok(dificeis.every((x) => x.nota && !x.texto.includes('(')));
  const fumo = dificeis.find((x) => x.texto.includes('fumo'));
  assert.equal(fumo?.comportamento, 'emergencia');
  const ingles = dificeis.find((x) => x.texto.includes('I need help'));
  assert.equal(ingles?.comportamento, 'outra_lingua');
  assert.equal(ingles?.idioma, 'en');
  const iuc = dificeis.find((x) => x.texto.includes('IUC'));
  assert.deepEqual(
    [iuc?.comportamento, iuc?.entidade_esperada],
    ['fora_ambito', 'Finanças'],
  );
});

test('validarPerguntas aplica valores por omissão e ordena por ordem', () => {
  const p = validarPerguntas(exemplo);
  assert.deepEqual(
    p.map((x) => x.ordem),
    [1, 2],
  );
  assert.equal(p[1].idioma, 'pt-PT');
  assert.equal(p[1].nota, null);
});

test('validarPerguntas rejeita comportamento desconhecido e ordem repetida', () => {
  assert.throws(
    () =>
      validarPerguntas([
        { ordem: 1, categoria: 'A', texto: 'x', comportamento: 'adivinhar' },
      ]),
    /\[0\.comportamento\]/,
  );
  assert.throws(
    () =>
      validarPerguntas([
        { ordem: 1, categoria: 'A', texto: 'x', comportamento: 'responder' },
        { ordem: 1, categoria: 'A', texto: 'y', comportamento: 'responder' },
      ]),
    /\[1\.ordem\] ordem 1 repetida/,
  );
  assert.throws(() => validarPerguntas([]), /não tem perguntas/);
});

test('contarPorCategoria mantém a ordem de aparição', () => {
  const m = contarPorCategoria([
    { categoria: 'B' },
    { categoria: 'A' },
    { categoria: 'B' },
  ]);
  assert.deepEqual(
    [...m],
    [
      ['B', 2],
      ['A', 1],
    ],
  );
});
