/*
 * Quanto pesam as ferramentas de um agente de voz em cada resposta do
 * modelo: a descrição e o esquema dos parâmetros vão no contexto de todas as
 * respostas. Tokens aproximados = caracteres / 4 (o JSON do esquema sem
 * espaços). Serve para o `gerar` mostrar o peso e para o teste de
 * alinhamento travar o crescimento (LIMITE_TOKENS).
 */
import type { FerramentaEl } from './configuracao.js';

/** Tokens aproximados de um texto (caracteres / 4, arredondado). */
export function tokensAprox(texto: string): number {
  return Math.round(texto.length / 4);
}

export interface PesoFerramenta {
  nome: string;
  descricao: number;
  esquema: number;
  total: number;
}

export interface Peso {
  ferramentas: PesoFerramenta[];
  /** Soma das ferramentas (descrição + esquema). */
  total: number;
  prompt: number;
}

export function pesoFerramenta(f: FerramentaEl): PesoFerramenta {
  const descricao = f.description.length;
  const esquema = JSON.stringify(f.api_schema.request_body_schema ?? {}).length;
  return {
    nome: f.name,
    descricao: tokensAprox(f.description),
    esquema: Math.round(esquema / 4),
    total: Math.round((descricao + esquema) / 4),
  };
}

export function medir(ferramentas: FerramentaEl[], prompt = ''): Peso {
  const lista = ferramentas
    .map(pesoFerramenta)
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome));
  const caracteres = ferramentas.reduce(
    (s, f) =>
      s +
      f.description.length +
      JSON.stringify(f.api_schema.request_body_schema ?? {}).length,
    0,
  );
  return {
    ferramentas: lista,
    total: Math.round(caracteres / 4),
    prompt: tokensAprox(prompt),
  };
}

/**
 * Os limites (tokens das ferramentas) que o teste de alinhamento verifica.
 * Antes da divisão em dois agentes eram ~15,4 mil num só agente: subir isto
 * é uma decisão, não um acidente. 8 500 → 8 800 (out.): o catálogo de
 * serviços (outros_servicos + pedir_servico, ~350 tokens) leva as áreas da
 * V4 inteiras, que soltas seriam mais umas 20 ferramentas.
 */
export const LIMITE_TOKENS = { entrada: 8_800, saida: 3_000 } as const;

/** Uma tabela curta para a consola. */
export function tabelaPeso(titulo: string, p: Peso, linhas = 8): string {
  const topo = p.ferramentas
    .slice(0, linhas)
    .map((f) => `    ${String(f.total).padStart(5)}  ${f.nome}`)
    .join('\n');
  return `${titulo}: ${p.ferramentas.length} ferramentas ≈ ${p.total} tokens (+ prompt ≈ ${p.prompt}). As maiores:\n${topo}`;
}
