/*
 * `importar-respostas`: respostas recolhidas à mão (CSV `pergunta;resposta`)
 * → uma execução 'terminada' do sistema, tudo ou nada. A pergunta é o nº de
 * ordem no conjunto ou o texto exato (espaços à parte).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bd } from '../bd.js';
import type { Pergunta } from '../tipos.js';
import { respostasDoCsv } from './csv.js';
import {
  conjuntoParaExecucao,
  gravarResposta,
  type Motivo,
} from './executar.js';
import { sistemaPorNome } from './sistemas.js';

export interface OpcoesImportar {
  sistema: string;
  ficheiro: string;
  conjunto?: string;
  municipio?: string;
  motivo?: Motivo;
}

const normal = (s: string) => s.replace(/\s+/g, ' ').trim();

export async function importarRespostas(
  o: OpcoesImportar,
  log: (l: string) => void = (l) => console.log(l),
): Promise<{ execucao_id: string; respostas: number }> {
  const sistema = await sistemaPorNome(o.sistema);
  if (sistema.adaptador !== 'manual') {
    log(
      `Aviso: "${sistema.nome}" usa o adaptador ${sistema.adaptador}; as respostas ficam na mesma como uma execução dele.`,
    );
  }
  let municipioId = sistema.municipio_id;
  if (o.municipio) {
    const [m] = await bd.query<{ id: string }>(
      'SELECT id FROM municipios WHERE slug = $1',
      [o.municipio],
    );
    if (!m) throw new Error(`Município "${o.municipio}" não existe.`);
    municipioId = m.id;
  }
  const conjunto = await conjuntoParaExecucao(o.conjunto, municipioId);
  const perguntas = await bd.query<Pergunta>(
    `SELECT id, conjunto_id, ordem, categoria, texto, idioma, comportamento,
            entidade_esperada, nota
     FROM avaliacao.perguntas WHERE conjunto_id = $1 ORDER BY ordem`,
    [conjunto.id],
  );
  const porOrdem = new Map(perguntas.map((p) => [p.ordem, p]));
  const porTexto = new Map(perguntas.map((p) => [normal(p.texto), p]));

  const linhas = respostasDoCsv(await readFile(o.ficheiro, 'utf8'));
  if (linhas.length === 0) throw new Error('O CSV não tem respostas.');
  const erros: string[] = [];
  const vistas = new Map<string, number>();
  const pares: { p: Pergunta; resposta: string; linha: number }[] = [];
  for (const l of linhas) {
    const p =
      l.ordem !== null
        ? porOrdem.get(l.ordem)
        : porTexto.get(normal(l.pergunta));
    if (!p) {
      erros.push(
        `linha ${l.linha}: pergunta "${l.pergunta.slice(0, 60)}" não existe em "${conjunto.nome}" v${conjunto.versao}`,
      );
      continue;
    }
    const antes = vistas.get(p.id);
    if (antes !== undefined) {
      erros.push(
        `linha ${l.linha}: a pergunta #${p.ordem} já veio na linha ${antes}`,
      );
      continue;
    }
    vistas.set(p.id, l.linha);
    pares.push({ p, resposta: l.resposta, linha: l.linha });
  }
  if (erros.length) {
    throw new Error(
      `CSV com ${erros.length} erro(s), nada importado:\n  ${erros.slice(0, 15).join('\n  ')}${erros.length > 15 ? '\n  …' : ''}`,
    );
  }

  const origem = path.basename(o.ficheiro);
  const id = await bd.transacao(async (tx) => {
    const [e] = await tx.query<{ id: string }>(
      `INSERT INTO avaliacao.execucoes
         (sistema_id, conjunto_id, motivo, amostra, estado, terminada_em)
       VALUES ($1, $2, $3, false, 'terminada', now()) RETURNING id`,
      [sistema.id, conjunto.id, o.motivo ?? 'manual'],
    );
    for (const { p, resposta, linha } of pares) {
      await gravarResposta(
        e.id,
        p.id,
        { texto: resposta, bruto: { origem, linha } },
        tx,
      );
    }
    return e.id;
  });
  log(
    `Execução ${id}: ${pares.length} respostas de "${sistema.nome}" importadas de ${origem} (de ${perguntas.length} perguntas de "${conjunto.nome}" v${conjunto.versao}).`,
  );
  return { execucao_id: id, respostas: pares.length };
}
