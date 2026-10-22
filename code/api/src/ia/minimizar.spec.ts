import { minimizar } from './minimizar.js';

describe('minimizar', () => {
  it('troca email, telefone, NIF válido, IBAN e cartão por etiquetas', () => {
    const t = minimizar(
      'Sou a Ana (ana.silva@gmail.com, 912 345 678, NIF 123456789). ' +
        'IBAN PT50 0002 0123 1234 5678 9015 4, cartão 4111 1111 1111 1111.',
    );
    expect(t).toBe(
      'Sou a Ana ([email], [telefone], NIF [nif]). IBAN [iban], cartão [cartão].',
    );
  });

  it('telefones com indicativo e fixos', () => {
    expect(minimizar('Ligue +351 253 421 200 ou 00351912345678')).toBe(
      'Ligue [telefone] ou [telefone]',
    );
  });

  it('não mexe em números que não são dados pessoais', () => {
    const t =
      'A taxa é 64,70 €, o processo CP 2/2026, a área 120 m², o prazo 30 dias.';
    expect(minimizar(t)).toBe(t);
  });

  it('um número de 9 algarismos que não é NIF válido fica', () => {
    expect(minimizar('Referência 123456780')).toBe('Referência 123456780');
  });
});
