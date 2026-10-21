/* eslint-disable @typescript-eslint/no-unsafe-member-access -- os corpos do supertest são `any`. */
import { randomUUID } from 'crypto';
import {
  contextoMunicipio,
  DatabaseService,
} from '../../src/database/database.service';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  linha,
  MUNICIPIO_ID,
  novoTelefone,
} from './app';

/**
 * RLS por município nos pedidos do painel (migração 0046): uma consulta sem
 * WHERE municipio_id não vê outra câmara, não escreve noutra câmara, e a
 * ligação volta ao pool sem a role do painel.
 */
describe('RLS por município (e2e)', () => {
  let ctx: Contexto;
  let db: DatabaseService;
  const OUTRO = randomUUID();

  beforeAll(async () => {
    ctx = await arrancarApp();
    db = ctx.app.get(DatabaseService);
    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Outra Câmara')`,
      [OUTRO, `outra-${OUTRO.slice(0, 8)}`],
    );
    for (const m of [MUNICIPIO_ID, OUTRO]) {
      await ctx.db.query(
        `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Pessoa RLS')`,
        [m, novoTelefone()],
      );
    }
  });
  afterAll(() => ctx.fechar());

  const comoPainel = <T>(fn: () => Promise<T>) =>
    contextoMunicipio.run({ municipioId: MUNICIPIO_ID }, fn);

  it('está ligado', () => {
    expect(db.rlsAtivo).toBe(true);
  });

  it('sem WHERE: só vê o seu município', async () => {
    const todos = await db.query<{ municipio_id: string }>(
      `SELECT DISTINCT municipio_id FROM municipes WHERE nome = 'Pessoa RLS'`,
    );
    expect(todos.map((x) => x.municipio_id).sort()).toEqual(
      [MUNICIPIO_ID, OUTRO].sort(),
    );
    const painel = await comoPainel(() =>
      db.query<{ municipio_id: string }>(
        `SELECT DISTINCT municipio_id FROM municipes WHERE nome = 'Pessoa RLS'`,
      ),
    );
    expect(painel.map((x) => x.municipio_id)).toEqual([MUNICIPIO_ID]);
  });

  it('não escreve noutro município, nem numa transação', async () => {
    await expect(
      comoPainel(() =>
        db.query(
          `INSERT INTO municipes (municipio_id, telefone_e164) VALUES ($1, $2)`,
          [OUTRO, novoTelefone()],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      comoPainel(() =>
        db.transaction((tx) =>
          tx.query(
            `UPDATE municipes SET nome = 'mudado' WHERE municipio_id = $1 RETURNING id`,
            [OUTRO],
          ),
        ),
      ),
    ).resolves.toEqual([]);
    const outro = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM municipes WHERE municipio_id = $1 AND nome = 'mudado'`,
      [OUTRO],
    );
    expect(outro!.n).toBe(0);
  });

  it('o registo de auditoria não se reescreve a partir do painel', async () => {
    await expect(
      comoPainel(() =>
        db.query(`DELETE FROM audit_log WHERE municipio_id = $1`, [
          MUNICIPIO_ID,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('a ligação volta ao pool sem a role nem o município', async () => {
    // Mais consultas do que ligações no pool (5): todas passam pelo painel.
    await comoPainel(() =>
      Promise.all(Array.from({ length: 12 }, () => db.query('SELECT 1'))),
    );
    const r = await Promise.all(
      Array.from({ length: 12 }, () =>
        db.query<{ quem: string; m: string | null }>(
          `SELECT current_user AS quem, app_municipio()::text AS m`,
        ),
      ),
    );
    for (const [x] of r) {
      expect(x.quem).not.toBe('toucamara_painel');
      expect(x.m).toBeNull();
    }
  });

  it('as rotas do painel continuam a funcionar', async () => {
    const chefe = await entrarPainel(ctx);
    const r = await ctx
      .http()
      .get('/v1/painel/agente/perguntas')
      .set(chefe)
      .expect(200);
    expect(r.body.total).toEqual(expect.any(Number));
  });
});
