import {
  diasDaChave,
  estaAberto,
  HORARIO_POR_OMISSAO,
  horarioPorExtenso,
  horarioSimples,
  instanteLocal,
  lerHorario,
  lerIntervalos,
  partesLocais,
  prazoResposta,
  proximaAbertura,
  quandoPorExtenso,
} from './horario.js';

const FUSO = 'Europe/Lisbon';
// 5 out., 1 nov. e 8 dez. (nacionais)
const feriados = new Set(['2026-10-05', '2026-11-01', '2026-12-08']);
const balcao = lerHorario({ 'seg-sex': '9:00-12:30,14:00-17:00' })!;

describe('lerHorario', () => {
  it('chaves de dias, intervalos, listas e nomes com acento', () => {
    expect(diasDaChave('seg-sex')).toEqual([1, 2, 3, 4, 5]);
    expect(diasDaChave('sex-seg')).toEqual([5, 6, 0, 1]);
    expect(diasDaChave('Sáb,dom')).toEqual([6, 0]);
    expect(diasDaChave('terça-feira')).toEqual([]); // '-' depois de 'terça' não é dia
    expect(diasDaChave('terça')).toEqual([2]);
    expect(diasDaChave('feriados')).toEqual([]);
  });

  it('intervalos em vários formatos', () => {
    expect(lerIntervalos('9:00-16:00')).toEqual([[540, 960]]);
    expect(lerIntervalos('09h30 - 12h, 14h-17h30')).toEqual([
      [570, 720],
      [840, 1050],
    ]);
    expect(lerIntervalos(['9:00-12:00', '14:00-17:00'])).toEqual([
      [540, 720],
      [840, 1020],
    ]);
    expect(lerIntervalos('fechado')).toEqual([]);
    expect(lerIntervalos(false)).toEqual([]);
    expect(lerIntervalos('25:00-26:00')).toEqual([]);
    expect(lerIntervalos(42)).toBeNull();
  });

  it('sempre', () => {
    expect(lerHorario({ sempre: true })?.sempre).toBe(true);
  });

  it('um dia sozinho sobrepõe-se ao intervalo de dias', () => {
    const h = lerHorario({ qua: '9:00-19:00', 'seg-sex': '9:00-16:00' })!;
    expect(h.semana[3]).toEqual([[540, 1140]]);
    expect(h.semana[2]).toEqual([[540, 960]]);
    expect(h.semana[0]).toEqual([]);
  });

  it('atravessa a meia-noite', () => {
    const h = lerHorario({ sex: '20:00-02:00' })!;
    expect(h.semana[5]).toEqual([[1200, 1440]]);
    expect(h.semana[6]).toEqual([[0, 120]]);
  });

  it('vazio, estranho ou tudo fechado → null (usa-se o por omissão)', () => {
    expect(lerHorario(null)).toBeNull();
    expect(lerHorario({})).toBeNull();
    expect(lerHorario('9-17')).toBeNull();
    expect(lerHorario({ 'seg-dom': 'fechado' })).toBeNull();
    expect(lerHorario({ sempre: false })).toBeNull();
  });

  it('por omissão: seg-sex 9h-17h', () => {
    expect(HORARIO_POR_OMISSAO.semana[1]).toEqual([[540, 1020]]);
    expect(HORARIO_POR_OMISSAO.semana[6]).toEqual([]);
  });
});

describe('fuso', () => {
  it('hora local de Lisboa no verão e no inverno', () => {
    // 20 out. 2026 (verão, UTC+1), 8:59 UTC = 9:59 em Lisboa
    expect(partesLocais(new Date('2026-10-20T08:59:00Z'), FUSO)).toEqual({
      dia: '2026-10-20',
      semana: 2,
      minutos: 599,
    });
    // 15 dez. (inverno, UTC+0)
    expect(partesLocais(new Date('2026-12-15T23:30:00Z'), FUSO).minutos).toBe(
      1410,
    );
  });

  it('instante local acerta a hora de verão', () => {
    expect(instanteLocal('2026-10-20', 540, FUSO).toISOString()).toBe(
      '2026-10-20T08:00:00.000Z',
    );
    // Depois da mudança da hora (25 out. 2026)
    expect(instanteLocal('2026-10-26', 540, FUSO).toISOString()).toBe(
      '2026-10-26T09:00:00.000Z',
    );
    expect(instanteLocal('2026-03-30', 720, FUSO).toISOString()).toBe(
      '2026-03-30T11:00:00.000Z',
    );
  });
});

describe('estaAberto', () => {
  const em = (iso: string) => estaAberto(balcao, new Date(iso), FUSO, feriados);

  it('fronteiras: abre à hora certa, fecha no minuto do fecho', () => {
    expect(em('2026-10-20T07:59:00Z')).toBe(false); // 8:59
    expect(em('2026-10-20T08:00:00Z')).toBe(true); // 9:00
    expect(em('2026-10-20T11:29:00Z')).toBe(true); // 12:29
    expect(em('2026-10-20T11:30:00Z')).toBe(false); // 12:30, almoço
    expect(em('2026-10-20T13:00:00Z')).toBe(true); // 14:00
    expect(em('2026-10-20T15:59:00Z')).toBe(true); // 16:59
    expect(em('2026-10-20T16:00:00Z')).toBe(false); // 17:00
  });

  it('fim de semana e feriado fechados', () => {
    expect(em('2026-10-24T10:00:00Z')).toBe(false); // sábado
    expect(em('2026-10-05T10:00:00Z')).toBe(false); // segunda, feriado
  });

  it('sempre aberto, mesmo em feriado', () => {
    const h = lerHorario({ sempre: true })!;
    expect(
      estaAberto(h, new Date('2026-11-01T03:00:00Z'), FUSO, feriados),
    ).toBe(true);
  });

  it('a hora conta no fuso do município, não em UTC', () => {
    // 23:30 UTC de segunda 19 out. = 0:30 de terça em Lisboa: fechado
    expect(em('2026-10-19T23:30:00Z')).toBe(false);
    // 16:30 UTC = 17:30 em Lisboa: fechado; 16:30 em UTC estaria aberto
    expect(em('2026-10-20T16:30:00Z')).toBe(false);
  });
});

describe('proximaAbertura', () => {
  const prox = (iso: string, h = balcao) =>
    proximaAbertura(h, new Date(iso), FUSO, feriados).toISOString();

  it('aberto agora → o próprio instante', () => {
    expect(prox('2026-10-20T09:15:00Z')).toBe('2026-10-20T09:15:00.000Z');
  });

  it('antes de abrir → hoje à abertura', () => {
    expect(prox('2026-10-20T06:00:00Z')).toBe('2026-10-20T08:00:00.000Z');
  });

  it('à hora de almoço → hoje à tarde', () => {
    expect(prox('2026-10-20T12:00:00Z')).toBe('2026-10-20T13:00:00.000Z');
  });

  it('depois de fechar → amanhã de manhã', () => {
    expect(prox('2026-10-20T16:00:00Z')).toBe('2026-10-21T08:00:00.000Z');
  });

  it('sexta à noite → segunda (já em hora de inverno)', () => {
    expect(prox('2026-10-23T19:00:00Z')).toBe('2026-10-26T09:00:00.000Z');
  });

  it('salta feriados', () => {
    // sexta 2 out. à noite → (seg 5 feriado) → terça 6
    expect(prox('2026-10-02T19:00:00Z')).toBe('2026-10-06T08:00:00.000Z');
    // sábado 31 out. → domingo 1 nov. feriado e fim de semana → segunda 2
    expect(prox('2026-10-31T10:00:00Z')).toBe('2026-11-02T09:00:00.000Z');
  });

  it('horário com sábado de manhã', () => {
    const h = lerHorario({ 'seg-sex': '9:00-17:00', sab: '9:00-12:00' })!;
    expect(prox('2026-10-23T19:00:00Z', h)).toBe('2026-10-24T08:00:00.000Z');
  });
});

describe('prazoResposta', () => {
  const prazo = (iso: string) =>
    prazoResposta(
      proximaAbertura(balcao, new Date(iso), FUSO, feriados),
      FUSO,
      feriados,
    ).toISOString();

  it('em horário: dia útil seguinte às 12h', () => {
    // terça 20 out. 10h → quarta 21 às 12h (UTC+1)
    expect(prazo('2026-10-20T09:00:00Z')).toBe('2026-10-21T11:00:00.000Z');
  });

  it('sexta à noite: abre segunda, resposta terça às 12h', () => {
    expect(prazo('2026-10-23T19:00:00Z')).toBe('2026-10-27T12:00:00.000Z');
  });

  it('salta feriado no dia útil seguinte', () => {
    // segunda 7 dez. 10h → (terça 8 feriado) → quarta 9 às 12h
    expect(prazo('2026-12-07T10:00:00Z')).toBe('2026-12-09T12:00:00.000Z');
  });
});

describe('por extenso', () => {
  const agora = new Date('2026-10-20T09:00:00Z'); // terça

  it('hoje, amanhã, dia da semana e data', () => {
    expect(
      quandoPorExtenso(new Date('2026-10-20T14:00:00Z'), agora, FUSO),
    ).toBe('hoje às 15h');
    expect(
      quandoPorExtenso(new Date('2026-10-21T11:00:00Z'), agora, FUSO),
    ).toBe('amanhã às 12h');
    expect(
      quandoPorExtenso(new Date('2026-10-23T08:30:00Z'), agora, FUSO),
    ).toBe('sexta-feira às 9h30');
    expect(
      quandoPorExtenso(new Date('2026-11-03T12:00:00Z'), agora, FUSO),
    ).toBe('dia 3 de novembro às 12h');
  });

  it('horário em texto', () => {
    expect(horarioPorExtenso({ sempre: true })).toBe('24 horas, todos os dias');
    expect(
      horarioPorExtenso({ 'seg-sex': '9:00-12:30,14:00-17:00', dom: false }),
    ).toBe('seg-sex 9:00-12:30 e 14:00-17:00; dom fechado');
    expect(horarioPorExtenso(null)).toBeNull();
  });
});

describe('horarioSimples', () => {
  it('dias da semana (segunda primeiro) com intervalos HH:MM', () => {
    const h = horarioSimples(
      lerHorario({ 'seg-sex': '9:00-12:30,14:00-17:00', sab: '9h-12h' })!,
    );
    expect(Object.keys(h.dias)).toEqual([
      'seg',
      'ter',
      'qua',
      'qui',
      'sex',
      'sab',
      'dom',
    ]);
    expect(h).toMatchObject({
      sempre: false,
      dias: {
        seg: [
          ['09:00', '12:30'],
          ['14:00', '17:00'],
        ],
        sab: [['09:00', '12:00']],
        dom: [],
      },
    });
  });

  it('por omissão: dias úteis 9h-17h; sempre aberto vem com dias vazios', () => {
    expect(horarioSimples(HORARIO_POR_OMISSAO).dias.qua).toEqual([
      ['09:00', '17:00'],
    ]);
    const sempre = horarioSimples(lerHorario({ sempre: true })!);
    expect(sempre.sempre).toBe(true);
    expect(sempre.dias.seg).toEqual([]);
    // Até à meia-noite fica 24:00.
    expect(
      horarioSimples(lerHorario({ sex: '20:00-02:00' })!).dias,
    ).toMatchObject({ sex: [['20:00', '24:00']], sab: [['00:00', '02:00']] });
  });
});
