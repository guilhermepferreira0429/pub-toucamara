import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DatabaseService } from './database.service.js';

// Chave do pg_advisory_lock das migrações (qualquer bigint fixo).
const TRINCO = 7_204_190_026;

export interface Migracao {
  nome: string;
  conteudo: string;
  hash: string;
}

/** Lê os .sql de db/migrations por ordem, com o hash de cada um. */
export function lerMigracoes(dir: string): Migracao[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((nome) => {
      const conteudo = fs.readFileSync(path.join(dir, nome), 'utf-8');
      // O hash ignora diferenças de fim de linha (o git no Windows troca LF por CRLF).
      const hash = createHash('sha256')
        .update(conteudo.replace(/\r\n/g, '\n'))
        .digest('hex');
      return { nome, conteudo, hash };
    });
}

// dist/database -> ../../db/migrations ; src/database -> ../../db/migrations
export const PASTA_MIGRACOES = path.resolve(
  __dirname,
  '..',
  '..',
  'db',
  'migrations',
);

/**
 * Corre os .sql de db/migrations por ordem, no arranque.
 *
 * - Uma instância de cada vez: pg_advisory_lock numa ligação própria. As
 *   outras esperam e depois veem tudo já aplicado.
 * - Cada ficheiro numa transação: ou entra inteiro, ou nada (o DDL do
 *   Postgres é transacional).
 * - migracao_aplicada guarda o que correu e o hash. Um ficheiro já aplicado
 *   não volta a correr. Se mudou, em produção a API não arranca (as migrações
 *   aplicadas não se editam: cria-se a seguinte); em dev avisa e segue — para
 *   recomeçar do zero: `bun run db:reset`.
 */
@Injectable()
export class MigrationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Os scripts (db:reset, seed) correm as migrações eles próprios.
    if (!this.db.enabled || process.env.MIGRACOES_NO_ARRANQUE === 'false')
      return;
    if (!fs.existsSync(PASTA_MIGRACOES)) {
      this.logger.warn(`Pasta de migrações não encontrada: ${PASTA_MIGRACOES}`);
      return;
    }
    const producao = this.config.get<string>('app.ambiente') === 'production';
    await aplicarMigracoes(
      this.db,
      lerMigracoes(PASTA_MIGRACOES),
      producao,
      this.logger,
    );
  }
}

export async function aplicarMigracoes(
  db: DatabaseService,
  ficheiros: Migracao[],
  producao: boolean,
  logger: Pick<Logger, 'log' | 'warn' | 'error'>,
): Promise<void> {
  // Ligação dedicada: o trinco é da sessão e tem de ser a mesma do princípio ao fim.
  const client = await db.getPool().connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [TRINCO]);
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS migracao_aplicada (
          ficheiro    text PRIMARY KEY,
          hash        char(64) NOT NULL,
          aplicada_em timestamptz NOT NULL DEFAULT now()
        )`);
      const aplicadas = new Map(
        (
          await client.query<{ ficheiro: string; hash: string }>(
            'SELECT ficheiro, hash FROM migracao_aplicada',
          )
        ).rows.map((r) => [r.ficheiro, r.hash]),
      );

      for (const f of ficheiros) {
        const anterior = aplicadas.get(f.nome);
        if (anterior === f.hash) continue;
        if (anterior) {
          const msg = `A migração ${f.nome} já aplicada foi alterada. Não se editam migrações aplicadas: cria a seguinte.`;
          if (producao) throw new Error(msg);
          logger.warn(
            `${msg} (dev: ignorada; \`bun run db:reset\` para recomeçar)`,
          );
          continue;
        }
        await client.query('BEGIN');
        try {
          await client.query(f.conteudo);
          await client.query(
            'INSERT INTO migracao_aplicada (ficheiro, hash) VALUES ($1, $2)',
            [f.nome, f.hash],
          );
          await client.query('COMMIT');
          logger.log(`Migração aplicada: ${f.nome}`);
        } catch (e) {
          await client.query('ROLLBACK');
          logger.error(`Migração ${f.nome} falhou: ${(e as Error).message}`);
          throw e;
        }
      }
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [TRINCO]);
    }
  } finally {
    client.release();
  }
}
