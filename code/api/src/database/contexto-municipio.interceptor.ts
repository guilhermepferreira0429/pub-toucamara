import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Pedido } from '../common/pedido.js';
import { contextoMunicipio } from './database.service.js';

/**
 * Pedidos do painel (com utilizador e município já resolvidos pelo
 * PainelGuard): o handler corre com o município no contexto, e cada consulta
 * à BD fica limitada a ele pelo RLS (DatabaseService, migração 0046).
 */
@Injectable()
export class ContextoMunicipioInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Pedido>();
    const municipioId = req.utilizador && req.municipio?.id;
    if (!municipioId) return next.handle();
    return new Observable((sub) =>
      contextoMunicipio.run({ municipioId }, () =>
        next.handle().subscribe(sub),
      ),
    );
  }
}
