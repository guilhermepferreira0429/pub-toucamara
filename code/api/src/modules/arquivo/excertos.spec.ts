import { excertos, raiz, termosDaPesquisa } from './excertos';

const TEXTO =
  'Câmara Municipal de Guimarães. Processo de obras n.º 123/1987. ' +
  'José da Silva Conceição, residente na Rua de Santo António, 45, vem requerer licença de construção ' +
  'de uma moradia unifamiliar. '.repeat(3) +
  'Segue em anexo o projecto de arquitectura, com as plantas do rés-do-chão e do primeiro andar. ' +
  'O técnico informa que a construção respeita o alinhamento da rua. Guimarães, 12 de março de 1987.';

describe('excertos da pesquisa', () => {
  it('termos: sem acentos, sem palavras vazias, sem repetidas', () => {
    expect(termosDaPesquisa('Licença de CONSTRUÇÃO da licença')).toEqual([
      'licenca',
      'construcao',
    ]);
    expect(termosDaPesquisa('123/1987')).toEqual(['123/1987']);
  });

  it('raiz: plural, género e -ção/-ções', () => {
    expect(raiz('construcoes')).toBe(raiz('construcao'));
    expect(raiz('licencas')).toBe(raiz('licenca'));
    expect(raiz('casa')).toBe('casa');
    expect(raiz('1987')).toBe('1987');
  });

  it('encontra sem acentos e com outro fim de palavra, e marca as posições', () => {
    const [e, ...resto] = excertos(TEXTO, 'licenca construcoes');
    expect(e.texto).toContain('licença de construção');
    const marcados = e.destaques.map(([a, b]) => e.texto.slice(a, b));
    expect(marcados).toEqual(expect.arrayContaining(['licença', 'construção']));
    expect(resto.length).toBeLessThanOrEqual(2);
  });

  it('janelas com mais termos primeiro; no máximo três; sem sobreposição', () => {
    const r = excertos(TEXTO, 'moradia plantas alinhamento', {
      largura: 60,
    });
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(3);
    for (const e of r) {
      expect(e.texto.length).toBeLessThanOrEqual(60 + 40);
      expect(e.destaques.length).toBeGreaterThan(0);
    }
    expect(r.some((e) => e.texto.includes('plantas'))).toBe(true);
    // Ordenados pela posição no texto.
    const posicoes = r.map((e) => TEXTO.indexOf(e.texto.slice(0, 20)));
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
  });

  it('não corta palavras e diz se cortou o texto', () => {
    const [e] = excertos(TEXTO, 'arquitectura', { largura: 60 });
    expect(e.corta_inicio).toBe(true);
    expect(e.corta_fim).toBe(true);
    expect(TEXTO).toContain(e.texto);
    // Começa e acaba no limite de uma palavra.
    const pos = TEXTO.indexOf(e.texto);
    expect(TEXTO[pos - 1]).toBe(' ');
    expect(TEXTO[pos + e.texto.length]).toMatch(/[\s,.]/);
  });

  it('números e barras (o número do processo)', () => {
    const [e] = excertos(TEXTO, '123/1987');
    expect(e.destaques.map(([a, b]) => e.texto.slice(a, b))).toEqual([
      '123/1987',
    ]);
  });

  it('sem ocorrências: o início do texto; sem texto: nada', () => {
    const [e] = excertos(TEXTO, 'piscina', { largura: 50 });
    expect(e.destaques).toEqual([]);
    expect(e.corta_inicio).toBe(false);
    expect(TEXTO.startsWith(e.texto)).toBe(true);
    expect(excertos(null, 'x')).toEqual([]);
    expect(excertos('', 'x')).toEqual([]);
  });
});
