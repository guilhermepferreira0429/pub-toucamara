/*
 * Gabarito na BD (`avaliacao.gabarito`): o que o juiz lê, o que se propõe e o
 * que a revisão aprova. Por pergunta e município há várias versões; no
 * máximo uma aprovada (índice `gabarito_aprovado_uq`). Aprovar outra desativa
 * a anterior, que passa a `rejeitado` (o esquema não tem "substituído") e
 * continua lá para as avaliações antigas que apontam para ela.
 */
import { bd, type Q } from '../bd.js';
import type { Gabarito, Pergunta } from '../tipos.js';
import {
  mesmoConteudo,
  normalizar,
  type ConteudoGabarito,
  type ItemLido,
  type ItemRevisao,
} from './revisao.js';

const COLUNAS = `id, pergunta_id, municipio_id, resposta, factos_obrigatorios,
  factos_proibidos, fontes, versao`;

/** O gabarito aprovado de uma pergunta num município (o juiz usa este). */
export async function gabaritoAprovado(
  perguntaId: string,
  municipioId: string,
): Promise<Gabarito | null> {
  const [g] = await bd.query<Gabarito>(
    `SELECT ${COLUNAS} FROM avaliacao.gabarito
     WHERE pergunta_id = $1 AND municipio_id = $2 AND estado = 'aprovado'`,
    [perguntaId, municipioId],
  );
  return g ?? null;
}

/**
 * Perguntas do conjunto que precisam de proposta. Por omissão: sem gabarito
 * aprovado nem proposto (uma rejeitada volta a ser proposta). Com `soEmFalta`:
 * só as que nunca tiveram gabarito nenhum. Como cada proposta se grava logo,
 * voltar a correr retoma onde ia.
 */
export function perguntasParaPropor(
  conjuntoId: string,
  municipioId: string,
  soEmFalta: boolean,
  q: Q = bd,
): Promise<Pergunta[]> {
  return q.query<Pergunta>(
    `SELECT p.id, p.conjunto_id, p.ordem, p.categoria, p.texto, p.idioma,
            p.comportamento, p.entidade_esperada, p.nota
     FROM avaliacao.perguntas p
     WHERE p.conjunto_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM avaliacao.gabarito g
         WHERE g.pergunta_id = p.id AND g.municipio_id = $2
           AND ($3 OR g.estado IN ('aprovado', 'proposto')))
     ORDER BY p.ordem`,
    [conjuntoId, municipioId, soEmFalta],
  );
}

/** Grava uma proposta como versão seguinte; devolve a versão. */
export async function gravarProposta(
  perguntaId: string,
  municipioId: string,
  c: ConteudoGabarito,
  propostoPor = 'ia',
): Promise<number> {
  return bd.transacao(async (tx) => {
    await bloquear(tx, perguntaId, municipioId);
    const [r] = await tx.query<{ versao: number }>(
      `INSERT INTO avaliacao.gabarito
         (pergunta_id, municipio_id, versao, resposta, factos_obrigatorios,
          factos_proibidos, fontes, estado, proposto_por)
       SELECT $1, $2, coalesce(max(versao), 0) + 1, $3, $4, $5, $6, 'proposto', $7
       FROM avaliacao.gabarito WHERE pergunta_id = $1 AND municipio_id = $2
       RETURNING versao`,
      [
        perguntaId,
        municipioId,
        c.resposta,
        c.factos_obrigatorios,
        c.factos_proibidos,
        JSON.stringify(c.fontes),
        propostoPor,
      ],
    );
    return r.versao;
  });
}

/** Serializa escritas da mesma pergunta × município (versões e o aprovado único). */
async function bloquear(tx: Q, perguntaId: string, municipioId: string) {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `avaliacao.gabarito:${perguntaId}:${municipioId}`,
  ]);
}

export interface EstadoCategoria {
  categoria: string;
  total: number;
  aprovadas: number;
  propostas: number;
  em_falta: number;
}

/** Por categoria: com aprovado; só com proposto; sem nenhum dos dois. */
export function estadoPorCategoria(
  conjuntoId: string,
  municipioId: string,
  q: Q = bd,
): Promise<EstadoCategoria[]> {
  return q.query<EstadoCategoria>(
    `WITH e AS (
       SELECT p.categoria, p.ordem,
              bool_or(g.estado = 'aprovado') AS aprovado,
              bool_or(g.estado = 'proposto') AS proposto
       FROM avaliacao.perguntas p
       LEFT JOIN avaliacao.gabarito g ON g.pergunta_id = p.id AND g.municipio_id = $2
       WHERE p.conjunto_id = $1
       GROUP BY p.id, p.categoria, p.ordem
     )
     SELECT categoria, count(*)::int AS total,
            count(*) FILTER (WHERE aprovado)::int AS aprovadas,
            count(*) FILTER (WHERE proposto AND aprovado IS NOT TRUE)::int AS propostas,
            count(*) FILTER (WHERE aprovado IS NOT TRUE AND proposto IS NOT TRUE)::int AS em_falta
     FROM e GROUP BY categoria ORDER BY min(ordem)`,
    [conjuntoId, municipioId],
  );
}

/**
 * Gabaritos de um município num estado, para o ficheiro de revisão: a versão
 * mais recente nesse estado de cada pergunta, pela ordem das perguntas.
 */
export function itensParaRevisao(
  municipioId: string,
  estado: string,
  conjuntoId: string | null,
  q: Q = bd,
): Promise<ItemRevisao[]> {
  return q.query<ItemRevisao>(
    `SELECT DISTINCT ON (c.nome, c.versao, p.ordem)
            g.id AS gabarito_id, p.ordem, p.categoria, p.texto AS pergunta,
            p.comportamento, p.entidade_esperada, p.nota, g.estado, g.versao,
            g.resposta, g.factos_obrigatorios, g.factos_proibidos, g.fontes
     FROM avaliacao.gabarito g
     JOIN avaliacao.perguntas p ON p.id = g.pergunta_id
     JOIN avaliacao.conjuntos c ON c.id = p.conjunto_id
     WHERE g.municipio_id = $1 AND g.estado = $2
       AND ($3::uuid IS NULL OR p.conjunto_id = $3)
       -- Uma proposta mais antiga do que o aprovado já foi ultrapassada.
       AND NOT (g.estado = 'proposto' AND EXISTS (
         SELECT 1 FROM avaliacao.gabarito a
         WHERE a.pergunta_id = g.pergunta_id AND a.municipio_id = g.municipio_id
           AND a.estado = 'aprovado' AND a.versao > g.versao))
     ORDER BY c.nome, c.versao, p.ordem, g.versao DESC`,
    [municipioId, estado, conjuntoId],
  );
}

export interface ResultadoRevisao {
  aprovados: number;
  /** Aprovados que já estavam aprovados e com o mesmo conteúdo. */
  sem_mudanca: number;
  rejeitados: number;
  /** Secções sem caixa marcada. */
  ignorados: number;
  erros: string[];
}

interface LinhaGabarito extends ConteudoGabarito {
  id: string;
  pergunta_id: string;
  municipio_id: string;
  estado: string;
  factos_secundarios: string[];
}

/**
 * Aplica as decisões de um ficheiro de revisão numa só transação: ou entra o
 * ficheiro todo, ou nada (um erro de BD a meio não deixa meia revisão).
 */
export function aplicarRevisao(
  itens: ItemLido[],
  por: string,
): Promise<ResultadoRevisao> {
  return bd.transacao(async (tx) => {
    const r: ResultadoRevisao = {
      aprovados: 0,
      sem_mudanca: 0,
      rejeitados: 0,
      ignorados: 0,
      erros: [],
    };
    for (const it of itens) {
      if (!it.decisao) {
        r.ignorados++;
        continue;
      }
      const [g] = await tx.query<LinhaGabarito>(
        `SELECT id, pergunta_id, municipio_id, estado, resposta, factos_obrigatorios,
                factos_proibidos, fontes, factos_secundarios
         FROM avaliacao.gabarito WHERE id = $1`,
        [it.gabarito_id],
      );
      if (!g) {
        r.erros.push(`${it.gabarito_id}: não existe (ficheiro de outra BD?)`);
        continue;
      }
      await bloquear(tx, g.pergunta_id, g.municipio_id);
      const novo = normalizar(it);
      const editado = !mesmoConteudo(novo, g);

      if (it.decisao === 'rejeitar') {
        await tx.query(
          `UPDATE avaliacao.gabarito SET estado = 'rejeitado' WHERE id = $1`,
          [g.id],
        );
        r.rejeitados++;
        continue;
      }

      if (g.estado === 'aprovado' && !editado) {
        r.sem_mudanca++;
        continue;
      }
      // Desativar o aprovado anterior antes de aprovar (só pode haver um).
      await tx.query(
        `UPDATE avaliacao.gabarito SET estado = 'rejeitado'
         WHERE pergunta_id = $1 AND municipio_id = $2 AND estado = 'aprovado' AND id <> $3`,
        [g.pergunta_id, g.municipio_id, g.id],
      );
      if (g.estado === 'aprovado') {
        // Editar um aprovado cria uma versão nova: as avaliações já feitas
        // apontam para o id antigo e têm de continuar a dizer o que o juiz viu.
        // A classificação E/S passa para a versão nova nos factos que ficam
        // iguais; um facto novo ou reescrito conta como E até ser classificado.
        await tx.query(
          `UPDATE avaliacao.gabarito SET estado = 'rejeitado' WHERE id = $1`,
          [g.id],
        );
        await tx.query(
          `INSERT INTO avaliacao.gabarito
             (pergunta_id, municipio_id, versao, resposta, factos_obrigatorios,
              factos_proibidos, fontes, estado, proposto_por, aprovado_por, aprovado_em,
              factos_secundarios)
           SELECT $1, $2, coalesce(max(versao), 0) + 1, $3, $4, $5, $6, 'aprovado', $7, $7, now(), $8
           FROM avaliacao.gabarito WHERE pergunta_id = $1 AND municipio_id = $2`,
          [
            g.pergunta_id,
            g.municipio_id,
            novo.resposta,
            novo.factos_obrigatorios,
            novo.factos_proibidos,
            JSON.stringify(novo.fontes),
            por,
            (g.factos_secundarios ?? []).filter((f) =>
              novo.factos_obrigatorios.includes(f),
            ),
          ],
        );
      } else {
        await tx.query(
          `UPDATE avaliacao.gabarito
           SET resposta = $2, factos_obrigatorios = $3, factos_proibidos = $4, fontes = $5,
               estado = 'aprovado', aprovado_por = $6, aprovado_em = now()
           WHERE id = $1`,
          [
            g.id,
            novo.resposta,
            novo.factos_obrigatorios,
            novo.factos_proibidos,
            JSON.stringify(novo.fontes),
            por,
          ],
        );
      }
      r.aprovados++;
    }
    return r;
  });
}
