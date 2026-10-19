import { readFile } from 'node:fs/promises';
import type { Comando } from '../tipos.js';
import {
  importarConjunto,
  listarConjuntos,
  municipioPorSlug,
  NOME_BASE,
  type LinhaListagem,
} from './conjuntos.js';
import { contarPorCategoria, validarPerguntas } from './formato.js';

function texto(v: string | true | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

const importar: Comando = {
  nome: 'perguntas importar',
  descricao:
    'Cria um conjunto (versão seguinte desse nome e município) com as perguntas do ficheiro JSON.',
  uso: '<ficheiro.json> [--nome "Perguntas base"] [--municipio <slug>]',
  async correr({ posicionais, opcoes }) {
    const ficheiro = posicionais[0];
    if (!ficheiro)
      throw new Error('Falta o ficheiro: perguntas importar <ficheiro.json>');
    let dados: unknown;
    try {
      dados = JSON.parse(await readFile(ficheiro, 'utf8'));
    } catch (e) {
      throw new Error(`Não consegui ler ${ficheiro}: ${(e as Error).message}`);
    }
    const perguntas = validarPerguntas(dados);
    const nome = texto(opcoes.nome) ?? NOME_BASE;
    const slug = texto(opcoes.municipio);
    const municipio = slug ? await municipioPorSlug(slug) : null;

    const c = await importarConjunto(nome, municipio?.id ?? null, perguntas);
    console.log(
      `Conjunto "${c.nome}" v${c.versao}${municipio ? ` (${municipio.slug})` : ' (genérico)'}: ${c.perguntas} perguntas · ${c.id}`,
    );
    for (const [cat, n] of contarPorCategoria(perguntas)) {
      console.log(`  ${String(n).padStart(4)}  ${cat}`);
    }
  },
};

const listar: Comando = {
  nome: 'perguntas listar',
  descricao: 'Conjuntos importados, com o número de perguntas por categoria.',
  async correr() {
    const linhas = await listarConjuntos();
    if (!linhas.length) {
      console.log('Ainda não há conjuntos. Usa `perguntas importar`.');
      return;
    }
    const porConjunto = new Map<string, LinhaListagem[]>();
    for (const l of linhas) {
      porConjunto.set(l.id, [...(porConjunto.get(l.id) ?? []), l]);
    }
    for (const grupo of porConjunto.values()) {
      const c = grupo[0];
      const total = grupo.reduce((s, l) => s + l.n, 0);
      console.log(
        `${c.nome} v${c.versao} · ${c.municipio ?? 'genérico'} · ${total} perguntas · ${c.criado_em.toISOString().slice(0, 10)} · ${c.id}`,
      );
      for (const l of grupo) {
        console.log(`  ${String(l.n).padStart(4)}  ${l.categoria}`);
      }
    }
  },
};

export const comandos: Comando[] = [importar, listar];
