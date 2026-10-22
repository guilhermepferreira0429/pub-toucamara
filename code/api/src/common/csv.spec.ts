import {
  BOM,
  celula,
  Coluna,
  dataHora,
  dia,
  euros,
  gerarCsv,
  nomeCsv,
  numeroPt,
} from './csv';

describe('csv', () => {
  it('BOM (U+FEFF), ; a separar, CRLF no fim de cada linha', () => {
    expect(BOM.charCodeAt(0)).toBe(0xfeff);
    const colunas: Coluna<{ a: string; b: number }>[] = [
      { titulo: 'Nome', valor: (l) => l.a },
      { titulo: 'Valor', valor: (l) => l.b },
    ];
    const csv = gerarCsv(colunas, [
      { a: 'Água', b: 1.5 },
      { a: 'Luz', b: 2 },
    ]);
    expect(csv).toBe(`${BOM}Nome;Valor\r\nÁgua;1,5\r\nLuz;2\r\n`);
  });

  it('sem linhas: só o cabeçalho', () => {
    expect(gerarCsv([{ titulo: 'Número', valor: () => null }], [])).toBe(
      `${BOM}Número\r\n`,
    );
  });

  it('aspas: ; dentro do campo, aspas duplicadas, quebras de linha', () => {
    expect(celula('Rua A; n.º 3')).toBe('"Rua A; n.º 3"');
    expect(celula('Disse "olá"')).toBe('"Disse ""olá"""');
    expect(celula('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
    expect(celula('linha 1\r\nlinha 2')).toBe('"linha 1\r\nlinha 2"');
    expect(celula('simples, com vírgula')).toBe('simples, com vírgula');
  });

  it('injeção de fórmulas: =, +, -, @ (e tab) ficam texto com apóstrofo', () => {
    expect(celula('=HYPERLINK("http://x")')).toBe(
      `"'=HYPERLINK(""http://x"")"`,
    );
    expect(celula('+351 912 345 678')).toBe("'+351 912 345 678");
    expect(celula('-2+3')).toBe("'-2+3");
    expect(celula('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(celula('\t=1')).toBe("'\t=1");
    // Números de verdade continuam números (negativos incluídos).
    expect(celula(-2.5)).toBe('-2,5');
  });

  it('números com vírgula decimal, sem milhares; euros com 2 casas', () => {
    expect(numeroPt(1234.56)).toBe('1234,56');
    expect(numeroPt(1000000)).toBe('1000000');
    expect(numeroPt(Number.NaN)).toBe('');
    expect(euros(123450)).toBe('1234,50');
    expect(euros(5)).toBe('0,05');
    expect(euros(-1999)).toBe('-19,99');
  });

  it('datas em PT, no fuso de Lisboa (verão e inverno)', () => {
    expect(dataHora(new Date('2026-07-01T12:05:00Z'))).toBe('01/07/2026 13:05');
    expect(dataHora(new Date('2026-12-31T23:30:00Z'))).toBe('31/12/2026 23:30');
    expect(celula(new Date('2026-10-22T08:00:00Z'))).toBe('22/10/2026 09:00');
    expect(dia('2026-10-22')).toBe('22/10/2026');
    // 23:30 UTC de 31/10 ainda é dia 31 em Lisboa (inverno, UTC+0)...
    expect(dia(new Date('2026-10-31T23:30:00Z'))).toBe('31/10/2026');
    // ...mas 23:30 UTC de 30/06 já é 1/7 em Lisboa (verão, UTC+1).
    expect(dia(new Date('2026-06-30T23:30:00Z'))).toBe('01/07/2026');
  });

  it('booleanos em PT; vazios', () => {
    expect(celula(true)).toBe('Sim');
    expect(celula(false)).toBe('Não');
    expect(celula(null)).toBe('');
    expect(celula(undefined)).toBe('');
  });

  it('nome do ficheiro com o dia no fuso', () => {
    expect(nomeCsv('ocorrencias', new Date('2026-10-22T10:00:00Z'))).toBe(
      'ocorrencias-2026-10-22.csv',
    );
    expect(nomeCsv('conversas', new Date('2026-06-30T23:30:00Z'))).toBe(
      'conversas-2026-07-01.csv',
    );
  });
});
