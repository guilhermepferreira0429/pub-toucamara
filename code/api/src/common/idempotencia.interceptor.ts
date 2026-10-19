import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { mergeMap, Observable, of } from 'rxjs';
import { DatabaseService } from '../database/database.service.js';
import { ErroApi } from './erros.js';
import type { Pedido } from './pedido.js';

/**
 * Com `Idempotency-Key`, a mesma chave devolve a resposta guardada da primeira
 * vez em vez de voltar a executar. Só se guardam respostas de sucesso: um erro
 * pode ser tentado outra vez com a mesma chave.
 */
@Injectable()
export class IdempotenciaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotenciaInterceptor.name);

  constructor(private readonly db: DatabaseService) {}

  async intercept(
    ctx: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = ctx.switchToHttp().getRequest<Pedido>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const chave = req.header('idempotency-key')?.trim();
    if (!chave) return next.handle();
    if (chave.length > 200) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'pedido_invalido',
        'Idempotency-Key com mais de 200 caracteres.',
      );
    }

    const rota = `${req.method} ${req.originalUrl.split('?')[0]}`;
    const [anterior] = await this.db.query<{
      rota: string;
      estado_http: number;
      resposta: unknown;
    }>(
      'SELECT rota, estado_http, resposta FROM pedidos_idempotentes WHERE chave = $1',
      [chave],
    );
    if (anterior) {
      if (anterior.rota !== rota) {
        throw new ErroApi(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'chave_reutilizada',
          'Esta Idempotency-Key já foi usada noutro pedido.',
        );
      }
      res.status(anterior.estado_http);
      return of(anterior.resposta);
    }

    return next.handle().pipe(
      mergeMap(async (corpo: unknown) => {
        try {
          await this.db.query(
            `INSERT INTO pedidos_idempotentes (chave, municipio_id, rota, estado_http, resposta)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (chave) DO NOTHING`,
            [
              chave,
              req.municipio?.id ?? null,
              rota,
              res.statusCode,
              JSON.stringify(corpo ?? null),
            ],
          );
        } catch (e) {
          // A resposta já foi produzida; falhar a gravação só tira a proteção.
          this.logger.error(
            `Não guardou a chave ${chave}: ${(e as Error).message}`,
          );
        }
        return corpo;
      }),
    );
  }
}
