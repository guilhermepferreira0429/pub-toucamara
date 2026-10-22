import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErroApi } from '../../common/erros.js';
import type { Pedido } from '../../common/pedido.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { AuthService } from './auth.service.js';
import { pode, Recurso } from './permissoes.js';

const RECURSO = 'painel:recurso';
const CONSULTA = 'painel:consulta';

/** Métodos que não alteram nada: os únicos abertos a uma sessão só de leitura. */
const SO_LER = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Valida o `Authorization: Bearer <jwt>`, põe `req.utilizador` e
 * `req.municipio` e verifica a permissão do recurso. A equipa interna
 * (sem município) escolhe o município pelo header `X-Municipio`.
 */
@Injectable()
export class PainelGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly municipios: MunicipiosService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Pedido>();
    const [tipo, jwt] = (req.header('authorization') ?? '').split(' ');
    if (tipo !== 'Bearer' || !jwt) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'nao_autenticado',
        'Falta a sessão (Authorization: Bearer).',
      );
    }
    const u = await this.auth.verificar(jwt);
    req.utilizador = u;

    if (u.municipioId) {
      req.municipio = await this.municipios.porId(u.municipioId);
    } else {
      const slug = req.header('x-municipio');
      if (!slug) {
        throw new ErroApi(
          HttpStatus.BAD_REQUEST,
          'municipio_em_falta',
          'Equipa interna: indique o município no header X-Municipio.',
        );
      }
      req.municipio = await this.municipios.porSlug(slug);
    }

    // Acesso do júri: vê tudo, não altera nada (exceto as consultas por POST).
    if (
      u.soLeitura &&
      !SO_LER.has(req.method) &&
      !this.reflector.getAllAndOverride<boolean | undefined>(CONSULTA, [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    ) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'so_leitura',
        'Acesso de demonstração só de leitura: pode ver tudo, mas não pode alterar nada.',
      );
    }

    const recurso = this.reflector.getAllAndOverride<Recurso | undefined>(
      RECURSO,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (recurso && !pode(u.perfil, recurso)) {
      throw new ErroApi(
        HttpStatus.FORBIDDEN,
        'sem_permissao',
        'O seu perfil não tem acesso a esta área.',
        { recurso },
      );
    }
    return true;
  }
}

/**
 * Rota do painel. `@Painel('processos')` exige a permissão; `@Painel()` só
 * exige sessão. No método sobrepõe-se ao da classe.
 */
export function Painel(recurso?: Recurso) {
  return applyDecorators(SetMetadata(RECURSO, recurso), UseGuards(PainelGuard));
}

/**
 * Um POST que só consulta (perguntar, simular, pré-visualizar): aberto
 * também às sessões só de leitura. Nada do que grava pode levar isto.
 */
export const SoConsulta = () => SetMetadata(CONSULTA, true);
