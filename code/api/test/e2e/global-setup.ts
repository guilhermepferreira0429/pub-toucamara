import { clienteAdmin, nomeSeguro, PREFIXO_BD } from './bd';

/** Restos de execuções interrompidas: apagam-se as BD de teste com mais de 6 h. */
const RESTOS_HORAS = 6;

/**
 * Cria uma BD nova para esta execução (`toucamara_e2e_<timestamp>_<pid>`) e
 * põe-na em `DB_NAME`. As migrações correm no arranque da app (o primeiro
 * ficheiro de teste) e o seed é carregado logo a seguir (ver `app.ts`).
 */
export default async function globalSetup(): Promise<void> {
  const nome = nomeSeguro(`${PREFIXO_BD}${Date.now()}_${process.pid}`);
  const c = await clienteAdmin();
  try {
    const antigas = await c.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1`,
      [`${PREFIXO_BD}%`],
    );
    const limite = Date.now() - RESTOS_HORAS * 3_600_000;
    for (const { datname } of antigas.rows) {
      const criada = Number(/^toucamara_e2e_(\d+)_/.exec(datname)?.[1]);
      if (criada && criada < limite) {
        await c.query(
          `DROP DATABASE IF EXISTS ${nomeSeguro(datname)} WITH (FORCE)`,
        );
      }
    }
    await c.query(`CREATE DATABASE ${nome}`);
  } finally {
    await c.end();
  }
  process.env.DB_NAME = nome;
  process.env.E2E_BD = nome;
}
