/*
 * Prazos em dias úteis (CPA): não contam sábados, domingos nem feriados
 * (nacionais + municipais, tabela `feriados`). Datas como 'YYYY-MM-DD',
 * no calendário de Lisboa.
 */

export type Feriados = ReadonlySet<string>;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function deIso(s: string): Date {
  return new Date(`${s}T12:00:00Z`);
}

export function eDiaUtil(dia: string, feriados: Feriados): boolean {
  const semana = deIso(dia).getUTCDay();
  return semana !== 0 && semana !== 6 && !feriados.has(dia);
}

/** O dia útil n depois de `inicio` (o próprio dia não conta). */
export function somarDiasUteis(
  inicio: string,
  n: number,
  feriados: Feriados,
): string {
  const d = deIso(inicio);
  let contados = 0;
  while (contados < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (eDiaUtil(iso(d), feriados)) contados++;
  }
  return iso(d);
}

/** Dias úteis de `de` (exclusive) até `ate` (inclusive); negativo se já passou. */
export function diasUteisEntre(
  de: string,
  ate: string,
  feriados: Feriados,
): number {
  if (ate === de) return 0;
  const sinal = ate > de ? 1 : -1;
  const [a, b] = sinal > 0 ? [de, ate] : [ate, de];
  const d = deIso(a);
  let n = 0;
  while (iso(d) < b) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (eDiaUtil(iso(d), feriados)) n++;
  }
  return sinal * n;
}

/** Hoje em Lisboa, 'YYYY-MM-DD'. */
export function hojeLisboa(agora = new Date()): string {
  return agora.toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' });
}
