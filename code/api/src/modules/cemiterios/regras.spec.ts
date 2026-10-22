import {
  estadoConcessao,
  fraseConcessao,
  horarioDito,
  lerReferencia,
  localDito,
  mascararNome,
  taxasDe,
  TAXAS_DEMONSTRACAO,
} from './regras.js';

describe('cemitérios · regras', () => {
  const hoje = '2026-10-22';

  it('estado da concessão: perpétua, válida, a terminar (≤ 180 dias) e terminada', () => {
    expect(
      estadoConcessao({ concessao: 'perpetua', concessao_fim: null }, hoje),
    ).toBe('perpetua');
    expect(
      estadoConcessao(
        { concessao: 'temporaria', concessao_fim: '2028-01-01' },
        hoje,
      ),
    ).toBe('valida');
    expect(
      estadoConcessao(
        { concessao: 'temporaria', concessao_fim: '2027-01-20' },
        hoje,
      ),
    ).toBe('a_terminar');
    expect(
      estadoConcessao(
        { concessao: 'temporaria', concessao_fim: '2026-10-21' },
        hoje,
      ),
    ).toBe('terminada');
  });

  it('frase da concessão com a validade e as taxas de conservação por pagar', () => {
    expect(
      fraseConcessao(
        {
          concessao: 'temporaria',
          concessao_fim: '2027-01-20',
          conservacao_divida_cent: 4500,
          conservacao_divida_desde: 2023,
        },
        hoje,
      ),
    ).toBe(
      'A concessão termina a 20 de janeiro de 2027: está na altura de pedir a renovação. Há taxas de conservação por pagar: 45 €, desde 2023.',
    );
    expect(
      fraseConcessao(
        {
          concessao: 'perpetua',
          concessao_fim: null,
          conservacao_divida_cent: 0,
          conservacao_divida_desde: null,
        },
        hoje,
      ),
    ).toBe('A concessão é perpétua. Não há taxas de conservação por pagar.');
  });

  it('o titular vai abreviado ao telefone', () => {
    expect(mascararNome('Maria Exemplo Fernandes')).toBe('Maria F.');
    expect(mascararNome('Maria')).toBe('Maria');
    expect(mascararNome(null)).toBeNull();
  });

  it('lê talhão e número do que a pessoa diz', () => {
    expect(lerReferencia('talhão 3, número 120')).toEqual({
      talhao: '3',
      numero: '120',
    });
    expect(lerReferencia('O jazigo 12 do talhao b')).toEqual({
      talhao: 'B',
      numero: '12',
    });
    expect(lerReferencia('Joaquim Fernandes')).toEqual({
      talhao: null,
      numero: null,
    });
  });

  it('local e horário ditos', () => {
    expect(
      localDito({
        cemiterio: 'Cemitério X',
        tipo: 'gavetao',
        talhao: 'A',
        numero: '7',
      }),
    ).toBe('Cemitério X, talhão A, gavetão número 7');
    expect(horarioDito({ 'seg-dom': '08:00-18:00' })).toBe(
      'de segunda a domingo, das 8:00 às 18:00',
    );
    expect(horarioDito({ 'seg-sab': '08:30-17:30', dom: '09:00-13:00' })).toBe(
      'de segunda a sábado, das 8:30 às 17:30; domingo, das 9:00 às 13:00',
    );
  });

  it('as taxas são todas de demonstração e filtram por serviço', () => {
    expect(TAXAS_DEMONSTRACAO.length).toBeGreaterThan(5);
    expect(taxasDe('exumacao').map((t) => t.servico)).toEqual(['exumacao']);
    expect(taxasDe().length).toBe(TAXAS_DEMONSTRACAO.length);
  });
});
