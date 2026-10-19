/*
 * relatorio comparar | auditoria | pitch: ficheiros em PASTA_SAIDA/relatorios/
 * (HTML autónomo; --pdf também gera o PDF).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { concordanciaExecucoes, listaIds } from '../calibracao/comandos.js';
import { config } from '../config.js';
import type { Args, Comando } from '../tipos.js';
import { perguntasComuns } from './agregar.js';
import {
  carregarExecucoes,
  lerCapturas,
  municipioPorSlug,
  ultimasExecucoes,
} from './dados.js';
import {
  linhaPitch,
  montarAuditoria,
  montarComparacao,
  textoPitch,
} from './montar.js';
import { htmlParaPdf } from './pdf.js';

const pastaRelatorios = () => path.join(config.pastaSaida, 'relatorios');

function carimbo(d: Date): string {
  return d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
}

async function guardar(
  nome: string,
  html: string,
  pdf: boolean,
): Promise<void> {
  await mkdir(pastaRelatorios(), { recursive: true });
  const ficheiro = path.join(pastaRelatorios(), `${nome}.html`);
  await writeFile(ficheiro, html, 'utf8');
  console.log(`HTML: ${ficheiro}`);
  if (pdf) {
    const destino = ficheiro.replace(/\.html$/, '.pdf');
    await htmlParaPdf(html, destino);
    console.log(`PDF:  ${destino}`);
  }
}

async function comparar(args: Args) {
  const ids = listaIds(args.opcoes.execucoes);
  if (ids.length < 2)
    throw new Error('Comparar precisa de pelo menos duas execuções.');
  const execs = await carregarExecucoes(ids);
  const agora = new Date();
  const calib = await concordanciaExecucoes(ids);
  const comuns = perguntasComuns(execs);
  const capturas = await lerCapturas(
    execs.flatMap((e) =>
      e.respostas
        .filter((r) => comuns.has(r.pergunta_id))
        .map((r) => r.captura_key),
    ),
  );
  const { html, comuns: n } = montarComparacao(execs, {
    capturas,
    calibracao: calib,
    geradoEm: agora,
  });
  if (!n) console.log('Aviso: nenhuma pergunta comum a todas as execuções.');
  await guardar(`comparacao-${carimbo(agora)}`, html, args.opcoes.pdf === true);
}

async function auditoria(args: Args) {
  const slug = args.opcoes.municipio;
  if (typeof slug !== 'string')
    throw new Error(
      'Uso: relatorio auditoria --municipio <slug> [--execucoes ...] [--pdf]',
    );
  const m = await municipioPorSlug(slug);
  let ids: string[];
  if (args.opcoes.execucoes !== undefined)
    ids = listaIds(args.opcoes.execucoes);
  else {
    // Por omissão: a última execução terminada de cada sistema do município.
    const ultimas = await ultimasExecucoes({ municipioSlug: slug });
    if (!ultimas.some((u) => u.nosso))
      throw new Error(
        `Não há execução terminada do nosso agente para ${m.nome}. Indique-a com --execucoes <nossa,atual>.`,
      );
    if (!ultimas.some((u) => !u.nosso))
      throw new Error(
        `Não há execução terminada de um assistente atual de ${m.nome}.`,
      );
    ids = ultimas.map((u) => u.id);
    console.log(
      `Execuções: ${ultimas.map((u) => `${u.sistema} (${u.id})`).join(', ')}`,
    );
  }
  const execs = await carregarExecucoes(ids);
  const agora = new Date();
  const comuns = perguntasComuns(execs);
  const capturas = await lerCapturas(
    execs.flatMap((e) =>
      e.respostas
        .filter((r) => comuns.has(r.pergunta_id))
        .map((r) => r.captura_key),
    ),
  );
  const html = montarAuditoria(execs, {
    municipio: m.nome,
    capturas,
    calibracao: await concordanciaExecucoes(ids),
    geradoEm: agora,
  });
  await guardar(
    `auditoria-${m.slug}-${carimbo(agora)}`,
    html,
    args.opcoes.pdf === true,
  );
}

async function pitch() {
  const ultimas = await ultimasExecucoes();
  if (!ultimas.length) throw new Error('Ainda não há execuções terminadas.');
  const execs = await carregarExecucoes(ultimas.map((u) => u.id));
  const linhas = [];
  for (const e of execs)
    linhas.push(linhaPitch(e, await concordanciaExecucoes([e.id])));
  const comuns = perguntasComuns(execs).size;
  const texto = textoPitch(linhas, comuns);
  const agora = new Date();
  await mkdir(pastaRelatorios(), { recursive: true });
  const base = path.join(pastaRelatorios(), `pitch-${carimbo(agora)}`);
  await writeFile(
    `${base}.json`,
    JSON.stringify(
      {
        gerado_em: agora.toISOString(),
        perguntas_comuns: comuns,
        sistemas: linhas,
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(`${base}.txt`, texto + '\n', 'utf8');
  console.log(texto);
  console.log(`\n${base}.txt\n${base}.json`);
}

export const comandos: Comando[] = [
  {
    nome: 'relatorio comparar',
    descricao:
      'Mesmas perguntas em N sistemas: taxa global e por tema, divergências nos dois sentidos com capturas, concordância do juiz.',
    uso: '--execucoes <id,id,...> [--pdf]',
    correr: comparar,
  },
  {
    nome: 'relatorio auditoria',
    descricao:
      'Relatório para uma câmara: o assistente atual vs o Tou, Câmara?, exemplos fortes e o que muda para o munícipe.',
    uso: '--municipio <slug> [--execucoes <nossa,atual,...>] [--pdf]',
    correr: auditoria,
  },
  {
    nome: 'relatorio pitch',
    descricao:
      'Uma linha por sistema (última execução terminada): texto para o slide e JSON.',
    correr: pitch,
  },
];
