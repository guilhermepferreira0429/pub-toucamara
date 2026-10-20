import { eLeitura, ligacaoCortada } from './database.service.js';

describe('repetição de leituras com a ligação cortada', () => {
  it('reconhece cortes de rede e não erros de SQL', () => {
    expect(
      ligacaoCortada(Object.assign(new Error('x'), { code: 'ECONNRESET' })),
    ).toBe(true);
    expect(
      ligacaoCortada(new Error('Connection terminated unexpectedly')),
    ).toBe(true);
    expect(
      ligacaoCortada(Object.assign(new Error('x'), { code: '23505' })),
    ).toBe(false);
  });

  it('só repete leituras', () => {
    expect(eLeitura('  SELECT 1')).toBe(true);
    expect(eLeitura('WITH c AS (SELECT 1) SELECT * FROM c')).toBe(true);
    expect(
      eLeitura('WITH x AS (UPDATE t SET a = 1 RETURNING 1) SELECT * FROM x'),
    ).toBe(false);
    expect(eLeitura('INSERT INTO t VALUES (1)')).toBe(false);
  });
});
