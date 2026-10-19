import {
  diasUteisEntre,
  eDiaUtil,
  hojeLisboa,
  somarDiasUteis,
} from './dias-uteis.js';

const feriados = new Set(['2026-12-08', '2026-12-25']);

describe('dias úteis', () => {
  it('fim de semana e feriados não contam', () => {
    expect(eDiaUtil('2026-10-24', feriados)).toBe(false); // sábado
    expect(eDiaUtil('2026-12-08', feriados)).toBe(false);
    expect(eDiaUtil('2026-10-19', feriados)).toBe(true);
  });

  it('soma saltando fim de semana e feriado', () => {
    // sexta 4 dez + 2 dias úteis: seg 7, (ter 8 feriado), qua 9
    expect(somarDiasUteis('2026-12-04', 2, feriados)).toBe('2026-12-09');
  });

  it('conta entre datas, com sinal', () => {
    expect(diasUteisEntre('2026-12-04', '2026-12-09', feriados)).toBe(2);
    expect(diasUteisEntre('2026-12-09', '2026-12-04', feriados)).toBe(-2);
  });

  it('hoje em Lisboa', () => {
    expect(hojeLisboa(new Date('2026-10-19T23:30:00Z'))).toBe('2026-10-20');
  });
});
