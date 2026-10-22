import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { z } from 'zod';
import { ErroApi } from '../common/erros.js';
import { iaConfig } from '../config/configuration.js';
import { tokensDe } from './precos.js';
import { UsoIaService } from './uso-ia.service.js';

/** Imagens que o Claude lê; PDF vai como documento. */
export const MIMES_VISAO = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
] as const;

export type MimeVisao = (typeof MIMES_VISAO)[number];

/**
 * O que se lê da fotografia de um documento. A data vem como o modelo a leu;
 * quem decide (validade, assinatura, NIF) são as regras, não o modelo. O NIF
 * lido serve só para comparar com o do requerente: nunca se guarda.
 */
export const esquemaLeituraDocumento = z.object({
  tipo_reconhecido: z
    .string()
    .describe(
      'O tipo de documento que se vê, em português (ex.: "Certidão do registo predial"). "Desconhecido" se não se percebe.',
    ),
  corresponde_ao_esperado: z
    .boolean()
    .describe('Se é o documento esperado (o mesmo tipo, não um parecido).'),
  confianca: z
    .enum(['alta', 'media', 'baixa'])
    .describe('Confiança em corresponde_ao_esperado.'),
  legivel: z
    .boolean()
    .describe(
      'Se o texto principal se lê (não está desfocado, cortado, escuro ou com reflexos).',
    ),
  data_emissao: z
    .string()
    .nullable()
    .describe(
      'Data de emissão (ou da certidão/validação) em AAAA-MM-DD; null se não se vê.',
    ),
  entidade_emissora: z
    .string()
    .nullable()
    .describe(
      'Quem emitiu (conservatória, câmara, finanças...); null se não se vê.',
    ),
  tem_assinatura_ou_carimbo: z
    .boolean()
    .describe(
      'Se há assinatura, carimbo, selo ou código de validação visível.',
    ),
  nif_visivel: z
    .string()
    .nullable()
    .describe(
      'O NIF do titular/requerente (9 dígitos, sem espaços) se estiver visível; null se não.',
    ),
  observacoes: z
    .string()
    .describe(
      'Uma ou duas frases curtas em português de Portugal para o munícipe (o que falta ou está mal na foto). Sem repetir o NIF.',
    ),
});

export type LeituraDocumento = z.infer<typeof esquemaLeituraDocumento>;

export interface PedidoVisao {
  ficheiro: Buffer;
  mime: MimeVisao;
  /** Nome do documento pedido ('Certidão do registo predial'). */
  esperado: string;
  /** O que vai ser verificado, em palavras, para o modelo saber onde olhar. */
  verificacoes?: string[];
}

// Fixo para ficar em cache: nada de datas, nomes ou ids aqui.
const SISTEMA = `És um assistente de atendimento de uma câmara municipal portuguesa.
Recebes a fotografia (ou PDF) de um documento que um munícipe vai entregar com um requerimento e o nome do documento que é pedido.
Lê o documento e preenche os campos pedidos, só com o que se vê:
- Não inventes: se uma data, entidade ou NIF não se lê, devolve null.
- corresponde_ao_esperado só é verdadeiro se for o mesmo tipo de documento (uma caderneta predial não é uma certidão do registo predial).
- A data de emissão é a da emissão, certidão ou validação do documento, não datas que apareçam no conteúdo (ex.: data de uma escritura antiga).
- Se a foto estiver desfocada, cortada ou ilegível, diz legivel: false e explica nas observações como tirar outra.
- As observações são para o munícipe: curtas, simples, em português de Portugal.`;

const RECURSO = {
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default',
} as const;

/** Bloco de conteúdo para o Claude: imagem ou documento PDF, em base64. */
export function blocoFicheiro(
  ficheiro: Buffer,
  mime: MimeVisao,
):
  Anthropic.Beta.BetaImageBlockParam | Anthropic.Beta.BetaRequestDocumentBlock {
  const data = ficheiro.toString('base64');
  if (mime === 'application/pdf') {
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data },
    };
  }
  return { type: 'image', source: { type: 'base64', media_type: mime, data } };
}

/**
 * Leitura de documentos por fotografia (Claude com visão), fora da chamada.
 * Sem ANTHROPIC_API_KEY responde 503 `ia_indisponivel`: nunca se inventa
 * uma verificação.
 */
@Injectable()
export class VisaoService {
  private readonly logger = new Logger(VisaoService.name);
  protected cliente: Anthropic | null;
  private readonly modelo: string;

  constructor(
    config: ConfigService,
    @Optional() private readonly uso?: UsoIaService,
  ) {
    const cfg = config.getOrThrow<ConfigType<typeof iaConfig>>('ia');
    this.modelo = cfg.modelo;
    this.cliente = cfg.apiKey ? new Anthropic({ apiKey: cfg.apiKey }) : null;
  }

  get disponivel(): boolean {
    return this.cliente !== null;
  }

  async lerDocumento(pedido: PedidoVisao): Promise<LeituraDocumento> {
    const cliente = this.api();
    const texto =
      `Documento pedido: ${pedido.esperado}.` +
      (pedido.verificacoes?.length
        ? `\nVai ser verificado: ${pedido.verificacoes.join('; ')}.`
        : '');
    const resposta = await this.chamar(() =>
      cliente.beta.messages.parse({
        ...RECURSO,
        betas: [...RECURSO.betas],
        model: this.modelo,
        max_tokens: 4000,
        system: [
          {
            type: 'text',
            text: SISTEMA,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              blocoFicheiro(pedido.ficheiro, pedido.mime),
              { type: 'text', text: texto },
            ],
          },
        ],
        output_config: {
          effort: 'medium',
          format: betaZodOutputFormat(esquemaLeituraDocumento),
        },
      }),
    );
    void this.uso?.registar({
      tarefa: 'ler_documento',
      modelo: this.modelo,
      resultado: resposta.stop_reason === 'refusal' ? 'recusa' : 'ok',
      tokens: tokensDe(resposta.usage),
    });
    if (resposta.stop_reason === 'refusal') {
      throw new ErroApi(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ia_recusou',
        'A IA recusou ler este documento.',
        { categoria: resposta.stop_details?.category ?? null },
      );
    }
    if (resposta.stop_reason === 'max_tokens' || !resposta.parsed_output) {
      throw new ErroApi(
        HttpStatus.BAD_GATEWAY,
        'ia_resposta_invalida',
        'A resposta da IA não respeitou o formato pedido.',
      );
    }
    return resposta.parsed_output;
  }

  private api(): Anthropic {
    if (!this.cliente) {
      throw new ErroApi(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ia_indisponivel',
        'A verificação por fotografia não está disponível (IA não configurada).',
      );
    }
    return this.cliente;
  }

  /** Como no ClaudeService: 503 para tentar depois, 502 se o pedido falhou. */
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
          'A leitura do documento falhou.',
        );
      }
      throw e;
    }
  }
}
