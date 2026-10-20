import { Client, ClientConfig } from 'pg';

/*
 * Ligação ao Postgres de dev (docker-compose em env/dev, porta 54330) para
 * criar e apagar a BD de cada execução. Só se lê o ambiente da shell: o
 * `.env` da API nunca é lido aqui.
 */

export const PREFIXO_BD = 'toucamara_e2e_';

export function ligacaoBase(): Omit<ClientConfig, 'database'> {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '54330', 10),
    user: process.env.DB_USER || 'toucamara',
    // A password de dev do docker-compose, se a shell não trouxer outra.
    password: process.env.DB_PASSWORD || 'toucamara',
  };
}

/** Cliente ligado à BD `postgres` (para CREATE/DROP DATABASE). */
export async function clienteAdmin(): Promise<Client> {
  const c = new Client({ ...ligacaoBase(), database: 'postgres' });
  await c.connect();
  return c;
}

/** Só nomes gerados por nós chegam ao SQL (não há parâmetros em DDL). */
export function nomeSeguro(nome: string): string {
  if (!/^toucamara_e2e_[a-z0-9_]+$/.test(nome)) {
    throw new Error(`Nome de BD de teste inválido: ${nome}`);
  }
  return nome;
}
