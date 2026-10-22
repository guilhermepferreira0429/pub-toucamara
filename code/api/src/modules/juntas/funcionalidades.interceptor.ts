import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ErroApi } from '../../common/erros.js';
import type { Pedido } from '../../common/pedido.js';
import { painelDisponivel } from './funcionalidades.js';

/**
 * Feature flags por tipo de município no painel: numa junta, as áreas que
 * só a câmara tem (urbanismo, licenças, PDM…) respondem 404; numa câmara,
 * as que só a junta tem (atestados). Corre depois do PainelGuard (os
 * interceptors correm depois dos guards), com o município já resolvido.
 */
@Injectable()
export class FuncionalidadesInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<Pedido>();
    if (!req.utilizador || !req.municipio) return next.handle();
    const caminho = req.originalUrl ?? req.url ?? '';
    if (!painelDisponivel(req.municipio.tipo, caminho)) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'funcionalidade_indisponivel',
        req.municipio.tipo === 'junta'
          ? 'Esta área não faz parte da versão para juntas de freguesia: é tratada pela câmara.'
          : 'Esta área só existe no painel das juntas de freguesia.',
      );
    }
    return next.handle();
  }
}
