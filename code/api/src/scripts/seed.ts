/**
 * Carrega o seed de um município: os ficheiros .sql de db/seed/<slug>/,
 * por ordem alfabética. Os ficheiros são idempotentes (ids fixos e
 * ON CONFLICT), por isso pode correr-se as vezes que for preciso.
 *   bun run db:seed            (guimaraes)
 *   bun run db:seed -- outro   (db/seed/outro/)
 * Em produção corre-se pelo env/prod/docker/seed.sh (psql no contentor da BD).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';

async function main() {
  const slug = process.argv[2] || 'guimaraes';
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`Slug inválido: ${slug}`);
  const pasta = resolve(process.cwd(), 'db', 'seed', slug);
  const ficheiros = readdirSync(pasta)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (!ficheiros.length) throw new Error(`Sem ficheiros .sql em ${pasta}`);

  process.env.MIGRACOES_NO_ARRANQUE ??= 'true';
  process.env.JOBS_WORKERS = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const db = app.get(DatabaseService);
  const logger = new Logger('db:seed');
  for (const f of ficheiros) {
    // Sem parâmetros o pg usa o protocolo simples: vários comandos por ficheiro.
    await db.query(readFileSync(join(pasta, f), 'utf8'));
    logger.log(`${slug}/${f}`);
  }
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
