import {
  estadoPedido,
  mascararTelemovel,
  segundosRestantes,
  telemovelMbway,
} from './mbway.js';

describe('telemóvel do MB WAY', () => {
  it.each([
    ['912345678', '+351912345678'],
    ['+351 912 345 678', '+351912345678'],
    ['00351961234567', '+351961234567'],
    ['931234567', '+351931234567'],
    [' 92 123 4567 ', '+351921234567'],
  ])('%s → %s', (tel, e164) => {
    expect(telemovelMbway(tel)).toBe(e164);
  });

  it.each([
    ['253123456'], // fixo
    ['+34612345678'], // móvel espanhol
    ['9123'],
    ['abc'],
    [''],
    [null],
    [undefined],
  ])('%s → null', (tel) => {
    expect(telemovelMbway(tel)).toBeNull();
  });

  it('mascara sem mostrar o número inteiro', () => {
    expect(mascararTelemovel('+351912345214')).toBe('9•• ••• 214');
  });
});

describe('estado do pedido MB WAY', () => {
  const agora = new Date('2026-10-26T10:00:00Z');
  const daqui = (s: number) => new Date(agora.getTime() + s * 1000);

  it('pendente dentro da validade está por aceitar', () => {
    expect(estadoPedido('pendente', daqui(60), agora)).toBe('por_aceitar');
  });

  it('pendente fora da validade já está expirado', () => {
    expect(estadoPedido('pendente', daqui(0), agora)).toBe('expirado');
    expect(estadoPedido('pendente', daqui(-1), agora)).toBe('expirado');
  });

  it('os fechados ficam como estão', () => {
    expect(estadoPedido('pago', daqui(-600), agora)).toBe('pago');
    expect(estadoPedido('cancelado', daqui(60), agora)).toBe('cancelado');
    expect(estadoPedido('expirado', daqui(60), agora)).toBe('expirado');
  });

  it('contagem decrescente em segundos, nunca negativa', () => {
    expect(segundosRestantes(daqui(300), agora)).toBe(300);
    expect(segundosRestantes(daqui(0.2), agora)).toBe(1);
    expect(segundosRestantes(daqui(-5), agora)).toBe(0);
  });
});
