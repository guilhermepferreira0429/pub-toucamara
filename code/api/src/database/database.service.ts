import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { instalarParserDatas } from '../common/datas-pg.js';
import { databaseConfig } from '../config/configuration.js';

// Cursores da paginação com microssegundos (ver common/datas-pg.ts).
instalarParserDatas();

/** Erro de rede numa ligação que estava aberta (não um erro do SQL). */
export function ligacaoCortada(e: unknown): boolean {
  const codigo = (e as { code?: string } | null)?.code;
  const msg = e instanceof Error ? e.message : '';
  return (
    codigo === 'ECONNRESET' ||
    codigo === 'EPIPE' ||
    /Connection terminated unexpectedly/i.test(msg)
  );
}

/** Só SELECT (ou WITH … SELECT sem escrita) se pode repetir sem efeitos. */
export function eLeitura(sql: string): boolean {
  const s = sql.trimStart().toUpperCase();
  if (s.startsWith('SELECT')) return true;
  return s.startsWith('WITH') && !/\b(INSERT|UPDATE|DELETE|MERGE)\b/.test(s);
}

/** Role sem privilégios especiais com que corre o painel (migração 0046). */
export const ROLE_PAINEL = 'toucamara_painel';

/**
 * O município do pedido do painel em curso (posto pelo
 * ContextoMunicipioInterceptor). Com ele, cada consulta corre como
 * ROLE_PAINEL e com app.municipio_id: o RLS só deixa ver esse município.
 */
export const contextoMunicipio = new AsyncLocalStorage<{
  municipioId: string;
}>();

const SQL_ENTRAR = `SELECT set_config('role', '${ROLE_PAINEL}', $2), set_config('app.municipio_id', $1, $2)`;
const SQL_SAIR = 'RESET ROLE; RESET app.municipio_id';

/** Cliente de uma transação: o mesmo `query` tipado, numa ligação só. */
export interface Tx {
  query<T extends QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
}

/**
 * Pool único de Postgres. Se a base estiver em baixo os endpoints falham com
 * 503 em vez de fingir que gravaram.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool | null = null;
  private connected = false;
  /** Há a role do painel e esta ligação pode usá-la (ver ativarRls). */
  private rls = false;

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.connected;
  }

  async onModuleInit(): Promise<void> {
    const cfg =
      this.config.getOrThrow<ConfigType<typeof databaseConfig>>('database');
    if (!cfg.enabled) {
      this.logger.warn('DB_ENABLED=false — a correr sem persistência');
      return;
    }
    const pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
      max: cfg.max,
    });
    pool.on('error', (e) => this.logger.error(`Pool: ${e.message}`));
    try {
      const c = await pool.connect();
      c.release();
      this.pool = pool;
      this.connected = true;
      this.logger.log(`Ligado a ${cfg.host}:${cfg.port}/${cfg.database}`);
    } catch (e) {
      await pool.end().catch(() => undefined);
      this.logger.error(`Ligação à BD falhou: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  get rlsAtivo(): boolean {
    return this.rls;
  }

  /**
   * Liga o RLS do painel se a role existir e esta ligação a puder usar
   * (DB_RLS_PAINEL=false desliga-o). Corre depois das migrações.
   */
  async ativarRls(): Promise<void> {
    const cfg =
      this.config.getOrThrow<ConfigType<typeof databaseConfig>>('database');
    if (!this.connected || !cfg.rlsPainel) {
      this.rls = false;
      return;
    }
    const [r] = await this.query<{ pode: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
              AND pg_has_role(current_user, $1, 'MEMBER') AS pode`,
      [ROLE_PAINEL],
    );
    this.rls = !!r?.pode;
    if (!this.rls) {
      this.logger.warn(
        `RLS do painel desligado: a role ${ROLE_PAINEL} não existe ou não está disponível.`,
      );
    }
  }

  private municipioDoPedido(): string | null {
    return this.rls
      ? (contextoMunicipio.getStore()?.municipioId ?? null)
      : null;
  }

  getPool(): Pool {
    if (!this.pool || !this.connected) {
      throw new ServiceUnavailableException(
        'Base de dados indisponível. Verifica a configuração DB_* no .env.',
      );
    }
    return this.pool;
  }

  async query<T extends QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const municipioId = this.municipioDoPedido();
    if (municipioId) return this.comoPainel<T>(municipioId, sql, params);
    try {
      return (await this.getPool().query<T>(sql, params)).rows;
    } catch (e) {
      // Uma ligação parada no pool pode ter sido cortada pela rede (NAT,
      // Docker Desktop): repete-se uma vez, só leituras — uma escrita podia
      // já ter sido aplicada antes do corte.
      if (!ligacaoCortada(e) || !eLeitura(sql)) throw e;
      this.logger.warn('Ligação à BD cortada: a repetir a leitura.');
      return (await this.getPool().query<T>(sql, params)).rows;
    }
  }

  /**
   * Uma consulta do painel: numa ligação só, como ROLE_PAINEL e com o
   * município. Se não for possível voltar ao estado normal, a ligação é
   * deitada fora (nunca volta ao pool com a role do painel).
   */
  private async comoPainel<T extends QueryResultRow>(
    municipioId: string,
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const client = await this.getPool().connect();
    let estragada: Error | undefined;
    try {
      await client.query(SQL_ENTRAR, [municipioId, false]);
      return (await client.query<T>(sql, params)).rows;
    } finally {
      try {
        await client.query(SQL_SAIR);
      } catch (e) {
        estragada = e as Error;
      }
      client.release(estragada ?? undefined);
    }
  }

  /** Corre fn numa transação; rollback se lançar. */
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      const municipioId = this.municipioDoPedido();
      // SET LOCAL: acaba com a transação (COMMIT ou ROLLBACK).
      if (municipioId) await client.query(SQL_ENTRAR, [municipioId, true]);
      const result = await fn({
        query: async <R extends QueryResultRow>(
          sql: string,
          params?: unknown[],
        ) => (await client.query<R>(sql, params)).rows,
      });
      await client.query('COMMIT');
      return result;
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (erroRollback) {
        this.logger.error(
          `Rollback falhou: ${(erroRollback as Error).message}`,
        );
      }
      throw e;
    } finally {
      client.release();
    }
  }
}
