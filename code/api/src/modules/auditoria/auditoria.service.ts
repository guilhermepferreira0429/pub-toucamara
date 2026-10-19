import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { DatabaseService, Tx } from '../../database/database.service.js';

export type AtorTipo = 'sistema' | 'agente' | 'utilizador' | 'municipe';

export interface Registo {
  municipioId: string | null;
  atorTipo: AtorTipo;
  atorId?: string | null;
  /** 'ver', 'ouvir_gravacao', 'aprovar', 'reatribuir', 'apagar_retencao'... */
  acao: string;
  objetoTipo: string;
  objetoId: string;
  dados?: Record<string, unknown>;
  ip?: string | null;
}

/** "Quem viu e alterou": só se acrescenta. */
@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(private readonly db: DatabaseService) {}

  async registar(r: Registo, tx?: Tx): Promise<void> {
    try {
      await (tx ?? this.db).query(
        `INSERT INTO audit_log (municipio_id, ator_tipo, ator_id, acao, objeto_tipo, objeto_id, dados, ip)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          r.municipioId,
          r.atorTipo,
          r.atorId ?? null,
          r.acao,
          r.objetoTipo,
          r.objetoId,
          JSON.stringify(r.dados ?? {}),
          r.ip ?? null,
        ],
      );
    } catch (e) {
      // Dentro de uma transação o erro tem de subir (a transação já falhou).
      if (tx) throw e;
      this.logger.error(`audit_log: ${(e as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [AuditoriaService], exports: [AuditoriaService] })
export class AuditoriaModule {}
