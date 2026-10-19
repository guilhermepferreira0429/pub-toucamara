/**
 * Reciprocal Rank Fusion: junta listas ordenadas (texto completo e vetores)
 * sem ter de comparar pontuações de escalas diferentes. Cada item soma
 * 1 / (k + posição) em cada lista onde aparece (posição a começar em 1).
 * k = 60 é o valor do artigo original (Cormack et al., 2009).
 */
export const RRF_K = 60;

export interface Fundido<T> {
  item: T;
  pontuacao: number;
  /** Posição (1-based) em cada lista, null se não apareceu nela. */
  posicoes: (number | null)[];
}

export function rrf<T>(
  listas: T[][],
  id: (item: T) => string,
  k = RRF_K,
): Fundido<T>[] {
  const porId = new Map<string, Fundido<T>>();
  listas.forEach((lista, l) => {
    const vistos = new Set<string>();
    lista.forEach((item, i) => {
      const chave = id(item);
      // Duplicados dentro da mesma lista contam só na primeira posição.
      if (vistos.has(chave)) return;
      vistos.add(chave);
      let f = porId.get(chave);
      if (!f) {
        f = {
          item,
          pontuacao: 0,
          posicoes: listas.map(() => null),
        };
        porId.set(chave, f);
      }
      f.pontuacao += 1 / (k + i + 1);
      f.posicoes[l] = i + 1;
    });
  });
  // Empate: fica à frente quem apareceu em mais listas, depois a melhor posição.
  return [...porId.values()].sort(
    (x, y) =>
      y.pontuacao - x.pontuacao ||
      contar(y.posicoes) - contar(x.posicoes) ||
      melhor(x.posicoes) - melhor(y.posicoes),
  );
}

function contar(p: (number | null)[]): number {
  return p.filter((x) => x !== null).length;
}

function melhor(p: (number | null)[]): number {
  return Math.min(...p.map((x) => x ?? Infinity));
}
