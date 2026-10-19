/*
 * `avaliar --execucao <id>`: passa as respostas de uma execução pelo juiz e
 * grava as avaliações. O modelo descreve; as regras (regras.ts) decidem.
 */
import { bd, type Q } from '../bd.js';
import type { Comportamento } from '../tipos.js';
import type { ClienteJuiz, ResultadoChamada } from './cliente.js';
import { somarUso, usoVazio, type Uso } from './custo.js';
import { verificarFactos } from './factos.js';
import {
  decidirVeredicto,
  descricaoVazia,
  juntarFactos,
  justificacaoComRegra,
  semResposta,
  type Decisao,
  type Descricao,
} from './regras.js';
import { RUBRICA_VERSAO, type EntradaJuiz } from './rubrica.js';

/** Uma resposta a avaliar, já com a pergunta e o gabarito aprovado (se há). */
export interface ItemAvaliar {
  resposta_id: string;
  texto: string | null;
  erro: string | null;
  pergunta: string;
  idioma: string;
  categoria: string;
  comportamento: Comportamento;
  entidade_esperada: string | null;
  gabarito_id: string | null;
  gabarito_resposta: string | null;
  factos_obrigatorios: string[] | null;
  factos_proibidos: string[] | null;
}

/*
 * O gabarito vem do município do sistema (ou do conjunto, se o sistema não
 * tem município). Só o aprovado conta. É a mesma regra de
 * gabarito/gabarito.ts (gabaritoAprovado), numa só query para não fazer uma
 * ida à BD por resposta.
 */
export async function respostasParaAvaliar(
  q: Q,
  execucaoId: string,
  reavaliar: boolean,
): Promise<ItemAvaliar[]> {
  return q.query<ItemAvaliar>(
    `SELECT r.id AS resposta_id, r.texto, r.erro,
            p.texto AS pergunta, p.idioma, p.categoria, p.comportamento, p.entidade_esperada,
            g.id AS gabarito_id, g.resposta AS gabarito_resposta,
            g.factos_obrigatorios, g.factos_proibidos
       FROM avaliacao.respostas r
       JOIN avaliacao.execucoes e ON e.id = r.execucao_id
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
       JOIN avaliacao.conjuntos c ON c.id = e.conjunto_id
       JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
       LEFT JOIN avaliacao.gabarito g
              ON g.pergunta_id = p.id AND g.estado = 'aprovado'
             AND g.municipio_id = coalesce(s.municipio_id, c.municipio_id)
      WHERE r.execucao_id = $1
        -- Erros do adaptador não se avaliam: repetem-se (repetir-erros).
        AND r.erro IS NULL
        AND ($3::boolean OR NOT EXISTS (
              SELECT 1 FROM avaliacao.avaliacoes a
               WHERE a.resposta_id = r.id AND a.avaliador = 'juiz'
                 AND a.rubrica_versao = $2))
      ORDER BY p.ordem`,
    [execucaoId, RUBRICA_VERSAO, reavaliar],
  );
}

export function entradaDe(i: ItemAvaliar): EntradaJuiz {
  return {
    pergunta: i.pergunta,
    idioma: i.idioma,
    categoria: i.categoria,
    comportamento_esperado: i.comportamento,
    entidade_esperada: i.entidade_esperada,
    gabarito: {
      resposta: i.gabarito_resposta ?? '',
      factos_obrigatorios: i.factos_obrigatorios ?? [],
      factos_proibidos: i.factos_proibidos ?? [],
    },
    resposta: i.texto ?? '',
  };
}

export interface Avaliacao {
  decisao: Decisao;
  descricao: Descricao;
  justificacao: string;
}

/** Junta o juiz (ou nada, se a resposta nem chegou a ir) com as regras. */
export function concluir(
  i: ItemAvaliar,
  saidaJuiz: ResultadoChamada | null,
): Avaliacao {
  const gab = {
    factos_obrigatorios: i.factos_obrigatorios ?? [],
    factos_proibidos: i.factos_proibidos ?? [],
  };
  const det = verificarFactos(i.texto ?? '', gab);
  const base = saidaJuiz?.ok
    ? saidaJuiz.saida
    : { ...descricaoVazia(), justificacao: 'Sem resposta: não foi ao juiz.' };
  const descricao = juntarFactos(base, det, gab);
  const decisao = decidirVeredicto(
    {
      comportamento_esperado: i.comportamento,
      categoria: i.categoria,
      factos_obrigatorios: gab.factos_obrigatorios,
      texto: i.texto,
      erro: i.erro,
    },
    descricao,
  );
  return {
    decisao,
    descricao,
    justificacao: justificacaoComRegra(decisao.regra, base.justificacao),
  };
}

async function gravar(
  q: Q,
  i: ItemAvaliar,
  a: Avaliacao,
  uso: Uso | null,
): Promise<void> {
  await q.query(
    `INSERT INTO avaliacao.avaliacoes
       (resposta_id, rubrica_versao, gabarito_id, veredicto, comportamento_observado,
        factos_certos, factos_em_falta, factos_errados, justificacao, avaliador,
        tokens_entrada, tokens_saida)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'juiz',$10,$11)`,
    [
      i.resposta_id,
      RUBRICA_VERSAO,
      i.gabarito_id,
      a.decisao.veredicto,
      a.descricao.comportamento_observado,
      a.descricao.factos_certos,
      a.descricao.factos_em_falta,
      a.descricao.factos_errados,
      a.justificacao,
      // Entrada inclui a parte lida/escrita da cache (só há duas colunas).
      uso ? uso.entrada + uso.cache_escrita + uso.cache_leitura : null,
      uso ? uso.saida : null,
    ],
  );
}

/** Corre `fn` sobre os itens com no máximo `n` ao mesmo tempo. */
export async function emParalelo<T>(
  itens: T[],
  n: number,
  fn: (t: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) await fn(itens[proximo++]);
  };
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, trabalhador),
  );
}

export interface ResumoAvaliacao {
  avaliadas: number;
  semGabarito: number;
  /** Vazias / "não percebi": decididas pelas regras sem gastar no juiz. */
  semChamar: number;
  falhadas: { resposta_id: string; erro: string }[];
  uso: Uso;
}

export const CONCORRENCIA = 4;

export async function avaliarExecucao(opts: {
  execucaoId: string;
  lote: boolean;
  reavaliar: boolean;
  cliente: ClienteJuiz;
  q?: Q;
  log?: (m: string) => void;
}): Promise<ResumoAvaliacao> {
  const q = opts.q ?? bd;
  const log = opts.log ?? (() => undefined);
  const itens = await respostasParaAvaliar(q, opts.execucaoId, opts.reavaliar);
  const r: ResumoAvaliacao = {
    avaliadas: 0,
    semGabarito: 0,
    semChamar: 0,
    falhadas: [],
    uso: usoVazio(),
  };

  const comGabarito = itens.filter((i) => i.gabarito_id);
  r.semGabarito = itens.length - comGabarito.length;
  const vazias = comGabarito.filter((i) => semResposta(i.texto, i.erro));
  const paraJuiz = comGabarito.filter((i) => !semResposta(i.texto, i.erro));
  log(
    `${itens.length} respostas: ${paraJuiz.length} para o juiz, ${vazias.length} sem resposta, ${r.semGabarito} sem gabarito aprovado`,
  );

  for (const i of vazias) {
    await gravar(q, i, concluir(i, null), null);
    r.semChamar++;
    r.avaliadas++;
  }

  const tratar = async (i: ItemAvaliar, res: ResultadoChamada | undefined) => {
    if (res?.uso) r.uso = somarUso(r.uso, res.uso);
    if (!res || !res.ok) {
      r.falhadas.push({
        resposta_id: i.resposta_id,
        erro: res?.erro ?? 'sem resultado',
      });
      return;
    }
    await gravar(q, i, concluir(i, res), res.uso);
    r.avaliadas++;
  };

  if (opts.lote && paraJuiz.length) {
    const res = await opts.cliente.avaliarLote(
      paraJuiz.map((i) => ({ id: i.resposta_id, entrada: entradaDe(i) })),
      log,
    );
    for (const i of paraJuiz) await tratar(i, res.get(i.resposta_id));
  } else {
    let feitas = 0;
    await emParalelo(paraJuiz, CONCORRENCIA, async (i) => {
      await tratar(i, await opts.cliente.avaliar(entradaDe(i)));
      if (++feitas % 10 === 0) log(`${feitas}/${paraJuiz.length}`);
    });
  }
  return r;
}
