import { numeroWhatsapp, partir } from './whatsapp.service';

describe('WhatsApp', () => {
  it('lê o número do Twilio', () => {
    expect(numeroWhatsapp('whatsapp:+351912345678')).toBe('+351912345678');
    expect(numeroWhatsapp('WhatsApp:912345678')).toBe('+351912345678');
    expect(numeroWhatsapp(undefined)).toBeNull();
  });

  it('parte respostas longas por parágrafos e frases, sem passar o limite', () => {
    expect(partir('Curta.')).toEqual(['Curta.']);
    const longa = Array.from(
      { length: 60 },
      (_, i) => `Frase número ${i} com algum texto.`,
    ).join(' ');
    const partes = partir(longa, 300);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(300);
    expect(partes.join(' ')).toBe(longa);
    expect(partir('A'.repeat(500), 200)[0]).toHaveLength(200);
  });
});
