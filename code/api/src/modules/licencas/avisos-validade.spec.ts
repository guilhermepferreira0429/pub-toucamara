import {
  avisoDevido,
  diasDeAviso,
  inicioDaSemana,
  LicencaComValidade,
  porSemana,
  proximoAviso,
} from './avisos-validade';

const C = { aviso_1_dias: 30, aviso_2_dias: 7, aviso_por_chamada: false };

const lic = (p: Partial<LicencaComValidade> = {}): LicencaComValidade => ({
  id: 'l1',
  valida_ate: '2026-12-31',
  emitida_em: '2026-01-01',
  renovada: false,
  avisos_enviados: [],
  ...p,
});

describe('avisoDevido', () => {
  it('antes da janela não avisa; a 30 dias avisa o de 30; a 7 dias o de 7', () => {
    expect(avisoDevido(lic(), C, '2026-11-30')).toBeNull();
    expect(avisoDevido(lic(), C, '2026-12-01')).toEqual({
      dias: 30,
      faltam: 30,
    });
    expect(
      avisoDevido(lic({ avisos_enviados: [30] }), C, '2026-12-20'),
    ).toBeNull();
    expect(
      avisoDevido(lic({ avisos_enviados: [30] }), C, '2026-12-24'),
    ).toEqual({ dias: 7, faltam: 7 });
  });

  it('não duplica: o aviso que já foi não volta, nem com o job a correr de novo', () => {
    expect(
      avisoDevido(lic({ avisos_enviados: [30] }), C, '2026-12-05'),
    ).toBeNull();
    expect(
      avisoDevido(lic({ avisos_enviados: [30, 7] }), C, '2026-12-28'),
    ).toBeNull();
  });

  it('se o job falhou dias, vai só o mais próximo do fim (o de 30 já não vai)', () => {
    expect(avisoDevido(lic(), C, '2026-12-27')).toEqual({ dias: 7, faltam: 4 });
  });

  it('renovada, expirada ou sem avisos configurados: não avisa', () => {
    expect(avisoDevido(lic({ renovada: true }), C, '2026-12-01')).toBeNull();
    expect(avisoDevido(lic(), C, '2027-01-01')).toBeNull();
    expect(
      avisoDevido(
        lic(),
        { ...C, aviso_1_dias: 0, aviso_2_dias: 0 },
        '2026-12-25',
      ),
    ).toBeNull();
    // No último dia ainda avisa.
    expect(avisoDevido(lic(), C, '2026-12-31')).toEqual({ dias: 7, faltam: 0 });
  });

  it('emitida já dentro da janela: esse aviso não vai, o seguinte sim', () => {
    // Licença de 20 dias: o aviso dos 30 nunca faz sentido.
    const curta = lic({ emitida_em: '2026-12-11' });
    expect(avisoDevido(curta, C, '2026-12-12')).toBeNull();
    expect(avisoDevido(curta, C, '2026-12-24')).toEqual({ dias: 7, faltam: 7 });
  });
});

describe('proximoAviso e semanas', () => {
  it('diz quando vai o próximo aviso', () => {
    expect(proximoAviso(lic(), C, '2026-11-15')).toEqual({
      dias: 30,
      em: '2026-12-01',
    });
    expect(
      proximoAviso(lic({ avisos_enviados: [30] }), C, '2026-12-02'),
    ).toEqual({ dias: 7, em: '2026-12-24' });
    expect(proximoAviso(lic(), C, '2026-12-01')).toEqual({
      dias: 30,
      em: '2026-12-01',
    });
    expect(
      proximoAviso(lic({ avisos_enviados: [30, 7] }), C, '2026-12-26'),
    ).toBeNull();
    expect(proximoAviso(lic({ renovada: true }), C, '2026-11-15')).toBeNull();
  });

  it('dias de aviso: sem zeros nem repetidos, do mais cedo ao mais tarde', () => {
    expect(diasDeAviso(C)).toEqual([30, 7]);
    expect(diasDeAviso({ ...C, aviso_1_dias: 7 })).toEqual([7]);
    expect(diasDeAviso({ ...C, aviso_1_dias: 0, aviso_2_dias: 14 })).toEqual([
      14,
    ]);
  });

  it('agrupa por semana, de segunda a domingo', () => {
    expect(inicioDaSemana('2026-10-21')).toBe('2026-10-19'); // quarta → segunda
    expect(inicioDaSemana('2026-10-25')).toBe('2026-10-19'); // domingo
    expect(inicioDaSemana('2026-10-26')).toBe('2026-10-26');
    const s = porSemana([
      { id: 'b', valida_ate: '2026-10-27' },
      { id: 'a', valida_ate: '2026-10-21' },
      { id: 'c', valida_ate: '2026-10-25' },
    ]);
    expect(s).toEqual([
      {
        inicio: '2026-10-19',
        fim: '2026-10-25',
        licencas: [
          { id: 'a', valida_ate: '2026-10-21' },
          { id: 'c', valida_ate: '2026-10-25' },
        ],
      },
      {
        inicio: '2026-10-26',
        fim: '2026-11-01',
        licencas: [{ id: 'b', valida_ate: '2026-10-27' }],
      },
    ]);
  });
});
