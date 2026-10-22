import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { DatabaseService, Tx } from '../../database/database.service.js';
import type { ContextoFerramenta } from '../../ferramentas/ferramenta.js';
import {
  EmbeddingsService,
  paraVetor,
} from '../conhecimento/embeddings.service.js';
import { rrf } from '../conhecimento/rrf.js';
import { CONSULTA_OU } from '../conhecimento/sql.js';
import { dataPorExtenso, deliberacoesDaAta, limparConsulta } from './regras.js';
import {
  ConteudoAta,
  FILTROS_VOTACAO,
  FiltroVotacao,
  NOME_ORGAO,
  NOME_RESULTADO,
  ORGAOS,
  Orgao,
  Resultado,
  VotoForca,
} from './tipos.js';

const data = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data AAAA-MM-DD.')
  .optional();

export const esquemaPesquisa = z.object({
  q: z.string().trim().max(300).optional(),
  de: data,
  ate: data,
  orgao: z.enum(ORGAOS).optional(),
  votacao: z.enum(FILTROS_VOTACAO).optional(),
  limite: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pesquisa = z.infer<typeof esquemaPesquisa>;

export const entradaProcurarDeliberacoes = z.object({
  assunto: z
    .string()
    .trim()
    .min(2)
    .max(300)
    .describe('O assunto, como a pessoa o disse.'),
  orgao: z.enum(ORGAOS).optional().describe('Só se a pessoa disser.'),
});

/** Um resultado de texto abaixo disto não conta (como no conhecimento). */
const TEXTO_MINIMO = 0.01;
/** Semelhança (cosseno) mínima para um resultado só por vetores. */
const SIMILARIDADE_MINIMA = 0.5;

interface LinhaDeliberacao {
  id: string;
  orgao: Orgao;
  data: string;
  reuniao_numero: string;
  reuniao_tipo: string;
  ponto_numero: number;
  titulo: string;
  proposta: string;
  deliberacao: string;
  resultado: Resultado;
  votacao: VotoForca[];
  votacao_texto: string;
  declaracoes_voto: unknown[];
  codigo_publico: string;
  pontuacao: number;
  similaridade?: number;
}

const COLUNAS = `d.id, d.orgao, to_char(d.data, 'YYYY-MM-DD') AS data,
  r.numero AS reuniao_numero, r.tipo AS reuniao_tipo, d.ponto_numero, d.titulo,
  d.proposta, d.deliberacao, d.resultado, d.votacao, d.votacao_texto,
  d.declaracoes_voto, a.codigo_publico`;

const JUNCOES = `JOIN reunioes r ON r.id = d.reuniao_id
  JOIN atas a ON a.id = d.ata_id AND a.estado = 'publicada'`;

/** Filtros comuns: $1 município, $2 de, $3 até, $4 órgão, $5 resultados. */
const FILTROS = `d.municipio_id = $1
  AND ($2::date IS NULL OR d.data >= $2::date)
  AND ($3::date IS NULL OR d.data <= $3::date)
  AND ($4::text IS NULL OR d.orgao = $4)
  AND ($5::text[] IS NULL OR d.resultado = ANY($5::text[]))`;

function resultadosDe(v: FiltroVotacao | undefined): string[] | null {
  if (!v) return null;
  if (v === 'aprovada') return ['aprovada_unanimidade', 'aprovada_maioria'];
  return [v];
}

/**
 * O índice das deliberações das atas publicadas: por texto (dicionário
 * português sem acentos, OU de lexemas, como o conhecimento) e, com
 * EMBEDDINGS_PROVIDER, também por semelhança (fundidos por RRF).
 */
@Injectable()
export class DeliberacoesService {
  private readonly logger = new Logger(DeliberacoesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  private urlPdf(codigo: string): string {
    return `${this.config.get<string>('app.apiUrl') ?? ''}/v1/public/atas/${codigo}/pdf`;
  }

  /** Na publicação (na mesma transação): uma linha por ponto deliberado. */
  async indexar(
    tx: Tx,
    d: {
      municipioId: string;
      reuniaoId: string;
      ataId: string;
      orgao: Orgao;
      data: string;
      conteudo: ConteudoAta;
    },
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const x of deliberacoesDaAta(d.conteudo)) {
      const p = x.ponto;
      const [l] = await tx.query<{ id: string }>(
        `INSERT INTO deliberacoes (municipio_id, reuniao_id, ata_id, orgao, data, ponto_numero,
           titulo, proposta, deliberacao, resultado, votacao, votacao_texto, declaracoes_voto,
           texto_pesquisa)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (ata_id, ponto_numero) DO UPDATE SET
           titulo = EXCLUDED.titulo, proposta = EXCLUDED.proposta,
           deliberacao = EXCLUDED.deliberacao, resultado = EXCLUDED.resultado,
           votacao = EXCLUDED.votacao, votacao_texto = EXCLUDED.votacao_texto,
           declaracoes_voto = EXCLUDED.declaracoes_voto,
           texto_pesquisa = EXCLUDED.texto_pesquisa, embedding = NULL
         RETURNING id`,
        [
          d.municipioId,
          d.reuniaoId,
          d.ataId,
          d.orgao,
          d.data,
          p.numero,
          p.titulo,
          p.proposta,
          p.deliberacao || x.votacao_texto,
          p.resultado,
          JSON.stringify(p.votacao),
          x.votacao_texto,
          JSON.stringify(p.declaracoes_voto),
          x.texto_pesquisa,
        ],
      );
      ids.push(l.id);
    }
    return ids;
  }

  /** Vetores das deliberações novas. Nunca lança: sem eles fica o texto. */
  async vetorizar(ids: string[]): Promise<number> {
    if (!this.embeddings.disponivel || !ids.length) return 0;
    try {
      const linhas = await this.db.query<{ id: string; texto: string }>(
        `SELECT id, texto_pesquisa AS texto FROM deliberacoes WHERE id = ANY($1::uuid[])`,
        [ids],
      );
      const vetores = await this.embeddings.varios(
        linhas.map((l) => l.texto),
        'document',
      );
      await this.db.query(
        `UPDATE deliberacoes x SET embedding = v.e::vector
         FROM unnest($1::uuid[], $2::text[]) AS v(id, e) WHERE x.id = v.id`,
        [linhas.map((l) => l.id), vetores.map(paraVetor)],
      );
      return linhas.length;
    } catch (e) {
      this.logger.warn(
        `Embeddings das deliberações ficaram por fazer: ${(e as Error).message}`,
      );
      return 0;
    }
  }

  async procurar(municipioId: string, f: Pesquisa) {
    const base = [
      municipioId,
      f.de ?? null,
      f.ate ?? null,
      f.orgao ?? null,
      resultadosDe(f.votacao),
    ];
    const pedida = f.q?.trim() ?? '';
    // Só palavras genéricas ("a câmara já decidiu?"): nada a procurar.
    const q = limparConsulta(pedida);
    let linhas: LinhaDeliberacao[];
    let modo: 'lista' | 'texto' | 'texto_e_vetores' = 'lista';
    if (pedida && !q) {
      return { modo: 'texto' as const, itens: [] };
    }
    if (!q) {
      linhas = await this.db.query<LinhaDeliberacao>(
        `SELECT ${COLUNAS}, 0::float8 AS pontuacao
         FROM deliberacoes d ${JUNCOES}
         WHERE ${FILTROS}
         ORDER BY d.data DESC, d.ponto_numero
         LIMIT $6`,
        [...base, f.limite],
      );
    } else {
      const candidatos = Math.max(20, f.limite * 2);
      const vetorPromessa = this.embeddings.pergunta(pedida);
      const porTexto = await this.db.query<LinhaDeliberacao>(
        `WITH c AS (${CONSULTA_OU(6)})
         SELECT ${COLUNAS}, ts_rank_cd(d.tsv, c.q, 32)::float8 AS pontuacao
         FROM c, deliberacoes d ${JUNCOES}
         WHERE ${FILTROS} AND d.tsv @@ c.q
         ORDER BY pontuacao DESC, d.data DESC
         LIMIT $7`,
        [...base, q, candidatos],
      );
      const vetor = await vetorPromessa;
      let porVetor: LinhaDeliberacao[] = [];
      if (vetor) {
        modo = 'texto_e_vetores';
        porVetor = await this.db
          .query<LinhaDeliberacao>(
            `SELECT ${COLUNAS}, 0::float8 AS pontuacao,
                    (1 - (d.embedding <=> $6::vector))::float8 AS similaridade
             FROM deliberacoes d ${JUNCOES}
             WHERE ${FILTROS} AND d.embedding IS NOT NULL
             ORDER BY d.embedding <=> $6::vector
             LIMIT $7`,
            [...base, paraVetor(vetor), candidatos],
          )
          .catch((e: Error) => {
            this.logger.warn(`Pesquisa por vetores falhou: ${e.message}`);
            return [];
          });
      } else {
        modo = 'texto';
      }
      linhas = rrf(
        [
          porTexto.filter((l) => l.pontuacao >= TEXTO_MINIMO),
          porVetor.filter((l) => (l.similaridade ?? 0) >= SIMILARIDADE_MINIMA),
        ],
        (l) => l.id,
      )
        .slice(0, f.limite)
        .map((x) => x.item);
    }
    return { modo, itens: linhas.map((l) => this.vista(l)) };
  }

  async daAta(ataId: string) {
    const linhas = await this.db.query<LinhaDeliberacao>(
      `SELECT ${COLUNAS}, 0::float8 AS pontuacao
       FROM deliberacoes d ${JUNCOES}
       WHERE d.ata_id = $1 ORDER BY d.ponto_numero`,
      [ataId],
    );
    return linhas.map((l) => this.vista(l));
  }

  private vista(l: LinhaDeliberacao) {
    return {
      id: l.id,
      orgao: l.orgao,
      orgao_nome: NOME_ORGAO[l.orgao],
      data: l.data,
      reuniao: { numero: l.reuniao_numero, tipo: l.reuniao_tipo },
      ponto: l.ponto_numero,
      titulo: l.titulo,
      proposta: l.proposta,
      deliberacao: l.deliberacao,
      resultado: l.resultado,
      resultado_texto: NOME_RESULTADO[l.resultado],
      votacao: l.votacao,
      votacao_texto: l.votacao_texto,
      declaracoes_voto: l.declaracoes_voto,
      ata_codigo: l.codigo_publico,
      ata_pdf: this.urlPdf(l.codigo_publico),
    };
  }

  /** Ferramenta `procurar_deliberacoes`: "a câmara já decidiu sobre X?". */
  async ferramenta(
    ctx: ContextoFerramenta,
    e: z.infer<typeof entradaProcurarDeliberacoes>,
  ) {
    const { itens } = await this.procurar(ctx.municipio.id, {
      q: e.assunto,
      orgao: e.orgao,
      limite: 5,
    });
    if (!itens.length) {
      return {
        encontradas: 0,
        sem_resultados: true,
        dizer:
          'Não encontrei nenhuma deliberação publicada sobre esse assunto nas atas da câmara e da assembleia municipal. ' +
          'Pode não ter sido discutido, ou a ata ainda não estar publicada.',
      };
    }
    const curto = (s: string, max = 280) =>
      s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
    const [primeira] = itens;
    const quem =
      primeira.orgao === 'camara'
        ? 'a Câmara Municipal'
        : 'a Assembleia Municipal';
    return {
      encontradas: itens.length,
      deliberacoes: itens.map((d) => ({
        data: d.data,
        orgao: d.orgao_nome,
        ponto: d.ponto,
        assunto: d.titulo,
        deliberacao: curto(d.deliberacao),
        resultado: d.resultado_texto,
        votacao: d.votacao_texto,
        ata_pdf: d.ata_pdf,
      })),
      dizer:
        `Encontrei ${itens.length === 1 ? 'uma deliberação' : `${itens.length} deliberações`} nas atas publicadas. ` +
        `${itens.length > 1 ? 'A mais relevante: ' : ''}a ${dataPorExtenso(primeira.data)}, ${quem} tratou "${primeira.titulo}" e ` +
        `ficou ${primeira.resultado_texto}. ${curto(primeira.deliberacao, 200)} ` +
        'A ata completa está no link do PDF.',
    };
  }
}
