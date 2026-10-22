import type { EventoCalendario } from './balcao-empresas.regras.js';
import { dobrarLinha, escaparIcs, gerarIcs } from './ics.js';

const EVENTO: EventoCalendario = {
  id: 'renovar:ESP 3/2026:2026-12-01',
  data: '2026-11-01',
  tipo: 'renovar',
  titulo: 'Renovar a licença de esplanada ESP 3/2026',
  descricao:
    'Vale até 1 de dezembro de 2026. Para renovar, ligue ou escreva à câmara; a taxa foi 72,00 €.',
  licenca: 'ESP 3/2026',
  taxa_cent: 7200,
  demonstracao: false,
};

describe('calendário .ics', () => {
  it('escapa vírgulas, ponto e vírgula, barras e quebras de linha', () => {
    expect(escaparIcs('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('dobra as linhas compridas em 75 octetos, sem partir acentos', () => {
    const longa = `DESCRIPTION:${'ção '.repeat(40)}`;
    const d = dobrarLinha(longa);
    const partes = d.split('\r\n');
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) {
      expect(Buffer.byteLength(p, 'utf8')).toBeLessThanOrEqual(75);
    }
    expect(partes.slice(1).every((p) => p.startsWith(' '))).toBe(true);
    expect(partes.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(longa);
  });

  it('um VEVENT de dia inteiro por evento, com lembrete, em CRLF', () => {
    const ics = gerarIcs(
      [EVENTO, { ...EVENTO, id: 'x', data: '2026-12-01', demonstracao: true }],
      {
        nome: 'Obrigações · Guimarães',
        dominio: 'toucamara.pt',
        agora: new Date('2026-10-22T10:00:00Z'),
      },
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/\n/);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    const plano = ics.replace(/\r\n /g, '');
    expect(plano).toContain('DTSTART;VALUE=DATE:20261101');
    expect(plano).toContain('DTEND;VALUE=DATE:20261102');
    expect(plano).toContain('DTSTAMP:20261022T100000Z');
    expect(plano).toContain('UID:renovar-ESP-3-2026-2026-12-01@toucamara.pt');
    expect(plano).toContain(
      'SUMMARY:Renovar a licença de esplanada ESP 3/2026',
    );
    expect(plano).toContain(
      'ligue ou escreva à câmara\\; a taxa foi 72\\,00 €',
    );
    expect(plano).toContain('(Valores de demonstração.)');
    expect(plano).toContain('TRIGGER:-PT15H');
  });
});
