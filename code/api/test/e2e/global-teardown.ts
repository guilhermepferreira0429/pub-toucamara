import { clienteAdmin, nomeSeguro } from './bd';

/** Apaga a BD desta execução (mesmo com ligações abertas). */
export default async function globalTeardown(): Promise<void> {
  const nome = process.env.E2E_BD;
  if (!nome) return;
  const c = await clienteAdmin();
  try {
    await c.query(`DROP DATABASE IF EXISTS ${nomeSeguro(nome)} WITH (FORCE)`);
  } finally {
    await c.end();
  }
}
