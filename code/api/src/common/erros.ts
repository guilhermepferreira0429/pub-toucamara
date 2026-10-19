import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/** Corpo de erro de toda a API: `{ erro: { codigo, mensagem, detalhes } }`. */
export interface CorpoErro {
  erro: { codigo: string; mensagem: string; detalhes?: unknown };
}

/**
 * Erro com código estável (o agente, o chat e a web decidem pelo `codigo`,
 * nunca pela mensagem).
 */
export class ErroApi extends HttpException {
  constructor(
    status: HttpStatus,
    readonly codigo: string,
    mensagem: string,
    readonly detalhes?: unknown,
  ) {
    super(mensagem, status);
  }
}

const CODIGO_POR_ESTADO: Record<number, string> = {
  400: 'pedido_invalido',
  401: 'nao_autenticado',
  403: 'sem_permissao',
  404: 'nao_encontrado',
  409: 'conflito',
  422: 'nao_processavel',
  429: 'demasiados_pedidos',
  503: 'indisponivel',
};

/** Passa qualquer exceção para o formato `CorpoErro`. */
@Catch()
export class FiltroErros implements ExceptionFilter {
  private readonly logger = new Logger(FiltroErros.name);

  catch(e: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, corpo } = this.paraCorpo(e);
    res.status(status).json(corpo);
  }

  paraCorpo(e: unknown): { status: number; corpo: CorpoErro } {
    if (e instanceof ErroApi) {
      return {
        status: e.getStatus(),
        corpo: {
          erro: { codigo: e.codigo, mensagem: e.message, detalhes: e.detalhes },
        },
      };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const r = e.getResponse();
      const mensagem =
        typeof r === 'object' && r !== null && 'message' in r
          ? [r.message].flat().join('; ')
          : e.message;
      return {
        status,
        corpo: {
          erro: {
            codigo: CODIGO_POR_ESTADO[status] ?? 'erro',
            mensagem,
          },
        },
      };
    }
    this.logger.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    return {
      status: 500,
      corpo: { erro: { codigo: 'erro_interno', mensagem: 'Erro interno.' } },
    };
  }
}
