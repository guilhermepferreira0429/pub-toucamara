/*
 * O calendário de obrigações em iCalendar (RFC 5545), para "adicionar ao
 * calendário" no telemóvel ou no computador. Eventos de dia inteiro, com um
 * lembrete na véspera às 9h. Puro, sem BD.
 */
import type { EventoCalendario } from './balcao-empresas.regras.js';

/** Escapa o texto de um valor (vírgulas, ponto e vírgula, barras, quebras). */
export function escaparIcs(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Dobra as linhas com mais de 75 octetos (UTF-8): a continuação começa por
 * um espaço. Não parte caracteres a meio.
 */
export function dobrarLinha(linha: string): string {
  const partes: string[] = [];
  let atual = '';
  let octetos = 0;
  for (const ch of linha) {
    const n = Buffer.byteLength(ch, 'utf8');
    const max = partes.length === 0 ? 75 : 74;
    if (octetos + n > max) {
      partes.push(atual);
      atual = '';
      octetos = 0;
    }
    atual += ch;
    octetos += n;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}

const diaIcs = (d: string) => d.replace(/-/g, '');

function diaSeguinte(d: string): string {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function carimbo(agora: Date): string {
  return agora
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

export function gerarIcs(
  eventos: EventoCalendario[],
  o: { nome: string; dominio: string; agora?: Date },
): string {
  const agora = carimbo(o.agora ?? new Date());
  const linhas: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tou Camara//Balcao para empresas//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escaparIcs(o.nome)}`,
    'X-WR-TIMEZONE:Europe/Lisbon',
  ];
  for (const e of eventos) {
    const uid = `${e.id.replace(/[^A-Za-z0-9._-]/g, '-')}@${o.dominio}`;
    const descricao = e.demonstracao
      ? `${e.descricao} (Valores de demonstração.)`
      : e.descricao;
    linhas.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${agora}`,
      `DTSTART;VALUE=DATE:${diaIcs(e.data)}`,
      `DTEND;VALUE=DATE:${diaIcs(diaSeguinte(e.data))}`,
      `SUMMARY:${escaparIcs(e.titulo)}`,
      `DESCRIPTION:${escaparIcs(descricao)}`,
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escaparIcs(e.titulo)}`,
      // Na véspera, às 9h (o evento começa à meia-noite).
      'TRIGGER:-PT15H',
      'END:VALARM',
      'END:VEVENT',
    );
  }
  linhas.push('END:VCALENDAR');
  return linhas.map(dobrarLinha).join('\r\n') + '\r\n';
}
