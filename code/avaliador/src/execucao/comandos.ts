import type { Args, Comando } from '../tipos.js';
import { correrExecucao, MOTIVOS, type Motivo } from './executar.js';
import { avaliarExecucao } from '../juiz/avaliar.js';
import { clienteAnthropic } from '../juiz/cliente.js';
import { importarRespostas } from './importar.js';
import { pegarPedido, tratarPedido } from './pedidos.js';
import {
  ADAPTADORES,
  criarSistema,
  listarSistemas,
  prepararBase,
} from './sistemas.js';

/** Valor de uma opção com texto; `--x` sem valor é erro. */
function texto(a: Args, nome: string): string | undefined {
  const v = a.opcoes[nome];
  if (v === true) throw new Error(`--${nome} precisa de um valor.`);
  return v;
}

function obrigatorio(a: Args, nome: string): string {
  const v = texto(a, nome);
  if (!v) throw new Error(`Falta --${nome}.`);
  return v;
}

const flag = (a: Args, nome: string) => a.opcoes[nome] !== undefined;

function motivo(a: Args): Motivo | undefined {
  const m = texto(a, 'motivo');
  if (m === undefined) return undefined;
  if (!(MOTIVOS as readonly string[]).includes(m))
    throw new Error(`--motivo: ${MOTIVOS.join('|')}.`);
  return m as Motivo;
}

export const comandos: Comando[] = [
  {
    nome: 'executar',
    descricao:
      'Faz as perguntas (com gabarito aprovado) a um sistema e grava as respostas; --execucao retoma.',
    uso: '--sistema <nome> [--conjunto <nome>] [--municipio <slug>] [--amostra] [--motivo manual|publicacao|pitch|auditoria] [--execucao <id>] [--sem-gabarito] [--forcar] [--ver]',
    async correr(a) {
      const r = await correrExecucao({
        sistema: texto(a, 'sistema'),
        conjunto: texto(a, 'conjunto'),
        municipio: texto(a, 'municipio'),
        amostra: flag(a, 'amostra'),
        motivo: motivo(a),
        execucao: texto(a, 'execucao'),
        semGabarito: flag(a, 'sem-gabarito'),
        forcar: flag(a, 'forcar'),
        ver: flag(a, 'ver'),
        ctrlC: true,
      });
      if (r.estado === 'interrompida') process.exitCode = 2;
    },
  },
  {
    nome: 'repetir-erros',
    descricao:
      'Volta a perguntar só as respostas que ficaram com erro numa execução.',
    uso: '--execucao <id> [--ver]',
    async correr(a) {
      const r = await correrExecucao({
        execucao: obrigatorio(a, 'execucao'),
        soErros: true,
        ver: flag(a, 'ver'),
        ctrlC: true,
      });
      if (r.estado === 'interrompida') process.exitCode = 2;
    },
  },
  {
    nome: 'importar-respostas',
    descricao:
      'Importa um CSV pergunta;resposta (nº de ordem ou texto exato) como uma execução terminada.',
    uso: '--sistema <nome> <ficheiro.csv> [--conjunto <nome>] [--municipio <slug>] [--motivo ...]',
    async correr(a) {
      const ficheiro = a.posicionais[0];
      if (!ficheiro) throw new Error('Falta o ficheiro CSV.');
      await importarRespostas({
        sistema: obrigatorio(a, 'sistema'),
        ficheiro,
        conjunto: texto(a, 'conjunto'),
        municipio: texto(a, 'municipio'),
        motivo: motivo(a),
      });
    },
  },
  {
    nome: 'sistemas criar',
    descricao: 'Regista um sistema a avaliar.',
    uso: `--nome <n> --adaptador ${ADAPTADORES.join('|')} [--municipio <slug>] [--url <u>] [--config <json>] [--nosso]`,
    async correr(a) {
      const s = await criarSistema({
        nome: obrigatorio(a, 'nome'),
        adaptador: obrigatorio(a, 'adaptador'),
        municipio: texto(a, 'municipio'),
        url: texto(a, 'url'),
        config: texto(a, 'config'),
        nosso: flag(a, 'nosso'),
      });
      console.log(`Sistema "${s.nome}" criado (${s.id}).`);
    },
  },
  {
    nome: 'sistemas listar',
    descricao: 'Lista os sistemas, com o número de execuções e a última.',
    async correr() {
      const linhas = await listarSistemas();
      if (linhas.length === 0) {
        console.log(
          'Sem sistemas. Cria os habituais com `sistemas preparar-base`.',
        );
        return;
      }
      for (const s of linhas) {
        const ultima = s.ultima
          ? new Date(s.ultima).toISOString().slice(0, 16).replace('T', ' ')
          : '—';
        console.log(
          `${s.nosso ? '*' : ' '} ${s.nome.padEnd(36)} ${s.adaptador.padEnd(9)} ${(s.municipio ?? '—').padEnd(12)} ${String(s.execucoes).padStart(3)} exec.  última ${ultima}${s.url ? `  ${s.url}` : ''}`,
        );
      }
      console.log('\n* = o nosso agente');
    },
  },
  {
    nome: 'sistemas preparar-base',
    descricao:
      'Cria os sistemas habituais (o nosso chat e voz por município e a assistente do site) se não existirem.',
    uso: '[--municipios guimaraes]',
    async correr(a) {
      const m = texto(a, 'municipios');
      const r = await prepararBase(
        m
          ? m
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      );
      for (const n of r.criados) console.log(`criado     ${n}`);
      for (const n of r.existentes) console.log(`já existia ${n}`);
      for (const x of r.avisos) console.log(`Aviso: ${x}`);
    },
  },
  {
    nome: 'pedidos trabalhar',
    descricao:
      'Trata os pedidos de avaliação da API ("Correr teste agora", fontes mudadas, versão nova do agente): executa e avalia. Fica à espera de pedidos novos, ou --uma-vez.',
    uso: '[--uma-vez] [--intervalo <segundos>]',
    async correr(a) {
      // Sem chave do juiz falha já, antes de pegar num pedido.
      const cliente = clienteAnthropic();
      const intervalo = Number(texto(a, 'intervalo') ?? 30) * 1000;
      const umaVez = flag(a, 'uma-vez');
      for (;;) {
        const p = await pegarPedido();
        if (p) {
          console.log(`Pedido ${p.id} (${p.motivo}${p.amostra ? ', amostra' : ''})`);
          const r = await tratarPedido(p, {
            executar: (o) => correrExecucao({ ...o, forcar: true }),
            avaliar: async (execucaoId) => {
              await avaliarExecucao({
                execucaoId,
                lote: false,
                reavaliar: false,
                cliente,
                log: (m) => console.log(`  ${m}`),
              });
            },
          });
          console.log(`Pedido ${p.id}: ${r}`);
          continue;
        }
        if (umaVez) return;
        await new Promise((r) => setTimeout(r, intervalo));
      }
    },
  },
];
