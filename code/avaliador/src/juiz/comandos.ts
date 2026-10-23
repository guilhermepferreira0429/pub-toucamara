import { bd } from '../bd.js';
import {
  CATEGORIAS,
  type Args,
  type Categoria,
  type Comando,
} from '../tipos.js';
import { avaliarExecucao } from './avaliar.js';
import { clienteAnthropic, type ClienteJuiz } from './cliente.js';
import { custoEstimado, formatarUsd } from './custo.js';
import { RUBRICA_VERSAO } from './rubrica.js';

export interface LinhaResultado {
  execucao_id: string;
  sistema: string;
  categoria: string | null;
  total: number;
  certas: number;
  passadas_bem: number;
  erradas: number;
  sem_resposta: number;
  por_responder: number;
  por_avaliar: number;
  taxa: string | null;
}

/** Uma linha de `avaliacao.resultados_categorias` (escala v2). */
export type LinhaCategorias = {
  categoria: string | null;
  total: number;
  sem_categoria: number;
  suficiente_sim: number;
  suficiente_em_parte: number;
  suficiente_nao: number;
  nota: string | null;
} & Record<Categoria, number>;

export function pct(taxa: string | number | null): string {
  return taxa === null ? '—' : `${Number(taxa).toFixed(1)}%`;
}

/** Taxa global e por categoria, como a vista `avaliacao.resultados` a dá. */
export async function imprimirResultados(execucaoId: string): Promise<void> {
  const linhas = await bd.query<LinhaResultado>(
    `SELECT * FROM avaliacao.resultados WHERE execucao_id = $1
      ORDER BY categoria NULLS FIRST`,
    [execucaoId],
  );
  const total = linhas.find((l) => l.categoria === null);
  if (!total) {
    console.log('Sem respostas nesta execução.');
    return;
  }
  const ok = total.certas + total.passadas_bem;
  console.log(
    `\n${total.sistema} · taxa ${pct(total.taxa)} (${ok}/${total.total})`,
  );
  console.log(
    `  certas ${total.certas} · passadas bem ${total.passadas_bem} · erradas ${total.erradas} · sem resposta ${total.sem_resposta}` +
      ` · por responder ${total.por_responder} · por avaliar ${total.por_avaliar}`,
  );
  console.log('\nPor categoria:');
  for (const l of linhas.filter((l) => l.categoria !== null))
    console.log(
      `  ${pct(l.taxa).padStart(6)}  ${String(l.certas + l.passadas_bem).padStart(3)}/${String(l.total).padEnd(3)} ${l.categoria}`,
    );
  await imprimirCategorias(execucaoId);
}

/** As linhas da escala v2 para a consola (puro, para os testes). */
export function textoCategorias(l: LinhaCategorias): string[] {
  const nota = l.nota === null ? '—' : Number(l.nota).toFixed(1);
  // Da mais alta para a mais baixa, como se lê.
  const dist = [...CATEGORIAS]
    .reverse()
    .filter((c) => l[c] > 0)
    .map((c) => `${c.replace(/_/g, ' ')} ${l[c]}`)
    .join(' · ');
  const linhas = [
    `\nEscala por categorias (v2) · nota ${nota}/100 (${l.total} com categoria${l.sem_categoria ? `, ${l.sem_categoria} só com a rubrica antiga` : ''})`,
    `  ${dist || 'sem respostas com categoria'}`,
    `  suficiente: sim ${l.suficiente_sim} · em parte ${l.suficiente_em_parte} · não ${l.suficiente_nao}`,
  ];
  return linhas;
}

/** Distribuição por categoria, suficiente e nota (vista `resultados_categorias`). */
export async function imprimirCategorias(execucaoId: string): Promise<void> {
  const [l] = await bd.query<LinhaCategorias>(
    `SELECT * FROM avaliacao.resultados_categorias
      WHERE execucao_id = $1 AND categoria IS NULL`,
    [execucaoId],
  );
  if (l) for (const t of textoCategorias(l)) console.log(t);
}

function texto(args: Args, nome: string): string | null {
  const v = args.opcoes[nome];
  return typeof v === 'string' ? v : null;
}

export async function correrAvaliar(
  args: Args,
  criarCliente: () => ClienteJuiz = clienteAnthropic,
): Promise<void> {
  const execucaoId = texto(args, 'execucao');
  if (!execucaoId)
    throw new Error('Uso: avaliar --execucao <id> [--lote] [--reavaliar]');
  // Sem chave falha aqui, antes de qualquer trabalho.
  const cliente = criarCliente();
  const [ex] = await bd.query<{ id: string }>(
    'SELECT id FROM avaliacao.execucoes WHERE id::text = $1',
    [execucaoId],
  );
  if (!ex) throw new Error(`Execução ${execucaoId} não existe.`);

  const lote = args.opcoes.lote === true;
  console.log(
    `Juiz ${cliente.modelo} · rubrica ${RUBRICA_VERSAO} · ${lote ? 'em lote (Batch API)' : 'direto'}`,
  );
  const r = await avaliarExecucao({
    execucaoId,
    lote,
    reavaliar: args.opcoes.reavaliar === true,
    cliente,
    log: (m) => console.log(`  ${m}`),
  });

  console.log(
    `\nAvaliadas ${r.avaliadas} (${r.semChamar} sem resposta, decididas sem o juiz).`,
  );
  if (r.semGabarito)
    console.log(
      `Sem gabarito aprovado: ${r.semGabarito} (ficam fora até o gabarito ser aprovado).`,
    );
  if (r.falhadas.length) {
    console.log(
      `Falharam ${r.falhadas.length} (ficam por avaliar; correr de novo):`,
    );
    for (const f of r.falhadas.slice(0, 10))
      console.log(`  ${f.resposta_id}: ${f.erro}`);
  }
  const tokens = r.uso.entrada + r.uso.cache_escrita + r.uso.cache_leitura;
  console.log(
    `Tokens: ${tokens} entrada (${r.uso.cache_leitura} da cache), ${r.uso.saida} saída · custo estimado ${formatarUsd(custoEstimado(r.uso, cliente.modelo, lote))}`,
  );
  await imprimirResultados(execucaoId);
}

/**
 * `reavaliar --execucao <id>`: a mesma execução, já respondida, passa outra
 * vez pelo juiz com a rubrica atual, sem voltar a perguntar ao sistema. Só as
 * respostas ainda sem avaliação desta rubrica (pode ser interrompido e
 * retomado); --todas repete também as já feitas. No fim compara o veredicto
 * binário com o da rubrica anterior: muda só onde o juiz descreveu a resposta
 * de outra forma, porque as regras binárias são as mesmas.
 */
export async function correrReavaliar(
  args: Args,
  criarCliente: () => ClienteJuiz = clienteAnthropic,
): Promise<void> {
  const execucaoId = texto(args, 'execucao');
  if (!execucaoId)
    throw new Error('Uso: reavaliar --execucao <id> [--lote] [--todas]');
  const cliente = criarCliente();
  const [ex] = await bd.query<{
    id: string;
    estado: string;
    respostas: number;
  }>(
    `SELECT e.id, e.estado,
            (SELECT count(*) FROM avaliacao.respostas r WHERE r.execucao_id = e.id)::int AS respostas
       FROM avaliacao.execucoes e WHERE e.id::text = $1`,
    [execucaoId],
  );
  if (!ex) throw new Error(`Execução ${execucaoId} não existe.`);
  if (!ex.respostas)
    throw new Error(
      `A execução ${execucaoId} não tem respostas: nada a reavaliar.`,
    );
  if (ex.estado === 'a_correr')
    console.log(
      'Aviso: a execução ainda está a correr; reavalia só o que já foi respondido.',
    );

  const lote = args.opcoes.lote === true;
  console.log(
    `Reavaliar sem voltar a perguntar · juiz ${cliente.modelo} · rubrica ${RUBRICA_VERSAO} · ${lote ? 'em lote (Batch API)' : 'direto'}`,
  );
  const r = await avaliarExecucao({
    execucaoId,
    lote,
    reavaliar: args.opcoes.todas === true,
    cliente,
    log: (m) => console.log(`  ${m}`),
  });
  console.log(
    `\nReavaliadas ${r.avaliadas}${r.falhadas.length ? ` · falharam ${r.falhadas.length} (correr de novo)` : ''}${r.semGabarito ? ` · sem gabarito aprovado ${r.semGabarito}` : ''}.`,
  );

  const [c] = await bd.query<{
    comparadas: number;
    mudaram: number;
    rubricas: string | null;
  }>(
    `SELECT count(*)::int AS comparadas,
            count(*) FILTER (WHERE a.veredicto <> b.veredicto)::int AS mudaram,
            string_agg(DISTINCT b.rubrica_versao, ', ') AS rubricas
       FROM avaliacao.respostas r
       JOIN LATERAL (SELECT veredicto FROM avaliacao.avaliacoes
                      WHERE resposta_id = r.id AND avaliador = 'juiz' AND rubrica_versao = $2
                      ORDER BY criada_em DESC LIMIT 1) a ON true
       JOIN LATERAL (SELECT veredicto, rubrica_versao FROM avaliacao.avaliacoes
                      WHERE resposta_id = r.id AND avaliador = 'juiz' AND rubrica_versao <> $2
                      ORDER BY criada_em DESC LIMIT 1) b ON true
      WHERE r.execucao_id = $1`,
    [execucaoId, RUBRICA_VERSAO],
  );
  if (c?.comparadas)
    console.log(
      `Veredicto binário igual ao da rubrica ${c.rubricas} em ${c.comparadas - c.mudaram}/${c.comparadas} (mudou em ${c.mudaram}).`,
    );
  await imprimirResultados(execucaoId);
}

export const comandos: Comando[] = [
  {
    nome: 'avaliar',
    descricao:
      'Passa pelo juiz as respostas de uma execução ainda sem avaliação para a rubrica atual (--lote: Batch API, metade do preço; --reavaliar: todas de novo).',
    uso: '--execucao <id> [--lote] [--reavaliar]',
    correr: (args) => correrAvaliar(args),
  },
  {
    nome: 'reavaliar',
    descricao:
      'Reavalia uma execução já respondida com a rubrica atual (escala por categorias v2), sem voltar a perguntar ao sistema; compara o veredicto binário com a rubrica anterior (--lote: Batch API; --todas: repete também as já feitas com esta rubrica).',
    uso: '--execucao <id> [--lote] [--todas]',
    correr: (args) => correrReavaliar(args),
  },
];
