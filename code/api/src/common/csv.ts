import { StreamableFile } from '@nestjs/common';

/*
 * CSV que o Excel português abre bem (peça 8): ponto e vírgula a separar,
 * vírgula nas casas decimais, BOM UTF-8 (senão os acentos saem trocados),
 * linhas com CRLF e aspas só quando é preciso. Datas em PT (dd/mm/aaaa) no
 * fuso do município.
 */

export type Celula = string | number | boolean | Date | null | undefined;

export interface Coluna<T> {
  titulo: string;
  valor: (linha: T) => Celula;
}

const SEPARADOR = ';';
/** U+FEFF: o Excel só lê UTF-8 com ele. */
export const BOM = String.fromCharCode(0xfeff);
const FUSO = 'Europe/Lisbon';

// Um texto que comece por =, +, - ou @ (ou tab/CR) seria uma fórmula no
// Excel: um nome ou uma descrição pode ser qualquer coisa. Com um apóstrofo
// à frente, fica texto.
const PARECE_FORMULA = /^[=+\-@\t\r]/;

/** "2026-10-22" (só o dia) → "22/10/2026". */
const DIA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatadores = new Map<string, Intl.DateTimeFormat>();
function formatador(fuso: string): Intl.DateTimeFormat {
  let f = formatadores.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('pt-PT', {
      timeZone: fuso,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatadores.set(fuso, f);
  }
  return f;
}

/** Data e hora em PT no fuso: "22/10/2026 14:05". */
export function dataHora(d: Date, fuso = FUSO): string {
  const p = Object.fromEntries(
    formatador(fuso)
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Só o dia ("2026-10-22" ou Date): "22/10/2026". */
export function dia(v: string | Date, fuso = FUSO): string {
  if (typeof v === 'string') {
    const m = DIA_ISO.exec(v);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    v = new Date(v);
  }
  return dataHora(v, fuso).slice(0, 10);
}

/** 1234.5 → "1234,5": sem separador de milhares, para o Excel ler número. */
export function numeroPt(n: number): string {
  if (!Number.isFinite(n)) return '';
  return String(n).replace('.', ',');
}

/** 123450 cêntimos → "1234,50". */
export function euros(centimos: number): string {
  const sinal = centimos < 0 ? '-' : '';
  const a = Math.abs(Math.round(centimos));
  return `${sinal}${Math.floor(a / 100)},${String(a % 100).padStart(2, '0')}`;
}

/** Uma célula já em texto, com aspas se tiver ; " ou quebras de linha. */
export function celula(v: Celula, fuso = FUSO): string {
  if (v === null || v === undefined) return '';
  let t: string;
  if (typeof v === 'number') t = numeroPt(v);
  else if (typeof v === 'boolean') t = v ? 'Sim' : 'Não';
  else if (v instanceof Date) t = dataHora(v, fuso);
  else {
    t = v;
    if (PARECE_FORMULA.test(t)) t = `'${t}`;
  }
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** O ficheiro inteiro: BOM, cabeçalho, linhas, CRLF no fim de cada linha. */
export function gerarCsv<T>(
  colunas: readonly Coluna<T>[],
  linhas: readonly T[],
  fuso = FUSO,
): string {
  const todas = [
    colunas.map((c) => celula(c.titulo, fuso)),
    ...linhas.map((l) => colunas.map((c) => celula(c.valor(l), fuso))),
  ];
  return BOM + todas.map((l) => l.join(SEPARADOR)).join('\r\n') + '\r\n';
}

/** "ocorrencias" + hoje → "ocorrencias-2026-10-22.csv" (dia no fuso). */
export function nomeCsv(base: string, agora = new Date(), fuso = FUSO): string {
  const [d, m, a] = dia(agora, fuso).split('/');
  return `${base}-${a}-${m}-${d}.csv`;
}

/** A resposta HTTP: text/csv em UTF-8, descarregada com o nome dado. */
export function ficheiroCsv(conteudo: string, nome: string): StreamableFile {
  const b = Buffer.from(conteudo, 'utf8');
  return new StreamableFile(b, {
    type: 'text/csv; charset=utf-8',
    disposition: `attachment; filename="${nome}"`,
    length: b.length,
  });
}
