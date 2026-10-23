import { anonimizar, nomesATapar } from './avaliacao.service.js';

describe('anonimizar (página pública da avaliação)', () => {
  const nomes = [...nomesATapar('Bia · Teste'), 'acmeAI', 'Acme Lab'];

  it('tapa o nome da assistente, com maiúscula inicial, em qualquer caixa no resto', () => {
    expect(anonimizar('Olá, sou a Bia! A BIA ajuda.', nomes)).toBe(
      'Olá, sou a [nome]! A [nome] ajuda.',
    );
  });

  it('não tapa a palavra comum nem o nome de um santo ou de um sítio', () => {
    expect(anonimizar('Uma resposta bia e curta.', nomes)).toBe(
      'Uma resposta bia e curta.',
    );
    expect(anonimizar('Fica junto ao Convento de Santa Bia.', nomes)).toBe(
      'Fica junto ao Convento de Santa Bia.',
    );
  });

  it('só palavras inteiras', () => {
    expect(anonimizar('Fale com a Bianca.', nomes)).toBe('Fale com a Bianca.');
  });

  it('tapa as marcas em qualquer caixa', () => {
    expect(anonimizar('Feito pela ACMEai e pela acme lab.', nomes)).toBe(
      'Feito pela [nome] e pela [nome].',
    );
  });

  it('null fica null', () => {
    expect(anonimizar(null, nomes)).toBeNull();
  });
});
