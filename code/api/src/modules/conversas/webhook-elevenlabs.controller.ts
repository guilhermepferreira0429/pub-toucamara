import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import type { Request } from 'express';
import { ErroApi } from '../../common/erros.js';
import { validar } from '../../common/validacao.js';
import { webhooksConfig } from '../../config/configuration.js';
import { SegredoAgenteGuard } from '../agent-tools/agente.guard.js';
import {
  esquemaAudio,
  esquemaTranscricao,
  verificarAssinatura,
} from './elevenlabs.js';
import { FimChamadaService } from './fim-chamada.service.js';
import { esquemaInicioChamada } from './retomar.js';
import { RetomarService } from './retomar.service.js';

/**
 * Webhooks do ElevenLabs. Início da chamada: o contexto para retomar a
 * conversa. Fim da chamada (post-call): um só URL para a transcrição e para
 * o áudio; o `type` decide. Responde 200 depressa: o resumo e o SMS vão
 * para jobs.
 */
@Controller('webhooks/elevenlabs')
export class WebhookElevenLabsController {
  private readonly logger = new Logger(WebhookElevenLabsController.name);

  constructor(
    private readonly fimChamada: FimChamadaService,
    private readonly retomar: RetomarService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Início da chamada (conversation initiation client data webhook): o
   * ElevenLabs pede as variáveis dinâmicas enquanto o telefone ainda toca.
   * Sem IA e sem escrever nada, para responder em < 300 ms. O ElevenLabs não
   * assina este pedido: manda os headers configurados no webhook (segredo
   * guardado no ElevenLabs), aqui o mesmo `X-Agente-Segredo` das ferramentas.
   */
  @Post('inicio-chamada')
  @HttpCode(200)
  @UseGuards(SegredoAgenteGuard)
  inicioChamada(@Body() body: unknown) {
    return this.retomar.inicioChamada(
      validar(esquemaInicioChamada, body ?? {}),
    );
  }

  @Post('conversa-terminada')
  @HttpCode(200)
  async conversaTerminada(
    @Req() req: RawBodyRequest<Request>,
    @Headers('elevenlabs-signature') assinatura: string | undefined,
  ) {
    this.verificar(req.rawBody, assinatura);
    const corpo = req.body as { type?: unknown };

    switch (corpo?.type) {
      case 'post_call_transcription': {
        const { data } = validar(esquemaTranscricao, corpo);
        return this.fimChamada.transcricao(data);
      }
      case 'post_call_audio': {
        const { data } = validar(esquemaAudio, corpo);
        return this.fimChamada.audio(data);
      }
      default:
        // call_initiation_failure e tipos futuros: aceitar para não serem repetidos.
        this.logger.log(`Webhook ElevenLabs ignorado: ${String(corpo?.type)}`);
        return { ignorado: true };
    }
  }

  private verificar(
    rawBody: Buffer | undefined,
    assinatura: string | undefined,
  ) {
    const { elevenlabsSegredo } =
      this.config.getOrThrow<ConfigType<typeof webhooksConfig>>('webhooks');
    if (!elevenlabsSegredo) {
      if (this.config.get<string>('app.ambiente') === 'production') {
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'webhook_sem_segredo',
          'ELEVENLABS_WEBHOOK_SECRET por configurar.',
        );
      }
      this.logger.warn(
        'ELEVENLABS_WEBHOOK_SECRET vazio: webhook aceite sem verificar a assinatura (só em dev).',
      );
      return;
    }
    if (!rawBody) {
      throw new ErroApi(
        HttpStatus.BAD_REQUEST,
        'corpo_em_falta',
        'Corpo do pedido em falta.',
      );
    }
    const r = verificarAssinatura(assinatura, rawBody, elevenlabsSegredo);
    if (!r.valida) {
      this.logger.warn(`Assinatura do ElevenLabs recusada: ${r.motivo}`);
      throw new ErroApi(
        HttpStatus.UNAUTHORIZED,
        'assinatura_invalida',
        'Assinatura do webhook inválida.',
        { motivo: r.motivo },
      );
    }
  }
}
