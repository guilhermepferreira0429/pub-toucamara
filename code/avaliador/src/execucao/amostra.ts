/*
 * A amostra (~20 perguntas) para execuções curtas e para a voz: todas as
 * difíceis (onde os sistemas mais falham e onde passar a humano conta) e uma
 * por cada outra categoria (a de menor ordem: determinística, para duas
 * amostras do mesmo conjunto serem comparáveis).
 */

function normal(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function eDificil(categoria: string): boolean {
  return /dificil|dificeis/.test(normal(categoria));
}

export function escolherAmostra<T extends { ordem: number; categoria: string }>(
  perguntas: T[],
): T[] {
  const ordenadas = [...perguntas].sort((a, b) => a.ordem - b.ordem);
  const vistas = new Set<string>();
  return ordenadas.filter((p) => {
    if (eDificil(p.categoria)) return true;
    if (vistas.has(p.categoria)) return false;
    vistas.add(p.categoria);
    return true;
  });
}
