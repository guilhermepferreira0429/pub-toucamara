/* Leitura da BD para os relatórios (a avaliação que conta: avaliacao_final). */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bd, type Q } from '../bd.js';
import { config } from '../config.js';
import type { ExecucaoRel, RespostaRel } from './agregar.js';

export async function carregarExecucoes(
  ids: string[],
  q: Q = bd,
): Promise<ExecucaoRel[]> {
  const execs = await q.query<
    Omit<ExecucaoRel, 'respostas' | 'porResponder' | 'porAvaliar'> & {
      por_responder: number;
      por_avaliar: number;
    }
  >(
    `SELECT e.id, e.sistema_id, s.nome AS sistema, s.nosso, s.municipio_id,
            e.agente_versao, e.iniciada_em, e.terminada_em,
            (SELECT count(*) FROM avaliacao.respostas r
              WHERE r.execucao_id = e.id AND r.erro IS NOT NULL)::int AS por_responder,
            (SELECT count(*) FROM avaliacao.respostas r
              WHERE r.execucao_id = e.id AND r.erro IS NULL
                AND NOT EXISTS (SELECT 1 FROM avaliacao.avaliacoes a WHERE a.resposta_id = r.id))::int AS por_avaliar
       FROM avaliacao.execucoes e
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
      WHERE e.id = ANY($1::uuid[])`,
    [ids],
  );
  const faltam = ids.filter((id) => !execs.some((e) => e.id === id));
  if (faltam.length)
    throw new Error(`Execuções inexistentes: ${faltam.join(', ')}`);

  const respostas = await q.query<RespostaRel & { execucao_id: string }>(
    `SELECT r.execucao_id, r.id AS resposta_id, r.pergunta_id, p.ordem, p.categoria,
            p.texto AS pergunta, p.comportamento, p.entidade_esperada,
            r.texto, r.captura_key, r.respondida_em,
            f.veredicto, f.avaliador, f.rubrica_versao, f.justificacao,
            f.factos_errados, f.factos_em_falta, g.resposta AS gabarito_resposta
       FROM avaliacao.respostas r
       JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
       JOIN avaliacao.avaliacao_final f ON f.resposta_id = r.id
       LEFT JOIN avaliacao.gabarito g ON g.id = f.gabarito_id
      WHERE r.execucao_id = ANY($1::uuid[]) AND r.erro IS NULL
      ORDER BY p.ordem`,
    [ids],
  );
  // Pela ordem pedida: a primeira é a de referência nas comparações.
  return ids.map((id) => {
    const e = execs.find((x) => x.id === id)!;
    const { por_responder, por_avaliar, ...resto } = e;
    return {
      ...resto,
      porResponder: por_responder,
      porAvaliar: por_avaliar,
      respostas: respostas.filter((r) => r.execucao_id === id),
    };
  });
}

/** Última execução terminada de cada sistema (opcionalmente de um município). */
export async function ultimasExecucoes(
  filtro: { municipioSlug?: string } = {},
  q: Q = bd,
): Promise<{ id: string; sistema: string; nosso: boolean }[]> {
  return q.query(
    `SELECT DISTINCT ON (e.sistema_id) e.id, s.nome AS sistema, s.nosso
       FROM avaliacao.execucoes e
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
       LEFT JOIN municipios m ON m.id = s.municipio_id
      WHERE e.estado = 'terminada'
        AND ($1::text IS NULL OR m.slug = $1)
      ORDER BY e.sistema_id, e.terminada_em DESC NULLS LAST`,
    [filtro.municipioSlug ?? null],
  );
}

export async function municipioPorSlug(slug: string, q: Q = bd) {
  const [m] = await q.query<{ id: string; nome: string; slug: string }>(
    'SELECT id, nome, slug FROM municipios WHERE slug = $1',
    [slug],
  );
  if (!m) throw new Error(`Município "${slug}" não existe.`);
  return m;
}

/**
 * Capturas em data URL (base64), para o HTML ser um ficheiro só, que se
 * manda por email sem anexos partidos. Capturas em falta ficam de fora.
 */
export async function lerCapturas(
  chaves: (string | null)[],
): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const k of new Set(chaves.filter((c): c is string => !!c))) {
    try {
      const buf = await readFile(path.join(config.pastaSaida, k));
      m.set(k, `data:image/png;base64,${buf.toString('base64')}`);
    } catch {
      // Sem a captura, o relatório mostra o texto e diz que a imagem falta.
    }
  }
  return m;
}
