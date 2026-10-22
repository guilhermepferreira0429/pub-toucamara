/* Os mesmos casos de code/api/src/modules/conhecimento/numeros-na-fonte.spec.ts (resumidos). */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extrairNumeros, resumirNumeros, verificarNumeros } from './numeros.js';

const so = (texto: string) =>
  extrairNumeros(texto).map((n) =>
    n.unidade ? `${n.tipo}:${n.unidade}:${n.valor}` : `${n.tipo}:${n.valor}`,
  );

describe('extrairNumeros', () => {
  it('casos PT reais', () => {
    assert.deepEqual(so('Ligue 253 421 200'), ['telefone:253421200']);
    assert.deepEqual(so('Total: 1 234,56 €'), ['euros:1234.56']);
    assert.deepEqual(so('São 3,50€'), ['euros:3.5']);
    assert.deepEqual(so('Aberto das 9h às 16h'), ['hora:09:00', 'hora:16:00']);
    assert.deepEqual(so('Tem 30 dias'), ['prazo:dia:30']);
    assert.deepEqual(so('Desconto de 15%'), ['percentagem:15']);
    assert.deepEqual(so('O valor é 64,70.'), ['numero:64.7']);
    assert.deepEqual(so('até 15 de março de 2026'), ['data:2026-03-15']);
  });

  it('ignora artigos, processos e números nacionais', () => {
    assert.deepEqual(
      so('art. 12.º, n.º 3, Lei n.º 75/2013, processo 2024/1234'),
      [],
    );
    assert.deepEqual(so('Ligue 112 ou SNS 24: 808 24 24 24'), []);
  });
});

describe('verificarNumeros', () => {
  const gabarito = [
    'A licença custa 12,50 euros e é decidida em 30 dias úteis. Telefone 253421200, das 9h00 às 16h00.',
  ];

  it('tudo no gabarito', () => {
    const r = verificarNumeros(
      'Custa 12,50 €, decide em 30 dias; ligue 253 421 200 das 9h às 16h.',
      gabarito,
    );
    assert.equal(r.semFonte.length, 0);
    assert.equal(r.numeros.length, 5);
  });

  it('valor inventado', () => {
    const r = verificarNumeros('Custa 14 € e decide em 30 dias.', gabarito);
    assert.deepEqual(
      r.semFonte.map((n) => n.texto),
      ['14 €'],
    );
  });
});

describe('resumirNumeros', () => {
  it('% de respostas com pelo menos um número sem fonte', () => {
    const r = resumirNumeros([
      { texto: 'Custa 10 €.', fontes: ['10 euros'] },
      { texto: 'Custa 11 € e 12 €.', fontes: ['10 euros'] },
      { texto: 'Dirija-se ao balcão.', fontes: [] },
      { texto: null, fontes: [] },
    ]);
    assert.equal(r.com_numeros_sem_fonte, 1);
    assert.equal(r.numeros_sem_fonte, 2);
    assert.equal(r.percentagem, 25);
  });
});
