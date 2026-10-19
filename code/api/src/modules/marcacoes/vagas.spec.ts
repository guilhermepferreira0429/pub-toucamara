import {
  diaLocal,
  dizerJanela,
  dizerQuando,
  escolherOpcoes,
  espalhar,
  gerarSlots,
  instanteLocal,
  proximaJanela,
  slotNoHorario,
} from './vagas.js';

const LX = 'Europe/Lisbon';

describe('instanteLocal', () => {
  it('respeita a hora de verão e a de inverno', () => {
    // Em 2026 a hora muda no domingo 25 de outubro.
    expect(instanteLocal('2026-10-23', '09:00', LX).toISOString()).toBe(
      '2026-10-23T08:00:00.000Z',
    );
    expect(instanteLocal('2026-10-26', '09:00', LX).toISOString()).toBe(
      '2026-10-26T09:00:00.000Z',
    );
    expect(diaLocal(new Date('2026-10-19T23:30:00Z'), LX)).toBe('2026-10-20');
  });
});

describe('gerarSlots', () => {
  const base = {
    horario: { seg: ['09:00-10:00'], ter: ['09:00-10:00', '14:00-15:00'] },
    duracaoMin: 30,
    fuso: LX,
    feriados: new Set(['2026-10-27']),
    agora: new Date('2026-10-19T00:00:00Z'),
    ocupados: [],
  };

  it('parte as faixas em slots e salta dias fechados e feriados', () => {
    const s = gerarSlots({
      ...base,
      // seg 19, ter 20, sáb 24 (fechado), ter 27 (feriado)
      dias: ['2026-10-19', '2026-10-20', '2026-10-24', '2026-10-27'],
    });
    expect(s.map((x) => x.inicio.toISOString())).toEqual([
      '2026-10-19T08:00:00.000Z',
      '2026-10-19T08:30:00.000Z',
      '2026-10-20T08:00:00.000Z',
      '2026-10-20T08:30:00.000Z',
      '2026-10-20T13:00:00.000Z',
      '2026-10-20T13:30:00.000Z',
    ]);
    expect(s[0].fim.toISOString()).toBe('2026-10-19T08:30:00.000Z');
  });

  it('tira os slots passados (com antecedência) e os ocupados', () => {
    const s = gerarSlots({
      ...base,
      dias: ['2026-10-19', '2026-10-20'],
      agora: new Date('2026-10-19T07:45:00Z'),
      antecedenciaMin: 30,
      ocupados: [
        {
          inicio: new Date('2026-10-20T08:15:00Z'),
          fim: new Date('2026-10-20T08:45:00Z'),
        },
      ],
    });
    expect(s.map((x) => x.inicio.toISOString())).toEqual([
      '2026-10-19T08:30:00.000Z',
      '2026-10-20T13:00:00.000Z',
      '2026-10-20T13:30:00.000Z',
    ]);
  });

  it('ignora faixas mal escritas e slots que não cabem', () => {
    const s = gerarSlots({
      ...base,
      horario: { seg: ['lixo', '09:00-09:50'] },
      dias: ['2026-10-19'],
    });
    expect(s).toHaveLength(1);
  });

  it('confere se um início pedido existe no horário', () => {
    expect(
      slotNoHorario(new Date('2026-10-20T13:30:00Z'), base),
    ).not.toBeNull();
    expect(slotNoHorario(new Date('2026-10-20T13:15:00Z'), base)).toBeNull();
  });
});

describe('escolherOpcoes', () => {
  it('dá a primeira da manhã e uma da tarde por dia, até ao limite', () => {
    const slots = gerarSlots({
      horario: { seg: ['09:00-12:00', '14:00-16:00'] },
      duracaoMin: 30,
      dias: ['2026-10-19', '2026-10-26', '2026-11-02'],
      fuso: LX,
      feriados: new Set(),
      agora: new Date('2026-10-01T00:00:00Z'),
      ocupados: [],
    });
    const r = escolherOpcoes(slots, LX, 5);
    expect(r.map((x) => dizerQuando(x.inicio, LX))).toEqual([
      'segunda-feira, 19 de outubro, às 9h',
      'segunda-feira, 19 de outubro, às 14h',
      'segunda-feira, 26 de outubro, às 9h',
      'segunda-feira, 26 de outubro, às 14h',
      'segunda-feira, 2 de novembro, às 9h',
    ]);
  });

  it('espalha as vagas de um dia', () => {
    const slots = Array.from({ length: 11 }, (_, i) => ({
      inicio: new Date(i * 1000),
      fim: new Date(i * 1000 + 1),
    }));
    expect(espalhar(slots, 3).map((s) => s.inicio.getTime())).toEqual([
      0, 5000, 10000,
    ]);
    expect(espalhar(slots.slice(0, 2), 3)).toHaveLength(2);
  });

  it('diz minutos quando os há', () => {
    expect(dizerQuando(new Date('2026-10-20T08:30:00Z'), LX)).toBe(
      'terça-feira, 20 de outubro, às 9h30',
    );
  });
});

describe('proximaJanela (recolhas)', () => {
  const feriados = new Set(['2026-12-08']);

  it('começa no dia útil seguinte, na preferência', () => {
    // sexta 4 dez → segunda 7
    expect(
      proximaJanela({
        hoje: '2026-12-04',
        feriados,
        preferencia: 'tarde',
        ocupacao: new Map(),
      }),
    ).toEqual({ dia: '2026-12-07', periodo: 'tarde' });
  });

  it('salta janelas cheias e feriados', () => {
    const ocupacao = new Map([
      ['2026-12-07|manha', 10],
      ['2026-12-07|tarde', 10],
    ]);
    // seg 7 cheio, ter 8 feriado → qua 9 de manhã
    expect(proximaJanela({ hoje: '2026-12-04', feriados, ocupacao })).toEqual({
      dia: '2026-12-09',
      periodo: 'manha',
    });
  });
});

describe('dizerJanela', () => {
  it('diz o dia e a metade do dia no fuso local', () => {
    expect(dizerJanela(new Date('2026-10-20T12:00:00Z'), LX)).toBe(
      'terça-feira, 20 de outubro, à tarde (entre as 13h e as 17h)',
    );
    expect(dizerJanela(new Date('2026-12-07T08:00:00Z'), LX)).toBe(
      'segunda-feira, 7 de dezembro, de manhã (entre as 8h e as 12h)',
    );
  });
});
