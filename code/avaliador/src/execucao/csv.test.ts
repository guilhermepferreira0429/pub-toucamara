import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lerCsv, respostasDoCsv } from './csv.js';

test('lerCsv: aspas, ; e quebras de linha dentro de aspas, "" escapado, BOM e CRLF', () => {
  const csv =
    '﻿pergunta;resposta\r\n' +
    '1;Simples\r\n' +
    '"Texto; com ponto e vírgula";"Diz ""olá""; e\r\nmuda de linha"\r\n' +
    '\r\n' +
    '3;sem fim de linha';
  assert.deepEqual(lerCsv(csv), [
    { linha: 1, campos: ['pergunta', 'resposta'] },
    { linha: 2, campos: ['1', 'Simples'] },
    {
      linha: 3,
      campos: ['Texto; com ponto e vírgula', 'Diz "olá"; e\nmuda de linha'],
    },
    { linha: 6, campos: ['3', 'sem fim de linha'] },
  ]);
});

test('lerCsv: aspas por fechar dão erro com a linha', () => {
  assert.throws(() => lerCsv('1;ok\n2;"aberta\n'), /linha 2/);
});

test('respostasDoCsv: cabeçalho opcional, nº de ordem ou texto, ; a mais junta-se à resposta', () => {
  assert.deepEqual(
    respostasDoCsv(
      '12;Contacte a câmara\nQuero fazer obras na cozinha?;Sim; com licença\n',
    ),
    [
      { linha: 1, ordem: 12, pergunta: '12', resposta: 'Contacte a câmara' },
      {
        linha: 2,
        ordem: null,
        pergunta: 'Quero fazer obras na cozinha?',
        resposta: 'Sim; com licença',
      },
    ],
  );
  assert.throws(
    () => respostasDoCsv('Pergunta;Resposta\n5\n'),
    /linha 2: falta a resposta/,
  );
  assert.equal(respostasDoCsv('pergunta;resposta\n').length, 0);
});
