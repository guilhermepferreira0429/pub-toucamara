import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { config } from '../config.js';
import { escolherConjunto, municipioPorSlug } from '../perguntas/conjuntos.js';
import type { Args, Comando } from '../tipos.js';
import {
  gabaritosParaClassificar,
  gravarEssenciais,
  lerEssenciais,
  planearEssenciais,
} from './essenciais.js';
import {
  dominiosOficiais,
  entidadesDoMunicipio,
  procurarContexto,
} from './fontes.js';
import {
  aplicarRevisao,
  estadoPorCategoria,
  gravarProposta,
  itensParaRevisao,
  perguntasParaPropor,
} from './gabarito.js';
import {
  emParalelo,
  erroFatal,
  mensagemPergunta,
  proporGabarito,
  promptSistema,
} from './propor.js';
import { gerarRevisao, lerRevisao } from './revisao.js';

/** Poucas em paralelo: a pesquisa web é lenta e os limites da conta são partilhados. */
const CONCORRENCIA = 3;
const ESTADOS = ['proposto', 'aprovado', 'rejeitado'];

function opcao(a: Args, nome: string): string | undefined {
  const v = a.opcoes[nome];
  return typeof v === 'string' ? v : undefined;
}

function obrigatoria(a: Args, nome: string, uso: string): string {
  const v = opcao(a, nome);
  if (!v) throw new Error(`Falta --${nome}. Uso: ${uso}`);
  return v;
}

const USO_PROPOR = '--municipio <slug> [--conjunto <nome>] [--so-em-falta]';

const propor: Comando = {
  nome: 'gabarito propor',
  descricao:
    'O Claude propõe gabarito (resposta, factos, fontes) para as perguntas sem gabarito aprovado nem proposto. Pode ser interrompido e retomado.',
  uso: USO_PROPOR,
  async correr(a) {
    // Antes de tudo: sem chave não há nada a fazer e mais vale dizê-lo já.
    if (!config.ia.apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY em falta: propor gabarito precisa da API da Anthropic. Põe a chave no .env do avaliador.',
      );
    }
    const municipio = await municipioPorSlug(
      obrigatoria(a, 'municipio', USO_PROPOR),
    );
    const conjunto = await escolherConjunto(opcao(a, 'conjunto'), municipio.id);
    const pendentes = await perguntasParaPropor(
      conjunto.id,
      municipio.id,
      a.opcoes['so-em-falta'] === true,
    );
    console.log(
      `${conjunto.nome} v${conjunto.versao} · ${municipio.nome}: ${pendentes.length} perguntas para propor (modelo ${config.ia.modelo}).`,
    );
    if (!pendentes.length) return;

    const entidades = await entidadesDoMunicipio(municipio.id);
    const dominios = dominiosOficiais(entidades.map((e) => e.site_url));
    if (!dominios.length) {
      console.log(
        'Aviso: nenhuma entidade com site_url; a proposta usa só as fontes da BD.',
      );
    }
    const sistema = promptSistema(municipio.nome, entidades);
    const cliente = new Anthropic({ apiKey: config.ia.apiKey, maxRetries: 4 });

    let feitas = 0;
    const falhas: string[] = [];
    const tokens = { entrada: 0, saida: 0, pesquisas: 0 };
    await emParalelo(pendentes, CONCORRENCIA, async (p) => {
      try {
        const contexto = await procurarContexto(municipio.id, p.texto);
        const r = await proporGabarito(cliente, {
          modelo: config.ia.modelo,
          sistema,
          mensagem: mensagemPergunta(p, contexto),
          dominios,
        });
        // Grava-se logo: se o processo parar, esta já não se repete.
        const versao = await gravarProposta(p.id, municipio.id, r.conteudo);
        feitas++;
        tokens.entrada += r.tokens_entrada;
        tokens.saida += r.tokens_saida;
        tokens.pesquisas += r.pesquisas;
        console.log(
          `  [${feitas + falhas.length}/${pendentes.length}] #${p.ordem} v${versao} · ${contexto.trechos.length} trechos · ${r.pesquisas} pesquisas`,
        );
      } catch (e) {
        if (erroFatal(e)) throw e;
        falhas.push(`#${p.ordem}: ${(e as Error).message}`);
        console.log(
          `  [${feitas + falhas.length}/${pendentes.length}] #${p.ordem} falhou: ${(e as Error).message}`,
        );
      }
    });

    console.log(
      `\nPropostas: ${feitas} · falhas: ${falhas.length} · tokens ${tokens.entrada} entrada / ${tokens.saida} saída · ${tokens.pesquisas} pesquisas web`,
    );
    if (falhas.length) {
      console.log(
        'Volta a correr o mesmo comando para tentar as que falharam.',
      );
      process.exitCode = 1;
    }
  },
};

const USO_EXPORTAR =
  '--municipio <slug> [--estado proposto] [--conjunto <nome>] > revisao.md';

const exportar: Comando = {
  nome: 'gabarito exportar',
  descricao:
    'Escreve no stdout o ficheiro markdown de revisão (uma secção por pergunta).',
  uso: USO_EXPORTAR,
  async correr(a) {
    const municipio = await municipioPorSlug(
      obrigatoria(a, 'municipio', USO_EXPORTAR),
    );
    const estado = opcao(a, 'estado') ?? 'proposto';
    if (!ESTADOS.includes(estado)) {
      throw new Error(`--estado tem de ser um de: ${ESTADOS.join(', ')}`);
    }
    const nomeConjunto = opcao(a, 'conjunto');
    const conjunto = nomeConjunto
      ? await escolherConjunto(nomeConjunto, municipio.id)
      : null;
    const itens = await itensParaRevisao(
      municipio.id,
      estado,
      conjunto?.id ?? null,
    );
    process.stdout.write(
      gerarRevisao(itens, {
        municipio: municipio.nome,
        estado,
        data: new Date().toISOString().slice(0, 10),
      }),
    );
    // Para o stderr, para não ir parar ao ficheiro redirecionado.
    console.error(`${itens.length} gabaritos (${estado}) exportados.`);
  },
};

const USO_IMPORTAR = '<revisao.md> --por "<nome>"';

const importar: Comando = {
  nome: 'gabarito importar',
  descricao:
    'Aplica um ficheiro de revisão: edições, aprovar (substitui o aprovado anterior) ou rejeitar. Ignora as secções sem caixa marcada.',
  uso: USO_IMPORTAR,
  async correr(a) {
    const ficheiro = a.posicionais[0];
    if (!ficheiro)
      throw new Error(
        `Falta o ficheiro. Uso: gabarito importar ${USO_IMPORTAR}`,
      );
    const por = obrigatoria(a, 'por', USO_IMPORTAR);
    const { itens, erros } = lerRevisao(await readFile(ficheiro, 'utf8'));
    if (!itens.length && !erros.length) {
      throw new Error(
        `${ficheiro} não tem secções de gabarito (\`<!-- gabarito: ... -->\`).`,
      );
    }
    const r = await aplicarRevisao(itens, por);
    console.log(
      `Aprovados: ${r.aprovados} · já aprovados sem mudanças: ${r.sem_mudanca} · rejeitados: ${r.rejeitados} · sem decisão: ${r.ignorados}`,
    );
    const todos = [...erros, ...r.erros];
    if (todos.length) {
      console.log(`Não aplicados (${todos.length}):`);
      for (const e of todos) console.log(`  ${e}`);
      process.exitCode = 1;
    }
  },
};

const USO_ESTADO = '--municipio <slug> [--conjunto <nome>]';

const estado: Comando = {
  nome: 'gabarito estado',
  descricao:
    'Quantas perguntas têm gabarito aprovado, proposto ou em falta, por categoria.',
  uso: USO_ESTADO,
  async correr(a) {
    const municipio = await municipioPorSlug(
      obrigatoria(a, 'municipio', USO_ESTADO),
    );
    const conjunto = await escolherConjunto(opcao(a, 'conjunto'), municipio.id);
    const linhas = await estadoPorCategoria(conjunto.id, municipio.id);
    console.log(`${conjunto.nome} v${conjunto.versao} · ${municipio.nome}\n`);
    console.log('aprovado  proposto  em falta  categoria');
    const soma = { aprovadas: 0, propostas: 0, em_falta: 0, total: 0 };
    const col = (n: number) => String(n).padStart(8);
    for (const l of linhas) {
      console.log(
        `${col(l.aprovadas)}  ${col(l.propostas)}  ${col(l.em_falta)}  ${l.categoria}`,
      );
      soma.aprovadas += l.aprovadas;
      soma.propostas += l.propostas;
      soma.em_falta += l.em_falta;
      soma.total += l.total;
    }
    console.log(
      `${col(soma.aprovadas)}  ${col(soma.propostas)}  ${col(soma.em_falta)}  total (${soma.total})`,
    );
  },
};

const USO_ESSENCIAIS =
  '<essenciais.json> --municipio <slug> [--conjunto <nome>] [--seco]';

const essenciais: Comando = {
  nome: 'gabarito essenciais',
  descricao:
    'Importa a classificação E/S dos factos obrigatórios (escala v2) para os gabaritos aprovados. Sem classificação, todos os factos contam como E. --seco: só mostra o que mudava.',
  uso: USO_ESSENCIAIS,
  async correr(a) {
    const ficheiro = a.posicionais[0];
    if (!ficheiro)
      throw new Error(
        `Falta o ficheiro. Uso: gabarito essenciais ${USO_ESSENCIAIS}`,
      );
    const classificacao = lerEssenciais(await readFile(ficheiro, 'utf8'));
    const municipio = await municipioPorSlug(
      obrigatoria(a, 'municipio', USO_ESSENCIAIS),
    );
    const conjunto = await escolherConjunto(opcao(a, 'conjunto'), municipio.id);
    const plano = planearEssenciais(
      classificacao,
      await gabaritosParaClassificar(conjunto.id, municipio.id),
    );
    const mudam = plano.atualizacoes.filter((x) => x.mudou).length;
    const nS = plano.atualizacoes.reduce((n, x) => n + x.secundarios.length, 0);
    console.log(
      `${conjunto.nome} v${conjunto.versao} · ${municipio.nome}: ${plano.atualizacoes.length} perguntas classificadas (${nS} factos S), ${mudam} mudam.`,
    );
    for (const x of plano.avisos) console.log(`  aviso: ${x}`);
    if (a.opcoes.seco === true) console.log('--seco: nada gravado.');
    else console.log(`Gravadas: ${await gravarEssenciais(plano)}.`);
    if (plano.erros.length) {
      console.log(`Não aplicadas (${plano.erros.length}):`);
      for (const e of plano.erros) console.log(`  ${e}`);
      process.exitCode = 1;
    }
  },
};

export const comandos: Comando[] = [
  propor,
  exportar,
  importar,
  estado,
  essenciais,
];
