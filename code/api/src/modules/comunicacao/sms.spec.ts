import { infoSms, transliterar } from './sms.js';

describe('infoSms', () => {
  it('texto simples cabe em GSM-7 (160 por parte)', () => {
    expect(infoSms('Ola, o seu pedido foi registado.')).toMatchObject({
      codificacao: 'gsm7',
      segmentos: 1,
    });
    expect(infoSms('a'.repeat(161)).segmentos).toBe(2);
  });

  it('um acento passa tudo a UCS-2 (70 por parte)', () => {
    const r = infoSms('Câmara' + 'a'.repeat(70));
    expect(r.codificacao).toBe('ucs2');
    expect(r.segmentos).toBe(2);
  });

  it('é e Ç existem em GSM-7', () => {
    expect(infoSms('Café Ç').codificacao).toBe('gsm7');
  });

  it('€ conta como 2', () => {
    expect(infoSms('€').caracteres).toBe(2);
  });
});

describe('transliterar', () => {
  it('tira os acentos que não existem em GSM-7', () => {
    const t = transliterar('Câmara de Guimarães – licença nº 3');
    expect(t).toBe('Camara de Guimaraes - licenca no 3');
    expect(infoSms(t).codificacao).toBe('gsm7');
  });
});
