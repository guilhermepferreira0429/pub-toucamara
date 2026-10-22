import {
  applyDecorators,
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  Injectable,
  UseGuards,
} from '@nestjs/common';
import { ErroApi } from '../../common/erros.js';
import type { Pedido } from '../../common/pedido.js';
import { AppSessaoService, SessaoApp } from './app-sessao.service.js';

/** Pedido da app depois do AppGuard. */
export interface PedidoApp extends Pedido {
  sessaoApp?: SessaoApp;
}

/**
 * Valida o `Authorization: Bearer tca_…` da app do munícipe e põe no pedido
 * a sessão (munícipe) e o município. Sessão revogada ou desconhecida: 401.
 */
@Injectable()
export class AppGuard implements CanActivate {
  constructor(private readonly sessoes: AppSessaoService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PedidoApp>();
    const [tipo, token] = (req.header('authorization') ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'nao_autenticado',
        'Falta a sessão da app (Authorization: Bearer).',
      );
    }
    const s = await this.sessoes.porToken(token);
    if (!s) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'sessao_invalida',
        'A sessão da app terminou. Entre outra vez com o seu telemóvel.',
      );
    }
    req.sessaoApp = s;
    req.municipio = s.municipio;
    return true;
  }
}

/** Rota da app do munícipe (`/v1/app/...`). */
export function App() {
  return applyDecorators(UseGuards(AppGuard));
}

/** A sessão da app (só em rotas com @App()). */
export const SessaoAtual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessaoApp => {
    const s = ctx.switchToHttp().getRequest<PedidoApp>().sessaoApp;
    if (!s) throw new Error('Rota sem @App().');
    return s;
  },
);
