import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { ErroApi } from '../../common/erros.js';
import type { Pedido } from '../../common/pedido.js';
import { agenteConfig } from '../../config/configuration.js';
import { MunicipiosService } from '../municipios/municipios.service.js';

/** Compara em tempo constante (hash primeiro, para os tamanhos baterem). */
export function segredoIgual(recebido: string, esperado: string): boolean {
  const a = createHash('sha256').update(recebido).digest();
  const b = createHash('sha256').update(esperado).digest();
  return timingSafeEqual(a, b);
}

/**
 * Só o ElevenLabs (e o nosso chat) chamam as ferramentas: segredo partilhado
 * no header `X-Agente-Segredo`, configurado em cada ferramenta do agente.
 */
@Injectable()
export class SegredoAgenteGuard implements CanActivate {
  private readonly logger = new Logger(SegredoAgenteGuard.name);
  private avisado = false;

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const { segredo } =
      this.config.getOrThrow<ConfigType<typeof agenteConfig>>('agente');
    if (!segredo) {
      if (this.config.get<string>('app.ambiente') === 'production') {
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'agente_sem_segredo',
          'AGENTE_SEGREDO não está configurado.',
        );
      }
      if (!this.avisado) {
        this.logger.warn('AGENTE_SEGREDO vazio: ferramentas abertas (dev).');
        this.avisado = true;
      }
      return true;
    }
    const recebido = ctx
      .switchToHttp()
      .getRequest<Pedido>()
      .header('x-agente-segredo');
    if (!recebido || !segredoIgual(recebido, segredo)) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'nao_autenticado',
        'Segredo do agente em falta ou errado.',
      );
    }
    return true;
  }
}

/**
 * Cada município tem o seu agente no ElevenLabs, com o slug no header
 * `X-Municipio`. Fica em `req.municipio` (ver `@MunicipioAtual()`).
 */
@Injectable()
export class MunicipioGuard implements CanActivate {
  constructor(private readonly municipios: MunicipiosService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Pedido>();
    const slug = req.header('x-municipio');
    if (!slug) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'municipio_em_falta',
        'Falta o header X-Municipio.',
      );
    }
    req.municipio = await this.municipios.porSlug(slug);
    return true;
  }
}
