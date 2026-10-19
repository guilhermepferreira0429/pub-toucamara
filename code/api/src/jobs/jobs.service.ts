import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import type { Job, PgBoss, SendOptions } from 'pg-boss';
import { databaseConfig, jobsConfig } from '../config/configuration.js';

export type Trabalho<T> = (dados: T, job: Job<T>) => Promise<void>;

export interface OpcoesTrabalho {
  /** Quantos em paralelo nesta instância (por defeito 2). */
  concorrencia?: number;
}

const FUSO = 'Europe/Lisbon';

/**
 * Filas e cron dentro do próprio Postgres (pg-boss, esquema `pgboss`).
 *
 * Os módulos registam os trabalhos no `onModuleInit` com `trabalhar()` e os
 * horários com `agendar()`; tudo arranca no bootstrap. `enviar()` pode ser
 * chamado a qualquer momento: espera pelo arranque.
 *
 * Sem BD (DB_ENABLED=false) não há filas: `enviar()` só escreve no log.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private boss: PgBoss | null = null;
  private pronto: Promise<PgBoss | null>;
  private marcarPronto!: (b: PgBoss | null) => void;
  private readonly trabalhos = new Map<
    string,
    { fn: Trabalho<any>; opcoes: OpcoesTrabalho }
  >();
  private readonly horarios: { nome: string; cron: string; dados: object }[] =
    [];
  private readonly filas = new Set<string>();

  constructor(private readonly config: ConfigService) {
    this.pronto = new Promise((r) => (this.marcarPronto = r));
  }

  /** Regista o trabalho de uma fila. Tentativas: 3, com espera crescente. */
  trabalhar<T extends object>(
    nome: string,
    fn: Trabalho<T>,
    opcoes: OpcoesTrabalho = {},
  ): void {
    if (this.trabalhos.has(nome)) {
      throw new Error(`Trabalho registado duas vezes: ${nome}`);
    }
    this.trabalhos.set(nome, { fn, opcoes });
  }

  /** Cron no fuso de Lisboa, ex.: agendar('ingestao_fontes', '0 3 * * *'). */
  agendar(nome: string, cron: string, dados: object = {}): void {
    this.horarios.push({ nome, cron, dados });
  }

  /** Põe um trabalho na fila. `singletonKey` evita duplicados. */
  async enviar(
    nome: string,
    dados: object,
    opcoes: SendOptions = {},
  ): Promise<string | null> {
    const boss = await this.pronto;
    if (!boss) {
      this.logger.warn(`Sem filas: ${nome} não foi enviado.`);
      return null;
    }
    await this.garantirFila(boss, nome);
    return boss.send(nome, dados, {
      retryLimit: 3,
      retryBackoff: true,
      ...opcoes,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    const db =
      this.config.getOrThrow<ConfigType<typeof databaseConfig>>('database');
    const { workers } =
      this.config.getOrThrow<ConfigType<typeof jobsConfig>>('jobs');
    if (!db.enabled) {
      this.marcarPronto(null);
      return;
    }
    try {
      const { PgBoss } = await import('pg-boss');
      const boss = new PgBoss({
        host: db.host,
        port: db.port,
        user: db.user,
        password: db.password,
        database: db.database,
        ssl: db.ssl ? { rejectUnauthorized: false } : undefined,
        max: 4,
        schema: 'pgboss',
      });
      boss.on('error', (e: Error) =>
        this.logger.error(`pg-boss: ${e.message}`),
      );
      await boss.start();
      this.boss = boss;

      if (workers) {
        for (const [nome, { fn, opcoes }] of this.trabalhos) {
          await this.garantirFila(boss, nome);
          await boss.work<object>(
            nome,
            { localConcurrency: opcoes.concorrencia ?? 2 },
            async (jobs) => {
              for (const job of jobs) {
                try {
                  await fn(job.data, job);
                } catch (e) {
                  this.logger.error(
                    `${nome} ${job.id} falhou: ${(e as Error).message}`,
                  );
                  throw e;
                }
              }
            },
          );
        }
        for (const h of this.horarios) {
          await this.garantirFila(boss, h.nome);
          await boss.schedule(h.nome, h.cron, h.dados, { tz: FUSO });
        }
      }
      this.logger.log(
        `Filas prontas (${this.trabalhos.size} trabalhos, ${this.horarios.length} horários${workers ? '' : ', sem workers'})`,
      );
      this.marcarPronto(boss);
    } catch (e) {
      this.logger.error(`pg-boss não arrancou: ${(e as Error).message}`);
      this.marcarPronto(null);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop({ graceful: true, timeout: 10_000 });
  }

  private async garantirFila(boss: PgBoss, nome: string): Promise<void> {
    if (this.filas.has(nome)) return;
    if (!(await boss.getQueue(nome))) await boss.createQueue(nome);
    this.filas.add(nome);
  }
}
