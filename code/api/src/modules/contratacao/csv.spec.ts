import {
  lerContratosBase,
  lerCsv,
  lerData,
  lerPreco,
  procedimentoDe,
  separarAdjudicatario,
  tipoDe,
} from './csv';

const CABECALHO =
  'Objeto do Contrato;Tipo de Procedimento;Tipo(s) de Contrato;CPV;Entidade(s) Adjudicante(s);Entidade(s) Adjudicatária(s);Preço Contratual;Data de Celebração do Contrato';

describe('CSV do portal BASE', () => {
  it('lerCsv: aspas, aspas dobradas, separador dentro de aspas e quebras de linha', () => {
    const t = 'a;b;c\r\n"x; y";"diz ""olá""";"linha 1\nlinha 2"\n\n';
    expect(lerCsv(t)).toEqual([
      ['a', 'b', 'c'],
      ['x; y', 'diz "olá"', 'linha 1\nlinha 2'],
    ]);
  });

  it('lerCsv: deteta vírgula e tab, e tira o BOM', () => {
    expect(lerCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(lerCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it.each([
    ['12.345,67 €', 1_234_567],
    ['12 345,67 €', 1_234_567],
    ['12 345,67€', 1_234_567],
    ['12345.67', 1_234_567],
    ['12,345.67', 1_234_567],
    ['75.000', 7_500_000],
    ['19999,99', 1_999_999],
    ['5000', 500_000],
    ['0,5', 50],
    ['abc', null],
    ['', null],
  ])('lerPreco(%p) = %p', (t, v) => {
    expect(lerPreco(t)).toBe(v);
  });

  it.each([
    ['31-12-2026', '2026-12-31'],
    ['1/2/2025', '2025-02-01'],
    ['2026-03-04', '2026-03-04'],
    ['2026-03-04 10:00:00', '2026-03-04'],
    ['31-02-2026', null],
    ['ontem', null],
  ])('lerData(%p) = %p', (t, v) => {
    expect(lerData(t)).toBe(v);
  });

  it('separarAdjudicatario: NIF entre parênteses, com PT, consórcios', () => {
    expect(separarAdjudicatario('Jardins do Minho, Lda (501234560)')).toEqual({
      nif: '501234560',
      nome: 'Jardins do Minho, Lda',
    });
    expect(separarAdjudicatario('PT501234560 - Jardins do Minho')).toEqual({
      nif: '501234560',
      nome: 'Jardins do Minho',
    });
    expect(separarAdjudicatario('A (501234560) | B (503456780)').nif).toBe(
      '501234560',
    );
    expect(separarAdjudicatario('Sem número')).toEqual({
      nif: null,
      nome: 'Sem número',
    });
  });

  it('procedimentoDe e tipoDe', () => {
    expect(procedimentoDe('Ajuste Direto Regime Geral')).toBe('ajuste_direto');
    expect(procedimentoDe('Ajuste directo simplificado')).toBe(
      'ajuste_direto_simplificado',
    );
    expect(procedimentoDe('Consulta Prévia')).toBe('consulta_previa');
    expect(procedimentoDe('Concurso público')).toBe('concurso_publico');
    expect(procedimentoDe('Concurso limitado por prévia qualificação')).toBe(
      'outro',
    );
    expect(tipoDe('Aquisição de serviços', null)).toBe('servicos');
    expect(tipoDe('Aquisição de bens móveis', null)).toBe('bens');
    expect(tipoDe('Empreitadas de obras públicas', null)).toBe('empreitada');
    expect(tipoDe(null, '45233140-2')).toBe('empreitada');
    expect(tipoDe('', '79340000-9')).toBe('servicos');
    expect(tipoDe('', '30190000-7')).toBe('bens');
    expect(tipoDe('', null)).toBeNull();
  });

  it('lerContratosBase: linhas válidas e erros por linha', () => {
    const csv = [
      CABECALHO,
      'Manutenção de jardins;Ajuste Direto Regime Geral;Aquisição de serviços;"77310000-6, Serviços de plantação";Município de Teste (500000000);Jardins do Minho, Lda (501234560);"12.345,67 €";15-03-2026',
      'Material de escritório;Consulta Prévia;;30190000-7;Município;Papelaria (503456780);2.000,00 €;2026-01-10',
      'Sem NIF;Ajuste Direto;Aquisição de serviços;;Município;Empresa;100;2026-01-10',
      'NIF errado;Ajuste Direto;Aquisição de serviços;;Município;Empresa (123456780);100;2026-01-10',
      'Preço mau;Ajuste Direto;Aquisição de serviços;;Município;Empresa (501234560);muito;31-02-2026',
    ].join('\n');
    const r = lerContratosBase(csv);
    expect(r.linhas).toHaveLength(2);
    expect(r.linhas[0]).toMatchObject({
      linha: 2,
      adjudicatario_nif: '501234560',
      adjudicatario_nome: 'Jardins do Minho, Lda',
      objeto: 'Manutenção de jardins',
      cpv: '77310000-6',
      tipo: 'servicos',
      preco_contratual_cent: 1_234_567,
      data_contrato: '2026-03-15',
      procedimento: 'ajuste_direto',
      procedimento_original: 'Ajuste Direto Regime Geral',
    });
    expect(r.linhas[1]).toMatchObject({
      tipo: 'bens',
      procedimento: 'consulta_previa',
    });
    expect(r.erros).toEqual([
      { linha: 4, motivo: 'sem NIF do adjudicatário.' },
      { linha: 5, motivo: 'NIF 123456780 inválido.' },
      { linha: 6, motivo: 'preço ilegível; data ilegível.' },
    ]);
  });

  it('lerContratosBase: NIF e nome em colunas separadas, vírgula como separador', () => {
    const csv =
      'adjudicante,nif adjudicatario,nome adjudicatario,objeto,cpv,preco contratual,data,procedimento,outra\n' +
      'Município,501234560,Jardins,Poda,77341000-2,1000.50,2026-05-05,Ajuste direto simplificado,x';
    const r = lerContratosBase(csv);
    expect(r.erros).toEqual([]);
    expect(r.colunas_desconhecidas).toEqual(['outra']);
    expect(r.linhas[0]).toMatchObject({
      adjudicatario_nif: '501234560',
      adjudicatario_nome: 'Jardins',
      preco_contratual_cent: 100_050,
      procedimento: 'ajuste_direto_simplificado',
      tipo: 'servicos',
    });
  });

  it('lerContratosBase: faltam colunas ou ficheiro vazio', () => {
    expect(lerContratosBase('').erros[0].motivo).toBe('Ficheiro vazio.');
    expect(lerContratosBase('objeto;cpv\nx;y').erros[0].motivo).toBe(
      'Faltam colunas: adjudicatário, preço contratual, data.',
    );
  });
});
