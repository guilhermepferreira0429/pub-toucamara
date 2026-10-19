/**
 * Dev: apaga o esquema public e volta a correr as migrações do zero.
 *   bun run db:reset
 * Recusa em produção.
 */
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { DatabaseService } from '../database/database.service.js';
import {
  aplicarMigracoes,
  lerMigracoes,
  PASTA_MIGRACOES,
} from '../database/migrations.service.js';

async function main() {
  process.env.MIGRACOES_NO_ARRANQUE = 'false';
  if ((process.env.NODE_ENV || 'development') === 'production') {
    throw new Error('db:reset não corre em produção.');
  }
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const db = app.get(DatabaseService);
  const logger = new Logger('db:reset');
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
  logger.warn('Esquema public apagado.');
  await aplicarMigracoes(db, lerMigracoes(PASTA_MIGRACOES), false, logger);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
