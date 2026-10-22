/*
 * Pedidos de avaliação feitos pela API (`avaliacao.pedidos`, migração 0049
 * da API): "Correr teste agora" no painel, fontes que mudaram na ingestão e
 * versões novas do agente. `avaliador pedidos trabalhar` pega o mais antigo
 * (SKIP LOCKED: vários workers não pegam o mesmo), faz as perguntas ao
 * nosso chat, avalia e liga a execução ao pedido.
 */
import { bd, type Q } from '../bd.js';
import type { Motivo } from './executar.js';

export interface Pedido {
  id: string;
  municipio_id: string;
  motivo: 'manual' | 'ingestao' | 'mudanca_agente';
  conjunto: string;
  amostra: boolean;
}

export interface Passos {
  /** Faz as perguntas; devolve a execução. */
  executar(o: {
    sistema: string;
    conjunto: string;
    amostra: boolean;
    motivo: Motivo;
  }): Promise<{ execucao_id: string; estado: string; erro: string | null }>;
  /** Avalia a execução com o juiz. */
  avaliar(execucaoId: string): Promise<void>;
}

/** O motivo da execução (o da API tem mais casos que o do avaliador). */
export function motivoExecucao(m: Pedido['motivo']): Motivo {
  return m === 'mudanca_agente' ? 'publicacao' : 'manual';
}

/** Marca o pedido mais antigo como a correr e devolve-o (ou null). */
export async function pegarPedido(q: Q = bd): Promise<Pedido | null> {
  const [p] = await q.query<Pedido>(
    `UPDATE avaliacao.pedidos SET estado = 'a_correr', iniciado_em = now()
     WHERE id = (
       SELECT id FROM avaliacao.pedidos WHERE estado = 'pendente'
       ORDER BY criado_em LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     RETURNING id, municipio_id, motivo, conjunto, amostra`,
  );
  return p ?? null;
}

/** Trata um pedido do princípio ao fim. Nunca lança: o erro fica no pedido. */
export async function tratarPedido(
  p: Pedido,
  passos: Passos,
  q: Q = bd,
): Promise<'terminado' | 'falhou'> {
  const fim = (estado: 'terminado' | 'falhou', execucao: string | null, erro: string | null) =>
    q.query(
      `UPDATE avaliacao.pedidos SET estado = $2, execucao_id = $3, erro = $4, terminado_em = now()
       WHERE id = $1`,
      [p.id, estado, execucao, erro?.slice(0, 500) ?? null],
    );
  try {
    const [s] = await q.query<{ nome: string }>(
      `SELECT nome FROM avaliacao.sistemas
       WHERE municipio_id = $1 AND nosso AND adaptador = 'tou-chat'
       ORDER BY criado_em LIMIT 1`,
      [p.municipio_id],
    );
    if (!s) {
      await fim(
        'falhou',
        null,
        'Sem sistema "tou-chat" nosso para este município: avaliador sistemas preparar-base.',
      );
      return 'falhou';
    }
    const r = await passos.executar({
      sistema: s.nome,
      conjunto: p.conjunto,
      amostra: p.amostra,
      motivo: motivoExecucao(p.motivo),
    });
    if (r.estado !== 'terminada') {
      await fim('falhou', r.execucao_id, r.erro ?? 'Execução interrompida.');
      return 'falhou';
    }
    await passos.avaliar(r.execucao_id);
    await fim('terminado', r.execucao_id, null);
    return 'terminado';
  } catch (e) {
    await fim('falhou', null, e instanceof Error ? e.message : String(e));
    return 'falhou';
  }
}
