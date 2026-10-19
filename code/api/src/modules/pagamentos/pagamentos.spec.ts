import {
  assinar,
  assinaturaValida,
  digitosControlo,
  ENTIDADE_TESTE,
  formatarReferencia,
  gerarReferencia,
  referenciaValida,
} from './multibanco.js';
import {
  calcularTaxas,
  eurosPorExtenso,
  formatarEuros,
  numeroPorExtenso,
  Taxa,
} from './taxas.js';

describe('por extenso', () => {
  it.each([
    [0, 'zero'],
    [1, 'um'],
    [16, 'dezasseis'],
    [21, 'vinte e um'],
    [100, 'cem'],
    [101, 'cento e um'],
    [123, 'cento e vinte e três'],
    [1000, 'mil'],
    [1100, 'mil e cem'],
    [1120, 'mil cento e vinte'],
    [1005, 'mil e cinco'],
    [2345, 'dois mil trezentos e quarenta e cinco'],
    [200000, 'duzentos mil'],
    [1_000_000, 'um milhão'],
    [2_100_000, 'dois milhões e cem mil'],
  ])('%i → %s', (n, texto) => {
    expect(numeroPorExtenso(n)).toBe(texto);
  });

  it.each([
    [12340, 'cento e vinte e três euros e quarenta cêntimos'],
    [100, 'um euro'],
    [1, 'um cêntimo'],
    [40, 'quarenta cêntimos'],
    [0, 'zero euros'],
    [100_000_000, 'um milhão de euros'],
    [150050, 'mil e quinhentos euros e cinquenta cêntimos'],
  ])('%i cêntimos → %s', (cent, texto) => {
    expect(eurosPorExtenso(cent)).toBe(texto);
  });

  it('formata euros para escrever', () => {
    expect(formatarEuros(12340)).toBe('123,40 €');
    expect(formatarEuros(123456705)).toBe('1 234 567,05 €');
  });
});

describe('calcularTaxas', () => {
  const tabela: Taxa[] = [
    {
      codigo: 'AP',
      descricao: 'Apreciação do pedido',
      unidade: 'fixo',
      valor_cent: 5000,
      tipo_processo_id: 'cp',
    },
    {
      codigo: 'OB',
      descricao: 'Obra, por m²',
      unidade: 'm2',
      valor_cent: 250,
      tipo_processo_id: 'cp',
    },
    {
      codigo: 'OVP',
      descricao: 'Ocupação da via pública, por dia',
      unidade: 'dia',
      valor_cent: 320,
      tipo_processo_id: null,
    },
  ];

  it('soma as taxas do tipo de processo com as quantidades por unidade', () => {
    const r = calcularTaxas(tabela, {
      tipoProcessoId: 'cp',
      quantidades: { m2: 12.5 },
    });
    expect(r.em_falta).toEqual([]);
    expect(r.linhas.map((l) => [l.codigo, l.valor_cent])).toEqual([
      ['AP', 5000],
      ['OB', 3125],
    ]);
    expect(r.total_cent).toBe(8125);
  });

  it('diz o que perguntar quando falta a quantidade', () => {
    const r = calcularTaxas(tabela, { tipoProcessoId: 'cp' });
    expect(r.total_cent).toBe(5000);
    expect(r.em_falta).toEqual([
      expect.objectContaining({
        codigo: 'OB',
        pergunta: 'Quantos metros quadrados?',
      }),
    ]);
  });

  it('aceita códigos soltos e assinala os desconhecidos', () => {
    const r = calcularTaxas(tabela, {
      taxas: [{ codigo: 'ovp', quantidade: 3 }, { codigo: 'XX' }],
    });
    expect(r.linhas).toEqual([
      expect.objectContaining({
        codigo: 'OVP',
        quantidade: 3,
        valor_cent: 960,
      }),
    ]);
    expect(r.desconhecidas).toEqual(['XX']);
  });
});

describe('referências MB de teste', () => {
  it('gera 9 dígitos que se validam com o mesmo valor', () => {
    const ref = gerarReferencia(12340);
    expect(ref).toMatch(/^\d{9}$/);
    expect(referenciaValida(ENTIDADE_TESTE, ref, 12340)).toBe(true);
    expect(referenciaValida(ENTIDADE_TESTE, ref, 12341)).toBe(false);
  });

  it('é determinística para a mesma base', () => {
    const controlo = digitosControlo(ENTIDADE_TESTE, '0001234', 12340);
    expect(gerarReferencia(12340, ENTIDADE_TESTE, '0001234')).toBe(
      `0001234${controlo}`,
    );
  });

  it('formata como no talão', () => {
    expect(formatarReferencia('123456789')).toBe('123 456 789');
  });
});

describe('assinatura do webhook', () => {
  const corpo = Buffer.from('{"mb_referencia":"123456789","valor_cent":100}');

  it('aceita a assinatura certa e recusa as outras', () => {
    expect(assinaturaValida(corpo, assinar(corpo, 's3gredo'), 's3gredo')).toBe(
      true,
    );
    expect(assinaturaValida(corpo, assinar(corpo, 'outro'), 's3gredo')).toBe(
      false,
    );
    expect(assinaturaValida(corpo, undefined, 's3gredo')).toBe(false);
    expect(assinaturaValida(corpo, 'sha256=xyz', 's3gredo')).toBe(false);
  });
});
