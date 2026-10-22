/*
 * Custo estimado de cada chamada à IA, pela tabela dos fornecedores de
 * outubro de 2026. É uma
 * estimativa para o painel e para os limites: a fatura é a do fornecedor.
 * Em dólares por milhão de tokens; o resultado em microdólares.
 */

interface Tabela {
  entrada: number;
  saida: number;
}

interface PrecoModelo extends Tabela {
  // A cache lida custa uma fração da entrada; a escrita (5 minutos), 1,25 vezes.
  leituraCache: number;
  // Acima deste tamanho de pedido (entrada e cache), a tabela mais cara.
  longo?: { acimaDe: number } & Tabela;
}

const PRECOS: Record<string, PrecoModelo> = {
  'claude-haiku-5-5': {
    entrada: 0.1,
    saida: 0.5,
    leituraCache: 0.1,
    longo: { acimaDe: 100_000, entrada: 0.5, saida: 2.5 },
  },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, leituraCache: 0.1 },
  'claude-opus-5-5': { entrada: 4, saida: 20, leituraCache: 0.05 },
  'claude-haiku-4-5': { entrada: 1, saida: 5, leituraCache: 0.1 },
  'claude-sonnet-4-6': { entrada: 3, saida: 15, leituraCache: 0.1 },
};

// Um modelo fora da tabela conta como o Sonnet: mais vale estimar por cima.
const DESCONHECIDO = PRECOS['claude-sonnet-5-5'];
export const ESCRITA_CACHE = 1.25;

export interface Tokens {
  entrada: number;
  saida: number;
  cacheLidos: number;
  cacheEscritos: number;
}

/** Custo de uma chamada à Claude, em microdólares. */
export function custoClaude(modelo: string, t: Tokens): number {
  const p = PRECOS[modelo] ?? DESCONHECIDO;
  const pedido = t.entrada + t.cacheLidos + t.cacheEscritos;
  const tabela: Tabela = p.longo && pedido > p.longo.acimaDe ? p.longo : p;
  // Um milhão de tokens a 1 dólar é um milhão de microdólares.
  return Math.round(
    t.entrada * tabela.entrada +
      t.cacheLidos * tabela.entrada * p.leituraCache +
      t.cacheEscritos * tabela.entrada * ESCRITA_CACHE +
      t.saida * tabela.saida,
  );
}

/** Os tokens do `usage` da API (campos podem vir a null). */
export function tokensDe(
  u:
    | {
        input_tokens?: number | null;
        output_tokens?: number | null;
        cache_read_input_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
      }
    | null
    | undefined,
): Tokens {
  return {
    entrada: u?.input_tokens ?? 0,
    saida: u?.output_tokens ?? 0,
    cacheLidos: u?.cache_read_input_tokens ?? 0,
    cacheEscritos: u?.cache_creation_input_tokens ?? 0,
  };
}

/** Microdólares → euros, com a taxa de câmbio configurada. */
export function emEuros(microdolares: number, usdEur: number): number {
  return (microdolares / 1_000_000) * usdEur;
}
