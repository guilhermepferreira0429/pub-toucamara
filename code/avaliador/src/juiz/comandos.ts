import { bd } from '../bd.js';
import type { Args, Comando } from '../tipos.js';
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

export const comandos: Comando[] = [
  {
    nome: 'avaliar',
    descricao:
      'Passa pelo juiz as respostas de uma execução ainda sem avaliação para a rubrica atual (--lote: Batch API, metade do preço; --reavaliar: todas de novo).',
    uso: '--execucao <id> [--lote] [--reavaliar]',
    correr: (args) => correrAvaliar(args),
  },
];
