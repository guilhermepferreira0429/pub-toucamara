import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Q } from '../bd.js';
import { motivoExecucao, tratarPedido, type Pedido } from './pedidos.js';

/** Uma BD de mentira: regista as consultas e responde ao sistema. */
function bdFalsa(sistema: string | null) {
  const feitas: { sql: string; params?: unknown[] }[] = [];
  const q: Q = {
    async query<T>(sql: string, params?: unknown[]) {
      feitas.push({ sql, params });
      if (sql.includes('FROM avaliacao.sistemas')) {
        return (sistema ? [{ nome: sistema }] : []) as T[];
      }
      return [] as T[];
    },
  };
  const fim = () => feitas.find((f) => f.sql.includes('UPDATE avaliacao.pedidos'))?.params;
  return { q, fim };
}

const PEDIDO: Pedido = {
  id: 'p1',
  municipio_id: 'm1',
  motivo: 'mudanca_agente',
  conjunto: 'Perguntas base',
  amostra: false,
};

test('motivo da execução', () => {
  assert.equal(motivoExecucao('mudanca_agente'), 'publicacao');
  assert.equal(motivoExecucao('ingestao'), 'manual');
});

test('executa, avalia e liga a execução ao pedido', async () => {
  const { q, fim } = bdFalsa('Tou, Câmara? · Teste · chat');
  const vistos: string[] = [];
  const r = await tratarPedido(
    PEDIDO,
    {
      async executar(o) {
        vistos.push(`executar ${o.sistema} ${o.motivo}`);
        return { execucao_id: 'e1', estado: 'terminada', erro: null };
      },
      async avaliar(id) {
        vistos.push(`avaliar ${id}`);
      },
    },
    q,
  );
  assert.equal(r, 'terminado');
  assert.deepEqual(vistos, ['executar Tou, Câmara? · Teste · chat publicacao', 'avaliar e1']);
  assert.deepEqual(fim(), ['p1', 'terminado', 'e1', null]);
});

test('sem sistema, interrompida ou erro do juiz: falhou, com o motivo', async () => {
  let b = bdFalsa(null);
  assert.equal(
    await tratarPedido(PEDIDO, { executar: () => Promise.reject(new Error('x')), avaliar: async () => {} }, b.q),
    'falhou',
  );
  assert.match(String(b.fim()?.[3]), /preparar-base/);

  b = bdFalsa('S');
  await tratarPedido(
    PEDIDO,
    {
      executar: async () => ({ execucao_id: 'e2', estado: 'interrompida', erro: 'chat em baixo' }),
      avaliar: async () => assert.fail('não avalia uma execução interrompida'),
    },
    b.q,
  );
  assert.deepEqual(b.fim(), ['p1', 'falhou', 'e2', 'chat em baixo']);

  b = bdFalsa('S');
  await tratarPedido(
    PEDIDO,
    {
      executar: async () => ({ execucao_id: 'e3', estado: 'terminada', erro: null }),
      avaliar: () => Promise.reject(new Error('Sem ANTHROPIC_API_KEY')),
    },
    b.q,
  );
  assert.deepEqual(b.fim(), ['p1', 'falhou', null, 'Sem ANTHROPIC_API_KEY']);
});
