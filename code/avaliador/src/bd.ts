import pg from 'pg';
import { config } from './config.js';

export interface Q {
  query<T extends pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}

let pool: pg.Pool | null = null;

function obterPool(): pg.Pool {
  pool ??= new pg.Pool({
    ...config.bd,
    ssl: config.bd.ssl ? { rejectUnauthorized: false } : undefined,
    max: 4,
  });
  return pool;
}

/** Mesmo padrão da API: query tipada, parâmetros sempre em $n. */
export const bd: Q & {
  transacao<T>(fn: (tx: Q) => Promise<T>): Promise<T>;
  fechar(): Promise<void>;
} = {
  async query(sql, params) {
    return (await obterPool().query(sql, params)).rows;
  },
  async transacao(fn) {
    const c = await obterPool().connect();
    try {
      await c.query('BEGIN');
      const r = await fn({
        query: async (sql, params) => (await c.query(sql, params)).rows,
      });
      await c.query('COMMIT');
      return r;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  },
  async fechar() {
    await pool?.end();
    pool = null;
  },
};
