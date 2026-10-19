import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../common/erros.js';
import { iaConfig } from '../config/configuration.js';

export type Esforco = 'low' | 'medium' | 'high';

export interface PedidoIa {
  /** Instruções fixas da tarefa. Ficam em cache: não meter lá datas nem ids. */
  sistema: string;
  /** O que muda a cada pedido (transcrição, email, pergunta...). */
  conteudo: string;
  /** low para classificar, medium para resumir, high para redigir com cuidado. */
  esforco?: Esforco;
  maxTokens?: number;
}

// Se o modelo recusar por política, a API tenta o modelo de recurso definido
// pelo servidor dentro do mesmo pedido.
const RECURSO = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} as const;

/**
 * O Claude fora da chamada: resumos, classificação, rascunhos, evals. Na
 * chamada o modelo é configurado no ElevenLabs. Sem ANTHROPIC_API_KEY o
 * serviço fica indisponível (503) em vez de inventar resultados.
 */
@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly cliente: Anthropic | null;
  private readonly modelo: string;

  constructor(config: ConfigService) {
    const cfg = config.getOrThrow<ConfigType<typeof iaConfig>>('ia');
    this.modelo = cfg.modelo;
    this.cliente = cfg.apiKey ? new Anthropic({ apiKey: cfg.apiKey }) : null;
    if (!this.cliente) {
      this.logger.warn(
        'ANTHROPIC_API_KEY vazia: IA fora da chamada desligada.',
      );
    }
  }

  get disponivel(): boolean {
    return this.cliente !== null;
  }

  /** Resposta estruturada, validada pelo esquema Zod. */
  async extrair<E extends z.ZodType>(
    esquema: E,
    pedido: PedidoIa,
  ): Promise<z.infer<E>> {
    const resposta = await this.chamar(() =>
      this.api().beta.messages.parse({
        ...this.base(pedido),
        output_config: {
          effort: pedido.esforco ?? 'medium',
          format: betaZodOutputFormat(esquema),
        },
      }),
    );
    this.verificarFim(resposta);
    if (resposta.parsed_output == null) {
      throw new ErroApi(
        HttpStatus.BAD_GATEWAY,
        'ia_resposta_invalida',
        'A resposta da IA não respeitou o formato pedido.',
      );
    }
    return resposta.parsed_output;
  }

  /** Texto livre (rascunhos de email, reclamações, SMS). */
  async escrever(pedido: PedidoIa): Promise<string> {
    const resposta = await this.chamar(() =>
      this.api().beta.messages.create({
        ...this.base(pedido),
        output_config: { effort: pedido.esforco ?? 'medium' },
      }),
    );
    this.verificarFim(resposta);
    return resposta.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();
  }

  private api(): Anthropic {
    if (!this.cliente) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'IA não configurada (ANTHROPIC_API_KEY).',
      );
    }
    return this.cliente;
  }

  private base(pedido: PedidoIa) {
    return {
      betas: [...RECURSO.betas],
      fallbacks: RECURSO.fallbacks,
      model: this.modelo,
      max_tokens: pedido.maxTokens ?? 16000,
      system: [
        {
          type: 'text' as const,
          text: pedido.sistema,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user' as const, content: pedido.conteudo }],
    };
  }

  private verificarFim(resposta: Anthropic.Beta.BetaMessage): void {
    if (resposta.stop_reason === 'refusal') {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ia_recusou',
        'A IA recusou o pedido.',
        { categoria: resposta.stop_details?.category ?? null },
      );
    }
    if (resposta.stop_reason === 'max_tokens') {
      throw new ErroApi(
        HttpStatus.BAD_GATEWAY,
        'ia_resposta_cortada',
        'A resposta da IA chegou ao limite de tokens.',
      );
    }
  }

  /** Erros do fornecedor passam a 503 (tentar depois) ou 502 (o nosso pedido). */
  private async chamar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ErroApi) throw e;
      if (
        e instanceof Anthropic.RateLimitError ||
        e instanceof Anthropic.InternalServerError ||
        e instanceof Anthropic.APIConnectionError
      ) {
        this.logger.warn(`IA indisponível: ${e.message}`);
        throw new ErroApi(
          HttpStatus.SERVICE_UNAVAILABLE,
          'ia_indisponivel',
          'A IA está indisponível. Tentar daqui a pouco.',
        );
      }
      if (e instanceof Anthropic.APIError) {
        this.logger.error(`IA ${e.status}: ${e.message}`);
        throw new ErroApi(
          HttpStatus.BAD_GATEWAY,
          'ia_erro',
          'O pedido à IA falhou.',
        );
      }
      throw e;
    }
  }
}
