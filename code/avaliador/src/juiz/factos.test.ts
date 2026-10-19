import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  contemFacto,
  mesmoFacto,
  normalizar,
  verificarFactos,
} from './factos.js';

describe('normalizar', () => {
  it('tira acentos, maiúsculas e pontuação', () => {
    assert.equal(normalizar('Águas de GUIMARÃES!'), 'aguas de guimaraes');
  });
  it('junta algarismos separados por espaço, ponto ou hífen', () => {
    for (const t of ['800 910 410', '800-910-410', '800.910.410', '800910410'])
      assert.equal(normalizar(t), '800910410');
  });
});

describe('contemFacto', () => {
  it('telefone com qualquer formatação', () => {
    assert.ok(
      contemFacto('Ligue para a Linha Verde (800910410).', '800 910 410'),
    );
    assert.ok(contemFacto('Ligue 800 910 410.', '800910410'));
  });
  it('não bate em pedaços de palavras ou números', () => {
    assert.ok(!contemFacto('Ligue 1120.', '112'));
    assert.ok(!contemFacto('as aguas de guimaraes', 'agua'));
  });
  it('acentos e maiúsculas não contam', () => {
    assert.ok(
      contemFacto('Fale com a AGUAS DE GUIMARAES.', 'Águas de Guimarães'),
    );
  });
});

describe('verificarFactos', () => {
  it('encontra obrigatórios, proibidos e 112', () => {
    const r = verificarFactos(
      'Ligue 112. A Vimágua não; ligue Águas de Guimarães.',
      {
        factos_obrigatorios: ['Vimágua', '253 439 100'],
        factos_proibidos: ['Águas de Guimarães'],
      },
    );
    assert.deepEqual(r.obrigatoriosEncontrados, ['Vimágua']);
    assert.deepEqual(r.proibidosEncontrados, ['Águas de Guimarães']);
    assert.equal(r.menciona112, true);
  });
});

describe('mesmoFacto', () => {
  it('igual, identificador, ou quase igual', () => {
    assert.ok(mesmoFacto('O2', 'qualquer', 'O2'));
    assert.ok(mesmoFacto('das 8h às 17h', '8h às 17h'));
    assert.ok(!mesmoFacto('253', '253 439 100'));
  });
});
