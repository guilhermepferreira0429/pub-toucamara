/*
 * Conjuntos de perguntas na BD (`avaliacao.conjuntos` / `avaliacao.perguntas`).
 * Um conjunto nunca se altera depois de importado: importar outra vez cria a
 * versão seguinte, para as execuções antigas continuarem a apontar para as
 * perguntas que foram feitas.
 */
import { bd, type Q } from '../bd.js';
import type { Pergunta } from '../tipos.js';
import type { PerguntaFicheiro } from './formato.js';

export const NOME_BASE = 'Perguntas base';

export interface Municipio {
  id: string;
  slug: string;
  nome: string;
}

export async function municipioPorSlug(
  slug: string,
  q: Q = bd,
): Promise<Municipio> {
  const [m] = await q.query<Municipio>(
    'SELECT id, slug, nome FROM municipios WHERE slug = $1',
    [slug],
  );
  if (!m) throw new Error(`Município "${slug}" não existe.`);
  return m;
}

export interface Conjunto {
  id: string;
  nome: string;
  versao: number;
  municipio_id: string | null;
}

/** Cria o conjunto (versão = última + 1 desse nome e município) e as perguntas, tudo ou nada. */
export async function importarConjunto(
  nome: string,
  municipioId: string | null,
  perguntas: PerguntaFicheiro[],
): Promise<Conjunto & { perguntas: number }> {
  return bd.transacao(async (tx) => {
    // O bloqueio evita que duas importações em paralelo calculem a mesma
    // versão (a UNIQUE apanhava-o, mas com um erro menos claro).
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `avaliacao.conjuntos:${nome}:${municipioId ?? ''}`,
    ]);
    const [c] = await tx.query<Conjunto>(
      `INSERT INTO avaliacao.conjuntos (nome, versao, municipio_id)
       SELECT $1, coalesce(max(versao), 0) + 1, $2::uuid
       FROM avaliacao.conjuntos
       WHERE nome = $1 AND municipio_id IS NOT DISTINCT FROM $2::uuid
       RETURNING id, nome, versao, municipio_id`,
      [nome, municipioId],
    );
    // Uma só instrução com unnest: 180 perguntas numa ida à BD.
    await tx.query(
      `INSERT INTO avaliacao.perguntas
         (conjunto_id, ordem, categoria, texto, idioma, comportamento, entidade_esperada, nota)
       SELECT $1::uuid, * FROM unnest($2::int[], $3::text[], $4::text[], $5::text[],
                                $6::text[], $7::text[], $8::text[])`,
      [
        c.id,
        perguntas.map((p) => p.ordem),
        perguntas.map((p) => p.categoria),
        perguntas.map((p) => p.texto),
        perguntas.map((p) => p.idioma),
        perguntas.map((p) => p.comportamento),
        perguntas.map((p) => p.entidade_esperada),
        perguntas.map((p) => p.nota),
      ],
    );
    return { ...c, perguntas: perguntas.length };
  });
}

/**
 * O conjunto a usar para um município: pelo nome (exato, senão parcial, para
 * `--conjunto base` funcionar como na spec), preferindo o do município ao
 * genérico e a versão mais recente.
 */
export async function escolherConjunto(
  nome: string | undefined,
  municipioId: string,
  q: Q = bd,
): Promise<Conjunto> {
  const procurado = nome ?? NOME_BASE;
  const [c] = await q.query<Conjunto>(
    `SELECT id, nome, versao, municipio_id
     FROM avaliacao.conjuntos
     WHERE (municipio_id = $2 OR municipio_id IS NULL)
       AND (lower(nome) = lower($1) OR nome ILIKE '%' || $1 || '%')
     ORDER BY (lower(nome) = lower($1)) DESC, (municipio_id IS NOT NULL) DESC,
              versao DESC
     LIMIT 1`,
    [procurado, municipioId],
  );
  if (!c) {
    throw new Error(
      `Não há conjunto "${procurado}" para este município. Importa-o com \`perguntas importar\`.`,
    );
  }
  return c;
}

export function perguntasDoConjunto(
  conjuntoId: string,
  q: Q = bd,
): Promise<Pergunta[]> {
  return q.query<Pergunta>(
    `SELECT id, conjunto_id, ordem, categoria, texto, idioma, comportamento,
            entidade_esperada, nota
     FROM avaliacao.perguntas WHERE conjunto_id = $1 ORDER BY ordem`,
    [conjuntoId],
  );
}

export interface LinhaListagem {
  id: string;
  nome: string;
  versao: number;
  municipio: string | null;
  criado_em: Date;
  categoria: string;
  n: number;
}

/** Conjuntos com a contagem por categoria (uma linha por conjunto × categoria). */
export function listarConjuntos(q: Q = bd): Promise<LinhaListagem[]> {
  return q.query<LinhaListagem>(
    `SELECT c.id, c.nome, c.versao, m.slug AS municipio, c.criado_em,
            p.categoria, count(*)::int AS n, min(p.ordem) AS primeira
     FROM avaliacao.conjuntos c
     LEFT JOIN municipios m ON m.id = c.municipio_id
     JOIN avaliacao.perguntas p ON p.conjunto_id = c.id
     GROUP BY c.id, m.slug, p.categoria
     ORDER BY c.nome, m.slug NULLS FIRST, c.versao DESC, primeira`,
  );
}
