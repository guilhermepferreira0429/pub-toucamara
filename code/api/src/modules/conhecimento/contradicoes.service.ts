import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { DatabaseService } from '../../database/database.service.js';
import { ClaudeService } from '../../ia/claude.service.js';
import { EM_VIGOR, VERSAO_ATUAL } from './sql.js';

export interface DadosContradicoes {
  municipio_id: string;
}

/** Pares mandados à IA por execução (custo e tempo limitados). */
export const MAX_PARES = 15;
/** Trechos mais recentes que procuram par noutra entidade. */
const TRECHOS_RECENTES = 200;
/** Par por vetores: cosseno mínimo para ser "o mesmo assunto". */
const SIMILARIDADE_PAR = 0.8;
/** Par por texto (sem vetores): ts_rank_cd normalizado mínimo. */
const RANK_PAR = 0.3;

interface Par {
  a_id: string;
  b_id: string;
  /** Pista para a IA: o valor oficial do contacto (pares de contactos). */
  contacto: string | null;
}

interface Lado {
  id: string;
  referencia: string | null;
  texto: string;
  fonte: string;
  entidade: string;
  entidade_tipo: string;
  entidade_descricao: string | null;
}

const veredicto = z.object({
  contradiz: z
    .boolean()
    .describe(
      'true só se os dois trechos dão valores diferentes para a mesma coisa.',
    ),
  assunto: z
    .string()
    .describe(
      'Curto, ex.: "Falta de água · contacto" ou "Licença de ruído · prazo".',
    ),
  valor_a: z
    .string()
    .describe('O valor que o trecho A dá (ex.: "800 910 410").'),
  valor_b: z.string().describe('O valor que o trecho B dá.'),
  usar: z
    .enum(['a', 'b'])
    .describe(
      'O da entidade responsável pelo assunto (ex.: a empresa da água para avarias de água).',
    ),
});

const SISTEMA = `Comparas dois trechos de fontes oficiais de um concelho português (câmara, empresas municipais, juntas de freguesia, entidades nacionais).
Diz se se contradizem: o mesmo assunto concreto (um contacto, um prazo, um valor, um horário, um documento exigido) com valores diferentes.
Não é contradição: assuntos diferentes, um trecho mais completo do que o outro, contactos diferentes para serviços diferentes, ou textos que se complementam.
Se houver contradição, "usar" é o trecho da entidade responsável pelo assunto (a que presta o serviço); em dúvida, a fonte mais específica.
Se não houver, devolve contradiz=false e preenche os outros campos com o que encontraste (podem ficar vazios).`;

/**
 * Detetor simples de contradições (secção 6.2, depois da ingestão; só com
 * IA). Candidatos entre entidades diferentes do mesmo município, só nas
 * versões atuais:
 *
 * 1. Contactos: cada `entidade_contactos` com fonte → o trecho da sua fonte
 *    que tem o número/email, contra o trecho de outra entidade que mais fala
 *    do mesmo (rótulo + nome da entidade) e tem um número ou email.
 * 2. Trechos: os trechos lidos mais recentemente contra o mais parecido de
 *    outra entidade (vetores se houver; senão texto completo).
 *
 * No máximo `MAX_PARES` pares por execução; cada par vai uma só vez à IA
 * (`contradicoes_verificadas`), haja ou não contradição.
 */
@Injectable()
export class ContradicoesService {
  private readonly logger = new Logger(ContradicoesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly claude: ClaudeService,
  ) {}

  async correr({ municipio_id }: DadosContradicoes): Promise<number> {
    if (!this.claude.disponivel) return 0;
    const pares = await this.candidatos(municipio_id);
    let criadas = 0;
    for (const p of pares) {
      try {
        if (await this.verificar(municipio_id, p)) criadas++;
      } catch (e) {
        // Não fica como verificado: volta na próxima execução.
        this.logger.warn(`Par ${p.a_id}/${p.b_id}: ${(e as Error).message}`);
      }
    }
    this.logger.log(
      `Contradições ${municipio_id}: ${pares.length} pares vistos, ${criadas} novas.`,
    );
    return criadas;
  }

  private async candidatos(municipioId: string): Promise<Par[]> {
    const atuais = `
      SELECT t.id, t.tsv, t.texto, t.embedding, fo.entidade_id, fv.lida_em, fv.id AS versao_id
      FROM trechos t
      JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
      JOIN fontes fo ON fo.id = fv.fonte_id
      JOIN entidades e ON e.id = fo.entidade_id
      WHERE fo.municipio_id = $1 AND e.ativo AND ${EM_VIGOR('t')} AND ${VERSAO_ATUAL}`;
    const novoPar = (a: string, b: string) => `
      NOT EXISTS (SELECT 1 FROM contradicoes_verificadas cv
                  WHERE cv.trecho_a_id = least(${a}, ${b}) AND cv.trecho_b_id = greatest(${a}, ${b}))
      AND NOT EXISTS (SELECT 1 FROM contradicoes ct
                  WHERE least(ct.trecho_a_id, ct.trecho_b_id) = least(${a}, ${b})
                    AND greatest(ct.trecho_a_id, ct.trecho_b_id) = greatest(${a}, ${b}))`;

    const contactos = await this.db.query<Par>(
      `WITH atuais AS MATERIALIZED (${atuais}),
       c AS (
         SELECT ec.valor, ec.tipo, en.nome, a.id AS a_id, a.entidade_id,
                (SELECT string_agg(DISTINCT quote_literal(lexeme), ' | ')::tsquery
                 FROM unnest(to_tsvector('pt_unaccent',
                   coalesce(ec.rotulo, '') || ' ' || ec.tipo || ' ' || en.nome))) AS q
         FROM entidade_contactos ec
         JOIN entidades en ON en.id = ec.entidade_id
         JOIN LATERAL (
           SELECT x.id, x.entidade_id FROM atuais x
           WHERE x.versao_id = ec.fonte_versao_id
             AND strpos(regexp_replace(x.texto, '\\s', '', 'g'),
                        regexp_replace(ec.valor, '\\s', '', 'g')) > 0
           LIMIT 1) a ON true
         WHERE en.municipio_id = $1 AND ec.tipo IN ('telefone', 'avarias', 'email')
       )
       SELECT c.a_id, b.id AS b_id, c.valor AS contacto
       FROM c
       JOIN LATERAL (
         SELECT x.id FROM atuais x
         WHERE x.entidade_id <> c.entidade_id AND x.tsv @@ c.q
           AND (CASE WHEN c.tipo = 'email' THEN x.texto LIKE '%@%'
                     ELSE x.texto ~ '\\d{3}\\s?\\d{3}\\s?\\d{3}' END)
           AND strpos(regexp_replace(x.texto, '\\s', '', 'g'),
                      regexp_replace(c.valor, '\\s', '', 'g')) = 0
           AND ${novoPar('c.a_id', 'x.id')}
         ORDER BY ts_rank_cd(x.tsv, c.q, 32) DESC LIMIT 1) b ON true
       LIMIT $2`,
      [municipioId, MAX_PARES],
    );

    const restantes = MAX_PARES - contactos.length;
    if (restantes <= 0) return contactos;

    const trechos = await this.db.query<Par>(
      `WITH atuais AS MATERIALIZED (${atuais}),
       recentes AS (
         SELECT *, (SELECT string_agg(quote_literal(lexeme), ' | ')::tsquery FROM unnest(tsv)) AS q
         FROM atuais ORDER BY lida_em DESC LIMIT $2
       )
       SELECT a.id AS a_id, b.id AS b_id, NULL AS contacto
       FROM recentes a
       JOIN LATERAL (
         SELECT x.id,
                CASE WHEN a.embedding IS NOT NULL AND x.embedding IS NOT NULL
                     THEN 1 - (x.embedding <=> a.embedding)
                     ELSE ts_rank_cd(x.tsv, a.q, 32) END AS parecenca,
                (a.embedding IS NOT NULL AND x.embedding IS NOT NULL) AS por_vetor
         FROM atuais x
         WHERE x.entidade_id <> a.entidade_id AND x.tsv @@ a.q
           AND ${novoPar('a.id', 'x.id')}
         ORDER BY parecenca DESC LIMIT 1) b ON true
       WHERE b.parecenca >= CASE WHEN b.por_vetor THEN $3::float8 ELSE $4::float8 END
       ORDER BY b.parecenca DESC
       LIMIT $5`,
      [municipioId, TRECHOS_RECENTES, SIMILARIDADE_PAR, RANK_PAR, restantes],
    );

    // Sem pares repetidos (a/b e b/a).
    const vistos = new Set<string>();
    return [...contactos, ...trechos].filter((p) => {
      const k = [p.a_id, p.b_id].sort().join(':');
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  }

  private async verificar(municipioId: string, p: Par): Promise<boolean> {
    const lados = await this.db.query<Lado>(
      `SELECT t.id, t.referencia, t.texto, fo.titulo AS fonte, e.nome AS entidade,
              e.tipo AS entidade_tipo, e.descricao AS entidade_descricao
       FROM trechos t
       JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
       JOIN fontes fo ON fo.id = fv.fonte_id
       JOIN entidades e ON e.id = fo.entidade_id
       WHERE t.id = ANY($1::uuid[])`,
      [[p.a_id, p.b_id]],
    );
    const a = lados.find((l) => l.id === p.a_id);
    const b = lados.find((l) => l.id === p.b_id);
    if (!a || !b) return false;

    const lado = (nome: string, l: Lado) =>
      `Trecho ${nome} · ${l.entidade} (${l.entidade_tipo}${l.entidade_descricao ? `: ${l.entidade_descricao}` : ''}) · ${l.fonte}${l.referencia ? ` · ${l.referencia}` : ''}\n${l.texto}`;
    const v = await this.claude.extrair(veredicto, {
      sistema: SISTEMA,
      esforco: 'low',
      maxTokens: 1000,
      conteudo: [
        lado('A', a),
        lado('B', b),
        p.contacto
          ? `Contacto oficial registado para a entidade de A: ${p.contacto}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    });

    return this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO contradicoes_verificadas (trecho_a_id, trecho_b_id)
         VALUES (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))
         ON CONFLICT DO NOTHING`,
        [p.a_id, p.b_id],
      );
      if (!v.contradiz) return false;
      const r = await tx.query(
        `INSERT INTO contradicoes (municipio_id, assunto, trecho_a_id, valor_a, trecho_b_id, valor_b, usar)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          municipioId,
          v.assunto.slice(0, 200) || 'Informação contraditória',
          p.a_id,
          v.valor_a.slice(0, 500),
          p.b_id,
          v.valor_b.slice(0, 500),
          v.usar,
        ],
      );
      return r.length > 0;
    });
  }
}
