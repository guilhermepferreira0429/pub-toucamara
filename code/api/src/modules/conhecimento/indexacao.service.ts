import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { EmbeddingsService, paraVetor } from './embeddings.service.js';

/** Quantos trechos/frases se leem da BD de cada vez ao reindexar. */
const LOTE_BD = 64;

export interface DadosReindexar {
  municipio_id?: string;
  /** true = recalcula todos (mudou o fornecedor ou o modelo); senão só os que faltam. */
  todos?: boolean;
}

/**
 * Guarda os vetores de trechos e de frases. Falhar aqui nunca desfaz uma
 * ingestão nem uma resposta: os vetores ficam NULL e o job
 * `reindexar_embeddings` preenche-os depois.
 */
@Injectable()
export class IndexacaoService {
  private readonly logger = new Logger(IndexacaoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  get disponivel(): boolean {
    return this.embeddings.disponivel;
  }

  /** Vetores dos trechos (título da fonte + referência + texto). Devolve quantos ficaram. */
  async vetorizarTrechos(ids: string[]): Promise<number> {
    if (!this.disponivel || !ids.length) return 0;
    let feitos = 0;
    for (let i = 0; i < ids.length; i += LOTE_BD) {
      const linhas = await this.db.query<{ id: string; entrada: string }>(
        `SELECT t.id, concat_ws(E'\\n', fo.titulo, t.referencia, t.texto) AS entrada
         FROM trechos t
         JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
         JOIN fontes fo ON fo.id = fv.fonte_id
         WHERE t.id = ANY($1::uuid[])`,
        [ids.slice(i, i + LOTE_BD)],
      );
      feitos += await this.gravar('trechos', linhas, 'document');
    }
    return feitos;
  }

  /**
   * Vetores das frases "as pessoas perguntam assim". São perguntas, como a
   * do munícipe: vão como 'query' (na Voyage, pergunta contra pergunta).
   */
  async vetorizarFrases(ids: string[]): Promise<number> {
    if (!this.disponivel || !ids.length) return 0;
    let feitos = 0;
    for (let i = 0; i < ids.length; i += LOTE_BD) {
      const linhas = await this.db.query<{ id: string; entrada: string }>(
        `SELECT id, frase AS entrada FROM resposta_frases WHERE id = ANY($1::uuid[])`,
        [ids.slice(i, i + LOTE_BD)],
      );
      feitos += await this.gravar('resposta_frases', linhas, 'query');
    }
    return feitos;
  }

  /** Versão que não lança (depois de uma ingestão ou de gravar uma resposta). */
  async tentar(fn: () => Promise<number>, o_que: string): Promise<number> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(
        `Embeddings de ${o_que} ficam para reindexar: ${(e as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Job `reindexar_embeddings` (manual): percorre por id (keyset) os trechos
   * e as frases sem vetor, ou todos com `todos: true`.
   */
  async reindexar(
    d: DadosReindexar,
  ): Promise<{ trechos: number; frases: number }> {
    if (!this.disponivel) {
      this.logger.warn(
        'reindexar_embeddings sem EMBEDDINGS_PROVIDER: nada a fazer.',
      );
      return { trechos: 0, frases: 0 };
    }
    const municipio = d.municipio_id ?? null;
    const todos = d.todos === true;
    let trechos = 0;
    let frases = 0;

    let ultimo = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const ids = await this.db.query<{ id: string }>(
        `SELECT t.id FROM trechos t
         JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
         JOIN fontes fo ON fo.id = fv.fonte_id
         WHERE t.id > $1 AND ($2::boolean OR t.embedding IS NULL)
           AND ($3::uuid IS NULL OR fo.municipio_id = $3)
         ORDER BY t.id LIMIT $4`,
        [ultimo, todos, municipio, LOTE_BD],
      );
      if (!ids.length) break;
      trechos += await this.vetorizarTrechos(ids.map((x) => x.id));
      ultimo = ids[ids.length - 1].id;
    }

    ultimo = '00000000-0000-0000-0000-000000000000';
    for (;;) {
      const ids = await this.db.query<{ id: string }>(
        `SELECT f.id FROM resposta_frases f
         JOIN respostas r ON r.id = f.resposta_id
         WHERE f.id > $1 AND ($2::boolean OR f.embedding IS NULL)
           AND ($3::uuid IS NULL OR r.municipio_id = $3)
         ORDER BY f.id LIMIT $4`,
        [ultimo, todos, municipio, LOTE_BD],
      );
      if (!ids.length) break;
      frases += await this.vetorizarFrases(ids.map((x) => x.id));
      ultimo = ids[ids.length - 1].id;
    }

    this.logger.log(
      `reindexar_embeddings: ${trechos} trechos, ${frases} frases.`,
    );
    return { trechos, frases };
  }

  private async gravar(
    tabela: 'trechos' | 'resposta_frases',
    linhas: { id: string; entrada: string }[],
    tipo: 'query' | 'document',
  ): Promise<number> {
    if (!linhas.length) return 0;
    const vetores = await this.embeddings.varios(
      linhas.map((l) => l.entrada),
      tipo,
    );
    await this.db.query(
      `UPDATE ${tabela} x SET embedding = v.e::vector
       FROM unnest($1::uuid[], $2::text[]) AS v(id, e)
       WHERE x.id = v.id`,
      [linhas.map((l) => l.id), vetores.map(paraVetor)],
    );
    return linhas.length;
  }
}
