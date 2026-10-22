import { EQUIPAMENTOS_DEMO } from './demonstracao.js';
import {
  avaliarBilhetes,
  avaliarReserva,
  escolher,
  estadoDepoisDeAprovar,
  estadoInicial,
  faixasLivres,
  horasLivres,
  minutosReserva,
  normalizarHora,
  podeCancelar,
  precoReserva,
} from './regras.js';

const LISBOA = 'Europe/Lisbon';
const pavilhao = EQUIPAMENTOS_DEMO.find((e) => e.chave === 'pavilhao')!;
const lista = EQUIPAMENTOS_DEMO.map((e) => ({ ...e }));
// Quinta-feira, 22 de outubro de 2026, 10h em Lisboa.
const AGORA = new Date('2026-10-22T09:00:00Z');
const SABADO = '2026-10-31';

describe('reservas · regras', () => {
  it('escolhe o equipamento pelo que a pessoa diz', () => {
    const um = escolher(lista, 'o pavilhão para um jogo de futsal');
    expect(um).toMatchObject({ tipo: 'um', item: { chave: 'pavilhao' } });
    expect(escolher(lista, 'piscinas municipais')).toMatchObject({
      item: { chave: 'piscina' },
    });
    expect(escolher(lista, 'campo de futebol')).toMatchObject({
      item: { chave: 'campo_sintetico' },
    });
    expect(escolher(lista, 'estádio olímpico de Berlim')).toEqual({
      tipo: 'nenhum',
    });
    expect(escolher(lista, undefined).tipo).toBe('varios');
  });

  it('horas: aceita "9h", "18:30", "21"; recusa o resto', () => {
    expect(normalizarHora('9h')).toBe('09:00');
    expect(normalizarHora('18:30')).toBe('18:30');
    expect(normalizarHora('21')).toBe('21:00');
    expect(normalizarHora('25:00')).toBeNull();
    expect(normalizarHora('tarde')).toBeNull();
  });

  it('duração arredonda ao slot e o preço é proporcional', () => {
    expect(minutosReserva(1.5, 60)).toBe(120);
    expect(minutosReserva(1, 30)).toBe(60);
    expect(precoReserva(2500, 120)).toBe(5000);
    expect(precoReserva(1500, 90)).toBe(2250);
  });

  const base = {
    fuso: LISBOA,
    feriados: new Set<string>(),
    agora: AGORA,
    ocupados: [],
  };

  it('dentro do horário e livre: aceita, com o preço', () => {
    const r = avaliarReserva(pavilhao, {
      ...base,
      dia: SABADO,
      hora_inicio: '10:00',
      duracao_horas: 2,
    });
    expect(r).toMatchObject({ ok: true, minutos: 120, valor_cent: 5000 });
  });

  it('recusa: fora do horário, demasiado longa, feriado, em cima da hora, ocupado', () => {
    const p = { ...base, dia: SABADO, duracao_horas: 1 };
    expect(
      avaliarReserva(pavilhao, { ...p, hora_inicio: '07:00' }),
    ).toMatchObject({ motivo: 'fora_do_horario' });
    expect(
      avaliarReserva(pavilhao, { ...p, hora_inicio: '19:30' }),
    ).toMatchObject({ motivo: 'fora_do_horario' });
    expect(
      avaliarReserva(pavilhao, {
        ...p,
        hora_inicio: '10:00',
        duracao_horas: 4,
      }),
    ).toMatchObject({ motivo: 'duracao' });
    expect(
      avaliarReserva(pavilhao, {
        ...p,
        hora_inicio: '10:00',
        feriados: new Set([SABADO]),
      }),
    ).toMatchObject({ motivo: 'fechado' });
    // Hoje às 20h: menos de 24 horas de antecedência.
    expect(
      avaliarReserva(pavilhao, {
        ...p,
        dia: '2026-10-22',
        hora_inicio: '20:00',
      }),
    ).toMatchObject({ motivo: 'em_cima_da_hora' });
    const ocupado = {
      inicio: new Date('2026-10-31T11:00:00Z'), // 11h em Lisboa (já hora de inverno)
      fim: new Date('2026-10-31T12:00:00Z'),
    };
    expect(
      avaliarReserva(pavilhao, {
        ...p,
        hora_inicio: '10:00',
        duracao_horas: 2,
        ocupados: [ocupado],
      }),
    ).toMatchObject({ motivo: 'ocupado' });
  });

  it('horas livres de um dia, sem as ocupadas, e ditas em faixas', () => {
    const ocupado = {
      inicio: new Date('2026-10-31T11:00:00Z'),
      fim: new Date('2026-10-31T12:00:00Z'),
    };
    const horas = horasLivres(pavilhao, SABADO, {
      ...base,
      ocupados: [ocupado],
    });
    expect(horas[0]).toBe('09:00');
    expect(horas).not.toContain('11:00');
    expect(horas).toHaveLength(10);
    expect(faixasLivres(['09:00', '10:00', '12:00', '13:00'], 60)).toBe(
      'das 9h às 11h, das 12h às 14h',
    );
  });

  it('estado: aprovação de funcionário, pagamento ou confirmada', () => {
    expect(estadoInicial('funcionario', 0)).toBe('por_aprovar');
    expect(estadoInicial('automatica', 2500)).toBe('por_pagar');
    expect(estadoInicial('automatica', 0)).toBe('confirmada');
    expect(estadoDepoisDeAprovar(4000)).toBe('por_pagar');
    expect(estadoDepoisDeAprovar(0)).toBe('confirmada');
  });

  it('cancelar: antes de começar; devolução só com 24 horas', () => {
    const inicio = new Date('2026-10-31T10:00:00Z');
    expect(podeCancelar('confirmada', inicio, AGORA, true)).toMatchObject({
      pode: true,
      devolucao: true,
    });
    expect(
      podeCancelar(
        'confirmada',
        inicio,
        new Date('2026-10-31T00:00:00Z'),
        true,
      ),
    ).toMatchObject({ pode: true, devolucao: false });
    expect(podeCancelar('cancelada', inicio, AGORA, false).pode).toBe(false);
    expect(
      podeCancelar(
        'confirmada',
        inicio,
        new Date('2026-10-31T11:00:00Z'),
        false,
      ).pode,
    ).toBe(false);
  });

  it('bilhetes: lugares limitados e máximo por pessoa', () => {
    expect(avaliarBilhetes(25, 20, 4, 4)).toEqual({ ok: true, livres: 5 });
    expect(avaliarBilhetes(25, 23, 4, 4)).toMatchObject({
      ok: false,
      livres: 2,
      texto: 'Só há 2 lugares.',
    });
    expect(avaliarBilhetes(25, 25, 1, 4)).toMatchObject({
      ok: false,
      texto: 'Está esgotado.',
    });
    expect(avaliarBilhetes(25, 0, 5, 4)).toMatchObject({
      ok: false,
      texto: 'No máximo 4 bilhetes por pessoa.',
    });
  });
});
