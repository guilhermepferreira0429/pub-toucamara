/*
 * Custo estimado do juiz. Preços por milhão de tokens (USD), da tabela da
 * Anthropic em out. 2026; mudar aqui quando mudarem. A Batch API cobra metade.
 */
export const PRECOS_POR_MTOK: Record<
  string,
  { entrada: number; saida: number; cache_leitura: number }
> = {
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cache_leitura: 0.2 },
  'claude-sonnet-5': { entrada: 2, saida: 10, cache_leitura: 0.2 },
  'claude-opus-5-5': { entrada: 4, saida: 20, cache_leitura: 0.2 },
  'claude-haiku-5-5': { entrada: 0.1, saida: 0.5, cache_leitura: 0.01 },
};

/** Escrever na cache custa 1,25× a entrada (TTL de 5 min). */
const FATOR_ESCRITA_CACHE = 1.25;

export interface Uso {
  entrada: number;
  cache_escrita: number;
  cache_leitura: number;
  saida: number;
}

export function usoVazio(): Uso {
  return { entrada: 0, cache_escrita: 0, cache_leitura: 0, saida: 0 };
}

export function somarUso(a: Uso, b: Uso): Uso {
  return {
    entrada: a.entrada + b.entrada,
    cache_escrita: a.cache_escrita + b.cache_escrita,
    cache_leitura: a.cache_leitura + b.cache_leitura,
    saida: a.saida + b.saida,
  };
}

/** USD; null se o modelo não está na tabela (melhor não inventar). */
export function custoEstimado(
  uso: Uso,
  modelo: string,
  lote = false,
): number | null {
  const p = PRECOS_POR_MTOK[modelo];
  if (!p) return null;
  const usd =
    (uso.entrada * p.entrada +
      uso.cache_escrita * p.entrada * FATOR_ESCRITA_CACHE +
      uso.cache_leitura * p.cache_leitura +
      uso.saida * p.saida) /
    1e6;
  return lote ? usd / 2 : usd;
}

export function formatarUsd(v: number | null): string {
  return v === null ? 'desconhecido' : `$${v.toFixed(v < 1 ? 4 : 2)}`;
}
