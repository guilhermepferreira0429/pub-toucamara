import { infoSms } from '../comunicacao/sms.js';
import {
  escolherTema,
  formatarTranscricao,
  MAX_SMS_FIM,
  montarSmsFimChamada,
  smsSemResumo,
  turnoMaisProximo,
} from './resumo.js';

describe('escolherTema', () => {
  const temas = [
    { id: 't1', nome: 'Obras dentro de casa' },
    { id: 't2', nome: 'Água e saneamento' },
  ];

  it('reconhece um tema existente sem olhar a maiúsculas nem acentos', () => {
    expect(escolherTema('obras dentro de casa.', temas)).toEqual({ id: 't1' });
    expect(escolherTema('Agua e Saneamento', temas)).toEqual({ id: 't2' });
  });

  it('propõe um tema novo arrumado', () => {
    expect(escolherTema('  recolha de   monos ', temas)).toEqual({
      novo: 'Recolha de monos',
    });
    expect(escolherTema('   ', temas)).toBeNull();
  });
});

describe('turnoMaisProximo', () => {
  const turnos = [
    { id: 'a', ordem: 1, papel: 'agente' },
    { id: 'b', ordem: 2, papel: 'municipe' },
    { id: 'c', ordem: 3, papel: 'agente' },
    { id: 'd', ordem: 6, papel: 'municipe' },
  ];

  it('usa o turno indicado se for do munícipe, senão o mais próximo', () => {
    expect(turnoMaisProximo(2, turnos)).toBe('b');
    expect(turnoMaisProximo(3, turnos)).toBe('b');
    expect(turnoMaisProximo(5, turnos)).toBe('d');
    expect(turnoMaisProximo(99, turnos)).toBe('d');
  });

  it('sem turnos do munícipe → null', () => {
    expect(turnoMaisProximo(1, [turnos[0]])).toBeNull();
  });
});

describe('montarSmsFimChamada', () => {
  const url = 'https://toucamara.pt/r/8K2F9Q';

  it('junta o texto e o link', () => {
    expect(montarSmsFimChamada('Ficou o requerimento.', url)).toBe(
      `Ficou o requerimento. ${url}`,
    );
  });

  it('corta textos longos numa palavra e nunca passa do máximo', () => {
    const longo =
      'Pedido de comunicação prévia preenchido; falta assinar. '.repeat(10);
    const sms = montarSmsFimChamada(longo, url);
    expect(sms.length).toBeLessThanOrEqual(MAX_SMS_FIM);
    expect(sms.endsWith(`… ${url}`)).toBe(true);
    expect(infoSms(sms).segmentos).toBeLessThanOrEqual(3);
  });

  it('o texto sem resumo cabe com o link', () => {
    const sms = montarSmsFimChamada(smsSemResumo('Concelho'), url);
    expect(sms).toContain(url);
    expect(sms.length).toBeLessThanOrEqual(MAX_SMS_FIM);
  });
});

describe('formatarTranscricao', () => {
  it('numera cada turno para o modelo os poder indicar', () => {
    expect(
      formatarTranscricao([
        { ordem: 1, papel: 'agente', texto: 'Olá' },
        { ordem: 2, papel: 'municipe', texto: 'Bom dia' },
      ]),
    ).toBe('[1] Agente: Olá\n[2] Munícipe: Bom dia');
  });
});
