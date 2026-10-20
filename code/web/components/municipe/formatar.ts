/*
 * Datas, horas e valores como se dizem em Portugal ("18 de outubro",
 * "10h30", "64,70 €"). Sempre no fuso de Lisboa: quem abre o link pode
 * estar noutro sítio, mas as horas da câmara são as de cá.
 */

const FUSO = "Europe/Lisbon";

/** 'AAAA-MM-DD' (sem hora) → Date ao meio-dia UTC, para não mudar de dia. */
function paraData(v: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : new Date(v);
}

function partes(v: string, o: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("pt-PT", { timeZone: FUSO, ...o }).format(
    paraData(v),
  );
}

/** "20 de novembro" (com o ano se não for o corrente). */
export function dataLonga(v: string): string {
  const d = paraData(v);
  const mesmoAno =
    partes(v, { year: "numeric" }) ===
    new Intl.DateTimeFormat("pt-PT", { timeZone: FUSO, year: "numeric" }).format(
      new Date(),
    );
  return new Intl.DateTimeFormat("pt-PT", {
    timeZone: FUSO,
    day: "numeric",
    month: "long",
    ...(mesmoAno ? {} : { year: "numeric" }),
  }).format(d);
}

/** "18 out." */
export function dataCurta(v: string): string {
  return partes(v, { day: "numeric", month: "short" });
}

/** "10h30" */
export function hora(v: string): string {
  const [h, m] = partes(v, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":");
  return `${h}h${m}`;
}

/** "terça-feira" */
export function diaSemana(v: string): string {
  return partes(v, { weekday: "long" });
}

/** "OUT" e "21", para o pequeno calendário. */
export function mesEDia(v: string): { mes: string; dia: string } {
  return {
    mes: partes(v, { month: "short" }).replace(".", "").toUpperCase(),
    dia: partes(v, { day: "numeric" }),
  };
}

function diaChave(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

/** "hoje", "ontem" ou "18 out.". */
export function quandoRelativo(v: string): string {
  const d = paraData(v);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86_400_000);
  if (diaChave(d) === diaChave(hoje)) return "hoje";
  if (diaChave(d) === diaChave(ontem)) return "ontem";
  return dataCurta(v);
}

/** "64,70 €" */
export function euros(cent: number): string {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
  }).format(cent / 100);
}

/** "2 min 05 s" para leitores de ecrã; "2:05" para os olhos. */
export function contagem(segundos: number): { curto: string; dito: string } {
  const s = Math.max(0, Math.floor(segundos));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return {
    curto: `${m}:${String(r).padStart(2, "0")}`,
    dito: m > 0 ? `${m} minuto${m === 1 ? "" : "s"} e ${r} segundos` : `${r} segundos`,
  };
}

/** "inglês", a partir de "en". Devolve null se for português. */
export function nomeIdioma(codigo: string | null | undefined): string | null {
  if (!codigo || codigo.toLowerCase().startsWith("pt")) return null;
  try {
    return (
      new Intl.DisplayNames(["pt-PT"], { type: "language" }).of(codigo) ?? codigo
    );
  } catch {
    return codigo;
  }
}

/** Ficheiro .ics para pôr a marcação no calendário do telemóvel. */
export function descarregarCalendario(e: {
  titulo: string;
  inicio: string;
  fim?: string | null;
  local?: string | null;
  notas?: string | null;
}) {
  const ics = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const escapar = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const inicio = new Date(e.inicio);
  const fim = e.fim ? new Date(e.fim) : new Date(inicio.getTime() + 30 * 60_000);
  const linhas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tou, Camara?//PT",
    "BEGIN:VEVENT",
    `UID:${ics(inicio)}-${Math.random().toString(36).slice(2)}@toucamara`,
    `DTSTAMP:${ics(new Date())}`,
    `DTSTART:${ics(inicio)}`,
    `DTEND:${ics(fim)}`,
    `SUMMARY:${escapar(e.titulo)}`,
    ...(e.local ? [`LOCATION:${escapar(e.local)}`] : []),
    ...(e.notas ? [`DESCRIPTION:${escapar(e.notas)}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapar(e.titulo)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(
    new Blob([linhas.join("\r\n")], { type: "text/calendar;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "marcacao.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
