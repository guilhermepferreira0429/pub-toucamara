import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service.js';
import { EmbeddingsService, paraVetor } from './embeddings.service.js';
import { linguasDaPesquisa } from './lingua.js';
import { rrf } from './rrf.js';
import {
  CONSULTA_OU,
  EM_VIGOR,
  FONTE_JSON,
  INICIO_VIGOR,
  VERSAO_ATUAL,
  VERSAO_EM,
} from './sql.js';

export interface Fonte {
  trecho_id: string;
  referencia: string | null;
  titulo: string;
  url: string;
  entidade: string;
  lida_em: string;
}

export interface RespostaCurada {
  resposta_id: string;
  pergunta: string;
  texto: string;
  passa_a_pessoa_quando: string[];
  pontuacao: number;
  fontes: Fonte[];
}

export interface Trecho extends Fonte {
  texto: string;
  tipo_fonte: string;
  pontuacao: number;
}

export interface ResultadoPesquisa {
  sem_fonte: boolean;
  respostas: RespostaCurada[];
  trechos: Trecho[];
}

/**
 * Limiares de `sem_fonte` (por afinar com as perguntas de avaliação):
 *
 * - `similaridadeMinima`: um resultado só por vetores (cosseno = 1 − distância)
 *   abaixo disto não conta. Os vizinhos mais próximos existem sempre; sem
 *   limiar nunca haveria `sem_fonte`. 0,5 serve para voyage-3.5 e bge-m3.
 * - `textoMinimo`: ts_rank_cd normalizado (0..1) abaixo disto não conta. A
 *   consulta é OU de lexemas, por isso uma palavra solta já acerta.
 *
 * `sem_fonte` = nenhuma resposta curada e nenhum trecho acima dos limiares.
 */
export const LIMIARES = {
  similaridadeMinima: 0.5,
  textoMinimo: 0.01,
};

/** Respostas curadas devolvidas no máximo. */
const MAX_RESPOSTAS = 3;
/** Candidatos de cada lista antes de fundir. */
const CANDIDATOS = 20;
/** Quanto o HNSW explora com filtros (município, versão atual, vigência). */
const EF_SEARCH = 100;

type LinhaTrecho = Trecho & { similaridade?: number };

export interface TrechoEm extends Trecho {
  versao_id: string;
  /** Desde quando valia a versão (data legal, senão a primeira leitura). */
  vigor_desde: string;
  vigor_ate: string | null;
  /** A versão ainda é a de hoje. */
  versao_atual: boolean;
}
type LinhaTrechoEm = TrechoEm & { pontuacao: number };

export interface ResultadoPesquisaEm {
  em_data: string;
  sem_fonte: boolean;
  respostas: [];
  trechos: TrechoEm[];
  /** Alguma das regras desse dia já não é a de hoje. */
  mudou_desde: boolean;
}
type LinhaResposta = RespostaCurada & { similaridade?: number };

/**
 * Pesquisa do agente (secção 5.3): primeiro as respostas curadas que estão no
 * ar, depois os trechos das versões atuais das fontes em vigor.
 *
 * Híbrida quando há embeddings: texto completo + vetores (HNSW), fundidos por
 * Reciprocal Rank Fusion. Orçamento p95 < 400 ms: o texto corre ao mesmo
 * tempo que o pedido do vetor da pergunta (uma ida ao fornecedor, timeout de
 * 250 ms); se o vetor não vier, a resposta é só por texto.
 */
@Injectable()
export class ConhecimentoService {
  private readonly logger = new Logger(ConhecimentoService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async procurar(
    municipioId: string,
    pergunta: string,
    limite = 5,
  ): Promise<ResultadoPesquisa> {
    const candidatos = Math.max(CANDIDATOS, limite * 2);
    // Português sempre; as versões noutra língua (turismo) só quando a
    // pergunta vem nessa língua.
    const linguas = linguasDaPesquisa(pergunta);
    const vetorPromessa = this.embeddings.pergunta(pergunta);
    const textoPromessa = Promise.all([
      this.respostasPorTexto(municipioId, pergunta),
      this.trechosPorTexto(municipioId, pergunta, candidatos, linguas),
    ]);

    const vetor = await vetorPromessa;
    const [porVetor, [respostasTexto, trechosTexto]] = await Promise.all([
      vetor
        ? this.porVetor(municipioId, vetor, candidatos, linguas).catch(
            (e: Error) => {
              this.logger.warn(`Pesquisa por vetores falhou: ${e.message}`);
              return null;
            },
          )
        : Promise.resolve(null),
      textoPromessa,
    ]);

    const respostas = rrf(
      [
        respostasTexto.filter((r) => r.pontuacao >= LIMIARES.textoMinimo),
        (porVetor?.respostas ?? []).filter(
          (r) => (r.similaridade ?? 0) >= LIMIARES.similaridadeMinima,
        ),
      ],
      (r) => r.resposta_id,
    )
      .slice(0, MAX_RESPOSTAS)
      .map(({ item, pontuacao }) => ({
        resposta_id: item.resposta_id,
        pergunta: item.pergunta,
        texto: item.texto,
        passa_a_pessoa_quando: item.passa_a_pessoa_quando,
        pontuacao: arredondar(pontuacao),
        fontes: item.fontes,
      }));

    const trechos = rrf(
      [
        trechosTexto.filter((t) => t.pontuacao >= LIMIARES.textoMinimo),
        (porVetor?.trechos ?? []).filter(
          (t) => (t.similaridade ?? 0) >= LIMIARES.similaridadeMinima,
        ),
      ],
      (t) => t.trecho_id,
    )
      .slice(0, limite)
      .map(({ item, pontuacao }) => ({
        trecho_id: item.trecho_id,
        referencia: item.referencia,
        texto: item.texto,
        titulo: item.titulo,
        url: item.url,
        tipo_fonte: item.tipo_fonte,
        entidade: item.entidade,
        lida_em: item.lida_em,
        pontuacao: arredondar(pontuacao),
      }));

    return {
      sem_fonte: respostas.length === 0 && trechos.length === 0,
      respostas,
      trechos,
    };
  }

  /**
   * "Que regra valia no dia X": os trechos das versões que estavam em vigor
   * nesse dia (só por texto; as respostas curadas são as de hoje e ficam de
   * fora). Cada trecho diz de quando a quando valia a versão e se ainda é a
   * atual, para o agente avisar quando a regra mudou entretanto.
   */
  async procurarEm(
    municipioId: string,
    pergunta: string,
    dia: string,
    limite = 5,
  ): Promise<ResultadoPesquisaEm> {
    const linhas = await this.db.query<LinhaTrechoEm>(
      `WITH c AS (${CONSULTA_OU(2)})
       SELECT ${TRECHO_COLUNAS}, fv.id AS versao_id,
              to_char(${INICIO_VIGOR('fv')}, 'YYYY-MM-DD') AS vigor_desde,
              to_char(fv.vigor_ate, 'YYYY-MM-DD') AS vigor_ate,
              (fv.id = (SELECT v.id FROM fonte_versoes v
                        WHERE v.fonte_id = fo.id AND ${EM_VIGOR('v')}
                        ORDER BY v.lida_em DESC LIMIT 1)) AS versao_atual,
              ts_rank_cd(t.tsv, c.q, 32)::float8 AS pontuacao
       FROM c, trechos t
       ${TRECHO_JUNCOES}
       WHERE fo.municipio_id = $1 AND e.ativo
         AND t.tsv @@ c.q
         AND ${VERSAO_EM(3)}
       ORDER BY pontuacao DESC
       LIMIT $4`,
      [municipioId, pergunta, dia, limite],
    );
    const trechos = linhas
      .filter((t) => t.pontuacao >= LIMIARES.textoMinimo)
      .map((t) => ({ ...t, pontuacao: arredondar(t.pontuacao) }));
    return {
      em_data: dia,
      sem_fonte: trechos.length === 0,
      respostas: [],
      trechos,
      mudou_desde: trechos.some((t) => !t.versao_atual),
    };
  }

  private respostasPorTexto(municipioId: string, pergunta: string) {
    return this.db.query<LinhaResposta>(
      `WITH c AS (${CONSULTA_OU(2)}),
       r AS (
         SELECT r.id, r.pergunta_tipo, rv.id AS versao_id, rv.texto_voz,
                rv.passa_a_pessoa_quando,
                to_tsvector('pt_unaccent', r.pergunta_tipo || ' ' || coalesce(
                  (SELECT string_agg(frase, ' ') FROM resposta_frases WHERE resposta_id = r.id), ''
                )) AS tsv
         FROM respostas r
         JOIN resposta_versoes rv ON rv.id = r.versao_no_ar_id
         WHERE r.municipio_id = $1 AND r.estado = 'no_ar'
       )
       SELECT r.id AS resposta_id, r.pergunta_tipo AS pergunta,
              r.texto_voz AS texto, r.passa_a_pessoa_quando,
              ts_rank_cd(r.tsv, c.q, 32)::float8 AS pontuacao,
              ${FONTES_DA_VERSAO('r.versao_id')} AS fontes
       FROM r, c
       WHERE r.tsv @@ c.q
       ORDER BY pontuacao DESC
       LIMIT 10`,
      [municipioId, pergunta],
    );
  }

  private trechosPorTexto(
    municipioId: string,
    pergunta: string,
    limite: number,
    linguas: string[],
  ) {
    return this.db.query<LinhaTrecho>(
      `WITH c AS (${CONSULTA_OU(2)})
       SELECT ${TRECHO_COLUNAS},
              ts_rank_cd(t.tsv, c.q, 32)::float8 AS pontuacao
       FROM c, trechos t
       ${TRECHO_JUNCOES}
       WHERE fo.municipio_id = $1 AND e.ativo
         AND t.tsv @@ c.q
         AND fo.lingua = ANY($4::text[])
         AND ${EM_VIGOR('t')} AND ${VERSAO_ATUAL}
       ORDER BY pontuacao DESC
       LIMIT $3`,
      [municipioId, pergunta, limite, linguas],
    );
  }

  /**
   * Vetores: trechos pelo índice HNSW e respostas pela frase mais parecida.
   * Os filtros (município, versão atual) vêm depois do índice; com
   * `iterative_scan` o pgvector continua a procurar até ter `limite` linhas.
   * SET LOCAL só vale dentro da transação.
   */
  private porVetor(
    municipioId: string,
    vetor: number[],
    limite: number,
    linguas: string[],
  ) {
    const v = paraVetor(vetor);
    return this.db.transaction(async (tx) => {
      await tx.query(
        `SELECT set_config('hnsw.iterative_scan', 'relaxed_order', true),
                set_config('hnsw.ef_search', $1, true)`,
        [String(EF_SEARCH)],
      );
      const trechos = await tx.query<LinhaTrecho>(
        `WITH perto AS MATERIALIZED (
           SELECT ${TRECHO_COLUNAS},
                  (t.embedding <=> $2::vector)::float8 AS distancia
           FROM trechos t
           ${TRECHO_JUNCOES}
           WHERE fo.municipio_id = $1 AND e.ativo AND t.embedding IS NOT NULL
             AND fo.lingua = ANY($4::text[])
             AND ${EM_VIGOR('t')} AND ${VERSAO_ATUAL}
           ORDER BY t.embedding <=> $2::vector
           LIMIT $3
         )
         SELECT *, 1 - distancia AS similaridade, 0::float8 AS pontuacao
         FROM perto ORDER BY distancia`,
        [municipioId, v, limite, linguas],
      );
      const respostas = await tx.query<LinhaResposta>(
        `WITH f AS (
           SELECT f.resposta_id, max(1 - (f.embedding <=> $2::vector))::float8 AS similaridade
           FROM resposta_frases f
           JOIN respostas r ON r.id = f.resposta_id
           WHERE r.municipio_id = $1 AND r.estado = 'no_ar' AND f.embedding IS NOT NULL
           GROUP BY f.resposta_id
           ORDER BY similaridade DESC
           LIMIT 10
         )
         SELECT r.id AS resposta_id, r.pergunta_tipo AS pergunta,
                rv.texto_voz AS texto, rv.passa_a_pessoa_quando,
                f.similaridade, 0::float8 AS pontuacao,
                ${FONTES_DA_VERSAO('rv.id')} AS fontes
         FROM f
         JOIN respostas r ON r.id = f.resposta_id
         JOIN resposta_versoes rv ON rv.id = r.versao_no_ar_id
         ORDER BY f.similaridade DESC`,
        [municipioId, v],
      );
      return { trechos, respostas };
    });
  }
}

const TRECHO_COLUNAS = `t.id AS trecho_id, t.referencia, t.texto, fo.titulo, fo.url,
  fo.tipo AS tipo_fonte, e.nome AS entidade, fv.lida_em`;

const TRECHO_JUNCOES = `JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
  JOIN fontes fo ON fo.id = fv.fonte_id
  JOIN entidades e ON e.id = fo.entidade_id`;

const FONTES_DA_VERSAO = (versao: string) => `coalesce((
  SELECT jsonb_agg(${FONTE_JSON} ORDER BY fo.titulo, t.ordem)
  FROM resposta_fontes rf
  JOIN trechos t ON t.id = rf.trecho_id
  JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
  JOIN fontes fo ON fo.id = fv.fonte_id
  JOIN entidades e ON e.id = fo.entidade_id
  WHERE rf.resposta_versao_id = ${versao}
), '[]')`;

function arredondar(n: number): number {
  return Math.round(n * 10000) / 10000;
}
