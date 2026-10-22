/*
 * Datas e textos curtos do painel ("18 out.", "17 out., 21:47", "faltam 12
 * dias úteis"), sempre no fuso de Lisboa. As datas 'AAAA-MM-DD' da API não
 * têm hora: leem-se tal como estão.
 */

const FUSO = "Europe/Lisbon";
const MESES = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez.",
];
const MESES_LONGOS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: string | null;
}

const SO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatador = new Intl.DateTimeFormat("en-GB", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function partes(v: string | Date): Partes | null {
  if (typeof v === "string") {
    const m = SO_DIA.exec(v);
    if (m) return { ano: +m[1], mes: +m[2], dia: +m[3], hora: null };
  }
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const x of formatador.formatToParts(d)) p[x.type] = x.value;
  return {
    ano: +p.year,
    mes: +p.month,
    dia: +p.day,
    hora: `${p.hour}:${p.minute}`,
  };
}

/** " 2025" quando o ano não é o corrente (senão nada). */
function anoSeOutro(p: Partes): string {
  const hoje = partes(new Date());
  return hoje && hoje.ano !== p.ano ? ` ${p.ano}` : "";
}

/** "18 out." (ou "1 nov. 2025" noutro ano). */
export function diaCurto(v: string | Date | null | undefined): string {
  const p = v ? partes(v) : null;
  return p ? `${p.dia} ${MESES[p.mes - 1]}${anoSeOutro(p)}` : "";
}

/**
 * "17 out., 21:47" (só o dia, se não houver hora; "00:00" é uma data sem
 * hora e também fica só o dia).
 */
export function diaHora(v: string | Date | null | undefined): string {
  const p = v ? partes(v) : null;
  if (!p) return "";
  return p.hora && p.hora !== "00:00"
    ? `${p.dia} ${MESES[p.mes - 1]}${anoSeOutro(p)}, ${p.hora}`
    : diaCurto(v);
}

/** "6 de novembro" (com o ano se não for o corrente). */
export function diaLongo(v: string | Date | null | undefined): string {
  const p = v ? partes(v) : null;
  if (!p) return "";
  const hoje = partes(new Date());
  const ano = hoje && hoje.ano !== p.ano ? ` de ${p.ano}` : "";
  return `${p.dia} de ${MESES_LONGOS[p.mes - 1]}${ano}`;
}

/** "06/11/2026" */
export function diaNumerico(v: string | Date | null | undefined): string {
  const p = v ? partes(v) : null;
  if (!p) return "";
  return `${String(p.dia).padStart(2, "0")}/${String(p.mes).padStart(2, "0")}/${p.ano}`;
}

/** "faltam 12 dias úteis", "falta 1 dia útil", "passou 4 dias". */
export function textoDiasUteis(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  if (n > 1) return `faltam ${n} dias úteis`;
  if (n === 1) return "falta 1 dia útil";
  if (n === 0) return "termina hoje";
  const a = Math.abs(n);
  return `passou ${a} ${a === 1 ? "dia" : "dias"}`;
}

/** Com maiúscula no início (para etiquetas). */
export function capitalizar(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Hoje em Lisboa, 'AAAA-MM-DD'. */
export function hojeIso(): string {
  const p = partes(new Date());
  if (!p) return "";
  return `${p.ano}-${String(p.mes).padStart(2, "0")}-${String(p.dia).padStart(2, "0")}`;
}

// --- SMS (o mesmo cálculo da API: code/api/src/modules/comunicacao/sms.ts) ---

const GSM7_BASICO =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENSAO = "^{}\\[~]|€\f";
const BASICO = new Set(GSM7_BASICO);
const EXTENSAO = new Set(GSM7_EXTENSAO);

export interface ContagemSms {
  codificacao: "gsm7" | "ucs2";
  caracteres: number;
  segmentos: number;
}

export function contarSms(texto: string): ContagemSms {
  let unidades = 0;
  for (const c of texto) {
    if (BASICO.has(c)) unidades += 1;
    else if (EXTENSAO.has(c)) unidades += 2;
    else {
      const caracteres = texto.length;
      return {
        codificacao: "ucs2",
        caracteres,
        segmentos: caracteres <= 70 ? 1 : Math.ceil(caracteres / 67),
      };
    }
  }
  return {
    codificacao: "gsm7",
    caracteres: unidades,
    segmentos: unidades <= 160 ? 1 : Math.ceil(unidades / 153),
  };
}

/** O mesmo texto sem acentos (para mostrar quanto se poupa). */
export function semAcentos(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

export function textoSms(c: ContagemSms): string {
  return `${c.caracteres} caracteres · ${c.segmentos} SMS`;
}
