import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Veredicto } from '../tipos.js';
import {
  amostraEstratificada,
  concordancia,
  gerarCalibracao,
  lerCalibracao,
  lerKappa,
  type ItemCalibracao,
} from './amostra.js';

const itens = [
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `a${i}`,
    s: 'A',
    v: 'certa',
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    id: `b${i}`,
    s: 'A',
    v: 'errada',
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `c${i}`,
    s: 'B',
    v: 'errada',
  })),
  ...Array.from({ length: 10 }, (_, i) => ({
    id: `d${i}`,
    s: 'B',
    v: 'certa',
  })),
];
const opts = {
  id: (t: (typeof itens)[number]) => t.id,
  estrato: (t: (typeof itens)[number]) => `${t.s}|${t.v}`,
  n: 12,
};

describe('amostraEstratificada', () => {
  it('determinística com a mesma semente, independente da ordem de entrada', () => {
    const a = amostraEstratificada(itens, { ...opts, semente: 's' });
    const b = amostraEstratificada([...itens].reverse(), {
      ...opts,
      semente: 's',
    });
    assert.deepEqual(
      a.map((t) => t.id),
      b.map((t) => t.id),
    );
    const c = amostraEstratificada(itens, { ...opts, semente: 'outra' });
    assert.notDeepEqual(
      a.map((t) => t.id),
      c.map((t) => t.id),
    );
  });
  it('reparte pelos estratos: 3 de cada, e os pequenos entram todos', () => {
    const a = amostraEstratificada(itens, { ...opts, semente: 's' });
    assert.equal(a.length, 12);
    const por = (k: string) => a.filter((t) => `${t.s}|${t.v}` === k).length;
    assert.equal(por('A|certa'), 3);
    assert.equal(por('A|errada'), 3);
    assert.equal(por('B|errada'), 3);
    assert.equal(por('B|certa'), 3);
  });
  it('estrato que se esgota cede o lugar aos outros', () => {
    const a = amostraEstratificada(itens, { ...opts, n: 20, semente: 's' });
    assert.equal(a.length, 20);
    assert.equal(a.filter((t) => t.v === 'errada' && t.s === 'A').length, 3);
  });
  it('pede mais do que há → devolve tudo', () => {
    assert.equal(
      amostraEstratificada(itens, { ...opts, n: 999, semente: 's' }).length,
      itens.length,
    );
  });
});

describe('concordancia', () => {
  const p = (juiz: Veredicto, pessoa: Veredicto) => ({ juiz, pessoa });
  it('acordo total → 100% e kappa 1', () => {
    const c = concordancia([p('certa', 'certa'), p('errada', 'errada')]);
    assert.equal(c.acordo, 100);
    assert.equal(c.kappa, 1);
  });
  it('exemplo clássico de kappa', () => {
    // 20 certa/certa, 5 certa/errada, 10 errada/certa, 15 errada/errada:
    // po = 0,7; pe = 0,5·0,6 + 0,5·0,4 = 0,5; kappa = 0,4.
    const pares = [
      ...Array(20).fill(p('certa', 'certa')),
      ...Array(5).fill(p('certa', 'errada')),
      ...Array(10).fill(p('errada', 'certa')),
      ...Array(15).fill(p('errada', 'errada')),
    ];
    const c = concordancia(pares);
    assert.equal(c.acordo, 70);
    assert.ok(Math.abs(c.kappa! - 0.4) < 1e-9);
    assert.equal(c.matriz.errada.certa, 10);
    assert.equal(lerKappa(c.kappa), 'moderada');
  });
  it('sem pares → nulos; todos iguais no mesmo veredicto → kappa 1', () => {
    assert.equal(concordancia([]).kappa, null);
    assert.equal(
      concordancia([p('certa', 'certa'), p('certa', 'certa')]).kappa,
      1,
    );
  });
});

describe('ficheiro de calibração', () => {
  const it1: ItemCalibracao = {
    resposta_id: '11111111-1111-1111-1111-111111111111',
    pergunta: 'Estou sem água?',
    idioma: 'pt-PT',
    categoria: 'Água',
    comportamento: 'encaminhar',
    entidade_esperada: 'Vimágua',
    gabarito_resposta: 'Ligue à Vimágua.\nLinha 2.',
    factos_obrigatorios: ['Vimágua'],
    factos_proibidos: [],
    texto: 'Contacte-nos.',
  };
  const it2 = { ...it1, resposta_id: '22222222-2222-2222-2222-222222222222' };
  const it3 = { ...it1, resposta_id: '33333333-3333-3333-3333-333333333333' };

  it('não mostra veredicto do juiz nem sistema', () => {
    const md = gerarCalibracao([it1], 'T');
    assert.ok(!/juiz:|sistema:/i.test(md));
    assert.ok(md.includes('- [ ] passada_bem'));
  });
  it('lê caixas marcadas, notas, por marcar e erros', () => {
    let md = gerarCalibracao([it1, it2, it3], 'T');
    const partes = md.split('## ');
    partes[1] = partes[1]
      .replace('- [ ] errada', '- [x] errada')
      .replace('**Nota:** ', '**Nota:** só manda contactar');
    partes[3] = partes[3]
      .replace('- [ ] certa', '- [X] certa')
      .replace('- [ ] errada', '- [x] errada');
    md = partes.join('## ');
    const r = lerCalibracao(md);
    assert.deepEqual(r.avaliacoes, [
      {
        resposta_id: it1.resposta_id,
        veredicto: 'errada',
        nota: 'só manda contactar',
      },
    ]);
    assert.equal(r.porAvaliar.length, 1);
    assert.equal(r.erros.length, 1);
  });
  it('recusa ficheiros que não são de calibração', () => {
    assert.throws(() => lerCalibracao('# outra coisa'));
  });
});
