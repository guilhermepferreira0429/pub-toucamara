import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  lerEssenciais,
  planearEssenciais,
  type GabaritoParaClassificar,
} from './essenciais.js';

const GABARITOS: GabaritoParaClassificar[] = [
  {
    gabarito_id: 'g1',
    ordem: 1,
    factos_obrigatorios: ['Vimágua', '253 439 100', 'atendimento 9h às 17h'],
    factos_secundarios: [],
  },
  {
    gabarito_id: 'g2',
    ordem: 2,
    factos_obrigatorios: ['112'],
    factos_secundarios: [],
  },
  {
    gabarito_id: 'g3',
    ordem: 3,
    factos_obrigatorios: ['Balcão Único', 'Mod. 466/SQ'],
    factos_secundarios: ['Mod. 466/SQ'],
  },
];

describe('essenciais', () => {
  it('lê o formato do ficheiro e rejeita tipos que não são E ou S', () => {
    const c = lerEssenciais(
      '[{"ordem":1,"factos":[{"facto":"Vimágua","tipo":"E"}]}]',
    );
    assert.equal(c[0].factos[0].tipo, 'E');
    assert.throws(
      () => lerEssenciais('[{"ordem":1,"factos":[{"facto":"x","tipo":"X"}]}]'),
      /Formato inválido/,
    );
  });

  it('grava só os S, com o texto do gabarito; o que não está classificado conta como E', () => {
    const p = planearEssenciais(
      [
        {
          ordem: 1,
          factos: [
            { facto: 'Vimágua', tipo: 'E' },
            { facto: 'atendimento 9h as 17h', tipo: 'S' },
          ],
        },
        {
          ordem: 3,
          factos: [
            { facto: 'Balcão Único', tipo: 'E' },
            { facto: 'Mod. 466/SQ', tipo: 'S' },
          ],
        },
      ],
      GABARITOS,
    );
    assert.deepEqual(p.erros, []);
    assert.deepEqual(
      p.atualizacoes.map((a) => [a.gabarito_id, a.secundarios, a.mudou]),
      [
        ['g1', ['atendimento 9h às 17h'], true],
        ['g3', ['Mod. 466/SQ'], false],
      ],
    );
    assert.ok(p.avisos.some((a) => a.includes('"253 439 100"')));
    assert.ok(p.avisos.some((a) => a.startsWith('1 perguntas')));
  });

  it('erros: facto que não está no gabarito, nenhum E, sem gabarito, repetida', () => {
    const p = planearEssenciais(
      [
        { ordem: 1, factos: [{ facto: 'Águas de Guimarães', tipo: 'E' }] },
        { ordem: 2, factos: [{ facto: '112', tipo: 'S' }] },
        { ordem: 9, factos: [{ facto: 'x', tipo: 'E' }] },
        { ordem: 3, factos: [{ facto: 'Balcão Único', tipo: 'E' }] },
        { ordem: 3, factos: [{ facto: 'Balcão Único', tipo: 'S' }] },
      ],
      GABARITOS,
    );
    assert.equal(p.erros.length, 4);
    assert.match(p.erros[0], /#1: factos que não estão/);
    assert.match(p.erros[1], /#2: nenhum facto E/);
    assert.match(p.erros[2], /#9: sem gabarito aprovado/);
    assert.match(p.erros[3], /#3: aparece mais do que uma vez/);
    // A 3 (primeira vez) passa a não ter S: muda.
    assert.deepEqual(p.atualizacoes, [
      { gabarito_id: 'g3', ordem: 3, secundarios: [], mudou: true },
    ]);
  });
});
