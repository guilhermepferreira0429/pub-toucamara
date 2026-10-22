/**
 * "1 carta", "3 cartas": o número com a palavra no singular ou no plural.
 * O número sai em português de Portugal (1 234).
 */
export function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-PT")} ${n === 1 ? um : varios}`;
}
