import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { esquemaPaginacao } from '../../common/paginacao.js';
import { MunicipioAtual } from '../../common/pedido.js';
import { validar } from '../../common/validacao.js';
import { Painel } from '../auth/painel.guard.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { assinaturaValida } from './multibanco.js';
import { PagamentosService } from './pagamentos.service.js';

const estadoPag = z.enum(['pendente', 'pago', 'expirado', 'cancelado']);
const metodoPag = z.enum(['multibanco', 'mbway', 'cartao']);

/**
 * Corpo genérico do webhook de pagamentos (o fornecedor real ainda não está
 * escolhido; o adaptador dele traduz para isto):
 *
 *   POST /v1/webhooks/pagamentos
 *   X-Assinatura: sha256=<hex do HMAC-SHA256 do corpo com PAGAMENTOS_WEBHOOK_SECRET>
 *   { "provider_ref": "...", "mb_referencia": "123456789", "mb_entidade": "99999",
 *     "valor_cent": 12340, "estado": "pago" }
 *
 * Basta `provider_ref` ou `mb_referencia`. `estado`: pago | expirado | cancelado.
 *
 * MB WAY: o mesmo corpo, com o `provider_ref` do pedido (sem `mb_*`).
 * `pago` paga o pagamento por MB WAY; `expirado` ou `cancelado` (recusado
 * na app) fecham só o pedido e o pagamento continua pendente (paga-se por
 * Multibanco ou com outro pedido).
 */
const esquemaWebhook = z
  .object({
    provider_ref: z.string().trim().min(1).max(200).optional(),
    mb_referencia: z
      .string()
      .transform((s) => s.replace(/\s/g, ''))
      .pipe(z.string().regex(/^\d{9}$/))
      .optional(),
    mb_entidade: z
      .string()
      .regex(/^\d{5}$/)
      .optional(),
    valor_cent: z.number().int().positive(),
    estado: estadoPag.exclude(['pendente']),
  })
  .refine((b) => b.provider_ref || b.mb_referencia, {
    message: 'Falta provider_ref ou mb_referencia.',
  });

@Controller('webhooks/pagamentos')
export class PagamentosWebhookController {
  private readonly logger = new Logger(PagamentosWebhookController.name);
  private avisado = false;

  constructor(
    private readonly pagamentos: PagamentosService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async receber(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-assinatura') assinatura: string | undefined,
    @Body() body: unknown,
  ) {
    this.verificarAssinatura(req.rawBody, assinatura);
    const dados = validar(esquemaWebhook, body);
    return this.pagamentos.registarResultado(dados, 'webhook');
  }

  /** Antes de tudo. Sem segredo: dev aceita com aviso, produção recusa. */
  private verificarAssinatura(corpo: Buffer | undefined, cabecalho?: string) {
    const segredo = this.config.get<string>('webhooks.pagamentosSegredo');
    if (!segredo) {
      if (this.config.get<string>('app.ambiente') === 'production') {
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'webhook_sem_segredo',
          'PAGAMENTOS_WEBHOOK_SECRET não está configurado.',
        );
      }
      if (!this.avisado) {
        this.logger.warn(
          'PAGAMENTOS_WEBHOOK_SECRET vazio: webhook de pagamentos sem assinatura (dev).',
        );
        this.avisado = true;
      }
      return;
    }
    if (!corpo || !assinaturaValida(corpo, cabecalho, segredo)) {
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'assinatura_invalida',
        'Assinatura do webhook em falta ou errada.',
      );
    }
  }
}

/** Página do link do SMS (pelo código do link, sem dados pessoais). */
@Controller('public/pagamentos')
export class PagamentosPublicoController {
  constructor(private readonly pagamentos: PagamentosService) {}

  @Get(':codigo')
  ver(@Param('codigo') codigo: string) {
    return this.pagamentos.publico(codigo);
  }

  /** Só para pagamentos em modo de teste: "pagar" na demo sem banco. */
  @Post(':codigo/simular-pagamento')
  @HttpCode(200)
  simular(@Param('codigo') codigo: string) {
    return this.pagamentos.simularPagamentoPublico(codigo);
  }

  /** Trocar de método no mesmo pagamento (MB WAY precisa do telemóvel). */
  @Post(':codigo/metodo')
  @HttpCode(200)
  metodo(@Param('codigo') codigo: string, @Body() body: unknown) {
    return this.pagamentos.trocarMetodoPublico(
      codigo,
      validar(esquemaMetodo, body),
    );
  }

  /** Só modo de teste e dentro da validade: "aceitar" o pedido MB WAY na demo. */
  @Post(':codigo/mbway/aceitar')
  @HttpCode(200)
  aceitarMbway(@Param('codigo') codigo: string) {
    return this.pagamentos.aceitarMbwayPublico(codigo);
  }

  /** Novo pedido MB WAY de teste, se o anterior expirou (máximo 3). */
  @Post(':codigo/mbway/reenviar')
  @HttpCode(200)
  reenviarMbway(@Param('codigo') codigo: string) {
    return this.pagamentos.reenviarMbwayPublico(codigo);
  }
}

const esquemaMetodo = z
  .object({
    metodo: z.enum(['multibanco', 'mbway']),
    telemovel: z.string().trim().min(9).max(20).optional(),
  })
  .refine((b) => b.metodo !== 'mbway' || b.telemovel, {
    message: 'Para MB WAY indique o telemovel.',
    path: ['telemovel'],
  });

const filtrosLista = esquemaPaginacao.extend({
  estado: estadoPag.optional(),
  metodo: metodoPag.optional(),
});

@Controller('painel')
@Painel('processos')
export class PagamentosPainelController {
  constructor(private readonly pagamentos: PagamentosService) {}

  @Get('pagamentos')
  listar(@MunicipioAtual() m: Municipio, @Query() query: unknown) {
    return this.pagamentos.listar(m.id, validar(filtrosLista, query));
  }

  /** A tabela de taxas em vigor hoje, com a fonte. */
  @Get('taxas')
  taxas(@MunicipioAtual() m: Municipio) {
    return this.pagamentos.tabelaEmVigor(m);
  }
}
