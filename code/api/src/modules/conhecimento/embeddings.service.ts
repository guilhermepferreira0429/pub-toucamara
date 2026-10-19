import { Injectable, Logger } from '@nestjs/common';
import { ConfigService, ConfigType } from '@nestjs/config';
import { embeddingsConfig } from '../../config/configuration.js';

/** A coluna `vector(1024)` de trechos, frases e perguntas sem resposta. */
export const DIMENSAO = 1024;

/**
 * 'query' para o que se procura (a pergunta do munícipe e as frases "as
 * pessoas perguntam assim"); 'document' para o que se encontra (trechos).
 * Só a Voyage distingue; no Ollama é igual.
 */
export type TipoEntrada = 'query' | 'document';

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const MODELO_VOYAGE = 'voyage-3.5';
const MODELO_OLLAMA = 'bge-m3';
/** Textos por pedido ao fornecedor (a Voyage aceita até 1000). */
const LOTE = 64;
/** Pesquisa durante a chamada: se não vier a tempo, segue só com texto. */
export const TIMEOUT_PERGUNTA_MS = 250;
/** Ingestão e reindexação: fora da chamada, pode esperar mais. */
const TIMEOUT_LOTE_MS = 30_000;

/**
 * Embeddings para a pesquisa híbrida (decisão 6 do plano): Voyage AI ou
 * Ollama local (bge-m3), sempre 1024 dimensões. Sem EMBEDDINGS_PROVIDER fica
 * `disponivel = false` e a pesquisa é só por texto.
 *
 * Ao mudar de fornecedor ou de modelo os vetores antigos deixam de ser
 * comparáveis: correr o job `reindexar_embeddings` com `todos: true`.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly cfg: ConfigType<typeof embeddingsConfig>;

  constructor(config: ConfigService) {
    this.cfg =
      config.getOrThrow<ConfigType<typeof embeddingsConfig>>('embeddings');
    if (this.cfg.provider === 'voyage' && !this.cfg.apiKey) {
      this.logger.warn('EMBEDDINGS_PROVIDER=voyage sem EMBEDDINGS_API_KEY.');
    }
    if (this.cfg.provider === 'ollama' && !this.cfg.url) {
      this.logger.warn('EMBEDDINGS_PROVIDER=ollama sem EMBEDDINGS_URL.');
    }
    if (
      this.cfg.provider &&
      !['voyage', 'ollama'].includes(this.cfg.provider)
    ) {
      this.logger.warn(
        `EMBEDDINGS_PROVIDER desconhecido: ${this.cfg.provider}. Só texto.`,
      );
    }
  }

  get disponivel(): boolean {
    return (
      (this.cfg.provider === 'voyage' && !!this.cfg.apiKey) ||
      (this.cfg.provider === 'ollama' && !!this.cfg.url)
    );
  }

  get modelo(): string {
    if (this.cfg.modelo) return this.cfg.modelo;
    return this.cfg.provider === 'ollama' ? MODELO_OLLAMA : MODELO_VOYAGE;
  }

  /**
   * O vetor da pergunta, para a pesquisa durante a chamada. Nunca lança:
   * desligado, lento (> timeout) ou com erro devolve null e a pesquisa
   * segue só por texto.
   */
  async pergunta(
    texto: string,
    timeoutMs = TIMEOUT_PERGUNTA_MS,
  ): Promise<number[] | null> {
    if (!this.disponivel) return null;
    try {
      const [v] = await this.pedir([texto], 'query', timeoutMs);
      return v ?? null;
    } catch (e) {
      this.logger.warn(`Embedding da pergunta falhou: ${(e as Error).message}`);
      return null;
    }
  }

  /** Vetores de vários textos, em lotes. Lança se o fornecedor falhar. */
  async varios(textos: string[], tipo: TipoEntrada): Promise<number[][]> {
    if (!this.disponivel) {
      throw new Error('Embeddings desligados (EMBEDDINGS_PROVIDER).');
    }
    const fora: number[][] = [];
    for (let i = 0; i < textos.length; i += LOTE) {
      fora.push(
        ...(await this.pedir(textos.slice(i, i + LOTE), tipo, TIMEOUT_LOTE_MS)),
      );
    }
    return fora;
  }

  private async pedir(
    textos: string[],
    tipo: TipoEntrada,
    timeoutMs: number,
  ): Promise<number[][]> {
    if (!textos.length) return [];
    const vetores =
      this.cfg.provider === 'voyage'
        ? await this.voyage(textos, tipo, timeoutMs)
        : await this.ollama(textos, timeoutMs);
    if (vetores.length !== textos.length) {
      throw new Error(
        `Pedidos ${textos.length} embeddings, vieram ${vetores.length}.`,
      );
    }
    for (const v of vetores) {
      if (!Array.isArray(v) || v.length !== DIMENSAO) {
        throw new Error(
          `O modelo ${this.modelo} devolveu ${Array.isArray(v) ? v.length : '?'} dimensões; a coluna tem ${DIMENSAO}.`,
        );
      }
    }
    return vetores;
  }

  /** POST /v1/embeddings: { data: [{ embedding, index }] }. */
  private async voyage(
    textos: string[],
    tipo: TipoEntrada,
    timeoutMs: number,
  ): Promise<number[][]> {
    const corpo = await pedirJson(
      VOYAGE_URL,
      {
        input: textos,
        model: this.modelo,
        input_type: tipo,
        truncation: true,
      },
      timeoutMs,
      { Authorization: `Bearer ${this.cfg.apiKey}` },
    );
    const dados = (corpo as { data?: { embedding: number[]; index: number }[] })
      .data;
    if (!Array.isArray(dados)) throw new Error('Voyage: resposta sem data.');
    return [...dados].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  /** POST {url}/api/embed: { embeddings: number[][] }. */
  private async ollama(
    textos: string[],
    timeoutMs: number,
  ): Promise<number[][]> {
    const corpo = await pedirJson(
      `${this.cfg.url}/api/embed`,
      { model: this.modelo, input: textos },
      timeoutMs,
    );
    const v = (corpo as { embeddings?: number[][] }).embeddings;
    if (!Array.isArray(v)) throw new Error('Ollama: resposta sem embeddings.');
    return v;
  }
}

async function pedirJson(
  url: string,
  corpo: object,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const txt = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`HTTP ${res.status} ${txt}`);
  }
  return res.json();
}

/** Literal do pgvector: '[0.1,0.2,...]' (passar como $n::vector). */
export function paraVetor(v: number[]): string {
  return `[${v.join(',')}]`;
}
