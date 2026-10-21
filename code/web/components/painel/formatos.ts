/*
 * Formatos pequenos partilhados pelos ecrãs do painel (marcações, chamadas).
 */

/** O mesmo formato da API ('+351 9•• ••• 214'): o número inteiro não aparece no ecrã. */
export function mascararTelefone(tel: string | null | undefined): string {
  if (!tel) return "—";
  const d = tel.replace(/\D/g, "");
  if (d.length < 7) return "•••";
  return `+${d.slice(0, 3)} ${d.slice(3, 4)}•• ••• ${d.slice(-3)}`;
}
