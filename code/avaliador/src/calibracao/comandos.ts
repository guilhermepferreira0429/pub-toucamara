/*
 * calibrar exportar | importar | concordancia: uma pessoa avalia uma amostra
 * às cegas e medimos se o juiz concorda com ela. A avaliação humana fica com
 * `avaliador = <nome>` e prevalece sobre a do juiz na vista avaliacao_final.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { bd, type Q } from '../bd.js';
import { RUBRICA_VERSAO } from '../juiz/rubrica.js';
import type { Args, Comando, Veredicto } from '../tipos.js';
import {
  amostraEstratificada,
  concordancia,
  gerarCalibracao,
  lerCalibracao,
  lerKappa,
  type Concordancia,
  type ItemCalibracao,
} from './amostra.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function listaIds(
  v: string | true | undefined,
  nome = 'execucoes',
): string[] {
  if (typeof v !== 'string' || !v.trim())
    throw new Error(`Falta --${nome} <id,id,...>`);
  const ids = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const maus = ids.filter((i) => !UUID.test(i));
  if (maus.length) throw new Error(`Ids inválidos: ${maus.join(', ')}`);
  return ids;
}

interface LinhaCalibracao extends ItemCalibracao {
  sistema_id: string;
  veredicto_juiz: Veredicto;
}

async function respostasAvaliadasPeloJuiz(q: Q, ids: string[]) {
  return q.query<LinhaCalibracao>(
    `SELECT r.id AS resposta_id, r.texto, e.sistema_id,
            p.texto AS pergunta, p.idioma, p.categoria, p.comportamento, p.entidade_esperada,
            g.resposta AS gabarito_resposta,
            coalesce(g.factos_obrigatorios, '{}') AS factos_obrigatorios,
            coalesce(g.factos_proibidos, '{}') AS factos_proibidos,
            j.veredicto AS veredicto_juiz
       FROM avaliacao.respostas r
       JOIN avaliacao.execucoes e ON e.id = r.execucao_id
       JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
       JOIN LATERAL (SELECT a.veredicto, a.gabarito_id FROM avaliacao.avaliacoes a
                      WHERE a.resposta_id = r.id AND a.avaliador = 'juiz'
                      ORDER BY a.criada_em DESC LIMIT 1) j ON true
       LEFT JOIN avaliacao.gabarito g ON g.id = j.gabarito_id
      WHERE r.execucao_id = ANY($1::uuid[]) AND r.erro IS NULL`,
    [ids],
  );
}

async function exportar(args: Args) {
  const ids = listaIds(args.opcoes.execucoes);
  const n =
    typeof args.opcoes.n === 'string' ? parseInt(args.opcoes.n, 10) : 30;
  const semente =
    typeof args.opcoes.semente === 'string'
      ? args.opcoes.semente
      : ids.join(',');
  const linhas = await respostasAvaliadasPeloJuiz(bd, ids);
  if (!linhas.length)
    throw new Error(
      'Nenhuma resposta avaliada pelo juiz nessas execuções (correr `avaliar` primeiro).',
    );
  const amostra = amostraEstratificada(linhas, {
    id: (l) => l.resposta_id,
    estrato: (l) => `${l.sistema_id}|${l.veredicto_juiz}`,
    n,
    semente,
  });
  const md = gerarCalibracao(
    amostra,
    `Calibração do juiz · ${amostra.length} respostas`,
  );
  const saida = args.opcoes.saida;
  if (typeof saida === 'string') {
    await writeFile(saida, md, 'utf8');
    console.error(
      `${amostra.length} respostas em ${saida} (semente "${semente}").`,
    );
  } else process.stdout.write(md);
}

async function importar(args: Args) {
  const ficheiro = args.posicionais[0];
  const por = args.opcoes.por;
  if (!ficheiro || typeof por !== 'string' || !por.trim())
    throw new Error('Uso: calibrar importar <ficheiro.md> --por "<nome>"');
  if (por.trim().toLowerCase() === 'juiz')
    throw new Error('"juiz" está reservado para o juiz automático.');
  const leitura = lerCalibracao(await readFile(ficheiro, 'utf8'));
  if (leitura.erros.length)
    throw new Error(
      `Corrija o ficheiro e volte a importar:\n  ${leitura.erros.join('\n  ')}`,
    );

  await bd.transacao(async (tx) => {
    for (const a of leitura.avaliacoes) {
      // O gabarito com que a pessoa avaliou é o mesmo que o juiz usou.
      const [j] = await tx.query<{ gabarito_id: string | null }>(
        `SELECT gabarito_id FROM avaliacao.avaliacoes
          WHERE resposta_id = $1 AND avaliador = 'juiz'
          ORDER BY criada_em DESC LIMIT 1`,
        [a.resposta_id],
      );
      // Reimportar o mesmo ficheiro substitui, não duplica.
      await tx.query(
        'DELETE FROM avaliacao.avaliacoes WHERE resposta_id = $1 AND avaliador = $2',
        [a.resposta_id, por.trim()],
      );
      await tx.query(
        `INSERT INTO avaliacao.avaliacoes
           (resposta_id, rubrica_versao, gabarito_id, veredicto, justificacao, avaliador)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          a.resposta_id,
          RUBRICA_VERSAO,
          j?.gabarito_id ?? null,
          a.veredicto,
          a.nota,
          por.trim(),
        ],
      );
    }
  });
  console.log(
    `${leitura.avaliacoes.length} avaliações de ${por.trim()} gravadas` +
      (leitura.porAvaliar.length
        ? `; ${leitura.porAvaliar.length} por marcar.`
        : '.'),
  );
}

export interface Discordancia {
  resposta_id: string;
  sistema: string;
  pergunta: string;
  juiz: Veredicto;
  pessoa: Veredicto;
  quem: string;
  justificacao_juiz: string | null;
}

/** Concordância juiz × pessoa nas respostas dessas execuções que têm as duas. */
export async function concordanciaExecucoes(
  ids: string[],
  q: Q = bd,
): Promise<Concordancia & { discordancias: Discordancia[] }> {
  const linhas = await q.query<Discordancia>(
    `SELECT r.id AS resposta_id, s.nome AS sistema, p.texto AS pergunta,
            j.veredicto AS juiz, j.justificacao AS justificacao_juiz,
            h.veredicto AS pessoa, h.avaliador AS quem
       FROM avaliacao.respostas r
       JOIN avaliacao.execucoes e ON e.id = r.execucao_id
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
       JOIN avaliacao.perguntas p ON p.id = r.pergunta_id
       JOIN LATERAL (SELECT veredicto, justificacao FROM avaliacao.avaliacoes
                      WHERE resposta_id = r.id AND avaliador = 'juiz'
                      ORDER BY criada_em DESC LIMIT 1) j ON true
       JOIN LATERAL (SELECT veredicto, avaliador FROM avaliacao.avaliacoes
                      WHERE resposta_id = r.id AND avaliador <> 'juiz'
                      ORDER BY criada_em DESC LIMIT 1) h ON true
      WHERE r.execucao_id = ANY($1::uuid[])
      ORDER BY s.nome, p.ordem`,
    [ids],
  );
  return {
    ...concordancia(linhas),
    discordancias: linhas.filter((l) => l.juiz !== l.pessoa),
  };
}

async function mostrarConcordancia(args: Args) {
  const ids = listaIds(args.opcoes.execucoes);
  const c = await concordanciaExecucoes(ids);
  if (!c.n) {
    console.log(
      'Ainda não há respostas avaliadas por uma pessoa nestas execuções.',
    );
    return;
  }
  console.log(
    `${c.n} respostas avaliadas pelo juiz e por uma pessoa: acordo ${c.acordo!.toFixed(1)}% · kappa de Cohen ${c.kappa!.toFixed(2)} (${lerKappa(c.kappa)})`,
  );
  if (!c.discordancias.length) return;
  console.log(`\nDiscordâncias (${c.discordancias.length}):`);
  for (const d of c.discordancias)
    console.log(
      `- ${d.pergunta}\n    ${d.sistema} · juiz: ${d.juiz} · ${d.quem}: ${d.pessoa}\n    ${d.justificacao_juiz ?? ''}\n    resposta ${d.resposta_id}`,
    );
}

export const comandos: Comando[] = [
  {
    nome: 'calibrar exportar',
    descricao:
      'Amostra estratificada (sistemas × veredictos, com semente) para uma pessoa avaliar às cegas; markdown para stdout ou --saida.',
    uso: '--execucoes <id,id,...> [--n 30] [--semente <texto>] [--saida <ficheiro.md>]',
    correr: exportar,
  },
  {
    nome: 'calibrar importar',
    descricao: 'Grava as avaliações da pessoa (prevalecem sobre as do juiz).',
    uso: '<ficheiro.md> --por "<nome>"',
    correr: importar,
  },
  {
    nome: 'calibrar concordancia',
    descricao: 'Acordo juiz × pessoa, kappa de Cohen e as discordâncias.',
    uso: '--execucoes <id,id,...>',
    correr: mostrarConcordancia,
  },
];
