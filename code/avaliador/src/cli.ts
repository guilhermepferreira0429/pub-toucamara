/*
 * avaliador <comando> [args] — ver `avaliador ajuda`.
 * Cada parte regista os seus comandos em `<parte>/comandos.ts`.
 */
import { bd } from './bd.js';
import { comandos as calibracao } from './calibracao/comandos.js';
import { comandos as execucao } from './execucao/comandos.js';
import { comandos as gabarito } from './gabarito/comandos.js';
import { comandos as juiz } from './juiz/comandos.js';
import { comandos as perguntas } from './perguntas/comandos.js';
import { comandos as relatorios } from './relatorios/comandos.js';
import type { Args, Comando } from './tipos.js';

const TODOS: Comando[] = [
  ...perguntas,
  ...gabarito,
  ...execucao,
  ...juiz,
  ...calibracao,
  ...relatorios,
];

/** `--a 1 --b` → { a: '1', b: true }; o resto são posicionais. */
export function lerArgs(lista: string[]): Args {
  const posicionais: string[] = [];
  const opcoes: Record<string, string | true> = {};
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i];
    if (a.startsWith('--')) {
      const [nome, valor] = a.slice(2).split('=', 2);
      const seguinte = lista[i + 1];
      if (valor !== undefined) opcoes[nome] = valor;
      else if (seguinte !== undefined && !seguinte.startsWith('--')) {
        opcoes[nome] = seguinte;
        i++;
      } else opcoes[nome] = true;
    } else posicionais.push(a);
  }
  return { posicionais, opcoes };
}

/** O comando mais comprido cujo nome bate com o início dos argumentos. */
export function encontrar(
  todos: Comando[],
  argv: string[],
): { comando: Comando; resto: string[] } | null {
  let melhor: { comando: Comando; resto: string[] } | null = null;
  for (const c of todos) {
    const partes = c.nome.split(' ');
    if (partes.every((p, i) => argv[i] === p)) {
      if (!melhor || partes.length > melhor.comando.nome.split(' ').length) {
        melhor = { comando: c, resto: argv.slice(partes.length) };
      }
    }
  }
  return melhor;
}

function ajuda() {
  console.log('avaliador <comando> [opções]\n');
  for (const c of TODOS) {
    console.log(`  ${c.nome}${c.uso ? ' ' + c.uso : ''}\n      ${c.descricao}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const achado = encontrar(TODOS, argv);
  if (!achado) {
    ajuda();
    process.exitCode = argv.length && argv[0] !== 'ajuda' ? 1 : 0;
    return;
  }
  try {
    await achado.comando.correr(lerArgs(achado.resto));
  } finally {
    // Depois de um erro de ligação o pool.end() pode não resolver: não se
    // espera por ele mais de 2 s.
    await Promise.race([
      bd.fechar(),
      new Promise((r) => setTimeout(r, 2000).unref()),
    ]);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('src/cli.ts')) {
  main()
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    // Sockets do pg ou do browser que fiquem pendurados não seguram a CLI.
    .finally(() => process.exit(process.exitCode ?? 0));
}
