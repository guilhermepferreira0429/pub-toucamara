import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encontrar, lerArgs } from './cli.js';
import type { Comando } from './tipos.js';

test('lerArgs separa posicionais e opções', () => {
  assert.deepEqual(
    lerArgs(['a.json', '--municipio', 'guimaraes', '--lote', '--x=1']),
    {
      posicionais: ['a.json'],
      opcoes: { municipio: 'guimaraes', lote: true, x: '1' },
    },
  );
});

test('encontrar escolhe o comando mais específico', () => {
  const c = (nome: string): Comando => ({
    nome,
    descricao: '',
    correr: async () => {},
  });
  const r = encontrar(
    [c('gabarito'), c('gabarito propor')],
    ['gabarito', 'propor', '--m', 'x'],
  );
  assert.equal(r?.comando.nome, 'gabarito propor');
  assert.deepEqual(r?.resto, ['--m', 'x']);
});
