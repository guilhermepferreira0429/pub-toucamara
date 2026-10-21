/*
 * "Calendário de obrigações": quem avisar, e quando, antes de a licença
 * expirar. Sem BD, para testar à parte.
 *
 * Regras:
 * - Só licenças emitidas, com validade, ainda não expiradas e que não
 *   tenham já um pedido de renovação (que não tenha sido recusado).
 * - Cada tipo tem até dois avisos (ex.: 30 e 7 dias antes; 0 = não vai).
 * - Vai o aviso mais próximo do fim em que já se entrou: se o job só
 *   correr a 5 dias do fim, vai o dos 7 dias (o dos 30 já não faz
 *   sentido) e o dos 30 nunca vai.
 * - Um aviso cuja janela já tinha começado quando a licença foi emitida
 *   não vai (a pessoa acabou de receber a licença e viu as datas).
 * - Uma só vez por licença e por aviso: os que já foram não se repetem.
 */
import type { ConfigAvisos } from './comum.js';
import { diasEntre, somarDias } from './comum.js';

export interface LicencaComValidade {
  id: string;
  /** AAAA-MM-DD, último dia em que vale. */
  valida_ate: string;
  /** AAAA-MM-DD, dia em que foi emitida. */
  emitida_em: string;
  renovada: boolean;
  /** Os avisos (em dias antes) que já foram. */
  avisos_enviados: number[];
}

/** Os avisos configurados, do mais cedo (mais dias antes) ao mais tarde. */
export function diasDeAviso(c: ConfigAvisos): number[] {
  return [...new Set([c.aviso_1_dias, c.aviso_2_dias])]
    .filter((d) => d > 0)
    .sort((a, b) => b - a);
}

/** O aviso que tem de ir hoje (ou null). */
export function avisoDevido(
  l: LicencaComValidade,
  c: ConfigAvisos,
  hoje: string,
): { dias: number; faltam: number } | null {
  if (l.renovada) return null;
  const faltam = diasEntre(hoje, l.valida_ate);
  if (faltam < 0) return null;
  // O mais tarde em cuja janela já se entrou.
  const dias = diasDeAviso(c)
    .filter((d) => faltam <= d)
    .sort((a, b) => a - b)[0];
  if (dias === undefined) return null;
  if (l.avisos_enviados.some((d) => d <= dias)) return null;
  if (l.emitida_em >= somarDias(l.valida_ate, -dias)) return null;
  return { dias, faltam };
}

/** Para o painel: o que já foi e quando vai o próximo. */
export function proximoAviso(
  l: LicencaComValidade,
  c: ConfigAvisos,
  hoje: string,
): { dias: number; em: string } | null {
  if (l.renovada || diasEntre(hoje, l.valida_ate) < 0) return null;
  const devido = avisoDevido(l, c, hoje);
  if (devido) return { dias: devido.dias, em: hoje };
  const enviadoMaisTarde = Math.min(...l.avisos_enviados, Infinity);
  for (const d of diasDeAviso(c)) {
    const em = somarDias(l.valida_ate, -d);
    if (em <= hoje || d >= enviadoMaisTarde) continue;
    if (l.emitida_em >= em) continue;
    return { dias: d, em };
  }
  return null;
}

/** A segunda-feira da semana deste dia. */
export function inicioDaSemana(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return somarDias(dia, -((d + 6) % 7));
}

/** Agrupa por semana (de segunda a domingo), pela ordem de `valida_ate`. */
export function porSemana<T extends { valida_ate: string }>(
  lista: T[],
): { inicio: string; fim: string; licencas: T[] }[] {
  const semanas = new Map<string, T[]>();
  for (const l of [...lista].sort((a, b) =>
    a.valida_ate.localeCompare(b.valida_ate),
  )) {
    const s = inicioDaSemana(l.valida_ate);
    semanas.set(s, [...(semanas.get(s) ?? []), l]);
  }
  return [...semanas.entries()].map(([inicio, licencas]) => ({
    inicio,
    fim: somarDias(inicio, 6),
    licencas,
  }));
}
