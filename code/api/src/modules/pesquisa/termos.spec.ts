import {
  compactarNumero,
  encurtar,
  escaparLike,
  normalizar,
  numeroDe,
  pareceTelefone,
  termosDe,
} from './termos.js';

describe('normalizar', () => {
  it('tira acentos, maiúsculas e espaços a mais', () => {
    expect(normalizar('  Conceição   SÃO João ')).toBe('conceicao sao joao');
    expect(normalizar('Avenida D. Afonso Henriques')).toBe(
      'avenida d. afonso henriques',
    );
  });
});

describe('termosDe', () => {
  it('palavras únicas, sem as contidas noutra, no máximo 5', () => {
    expect(termosDe('Rua rua da Rua Nova')).toEqual(['rua', 'da', 'nova']);
    expect(termosDe('obra obras')).toEqual(['obras']);
    expect(termosDe('a b c d e f g')).toHaveLength(5);
    expect(termosDe('   ')).toEqual([]);
  });
});

describe('escaparLike', () => {
  it('o %, o _ e a barra deixam de ser especiais', () => {
    expect(escaparLike('50%_a\\b')).toBe('50\\%\\_a\\\\b');
  });
});

describe('números', () => {
  it('compacta como o SQL: sem espaços, traços nem zeros à esquerda', () => {
    expect(compactarNumero('CP 412/2026')).toBe('cp412/2026');
    expect(compactarNumero('OC-0381')).toBe('oc381');
    expect(compactarNumero('REC 0/2026')).toBe('rec0/2026');
  });

  it('reconhece números de processo, ocorrência e reclamação', () => {
    expect(numeroDe('CP 2/2026')).toEqual({
      compacto: 'cp2/2026',
      semPrefixo: false,
    });
    expect(numeroDe('cp2/2026')).toEqual({
      compacto: 'cp2/2026',
      semPrefixo: false,
    });
    expect(numeroDe('oc-0381')).toEqual({
      compacto: 'oc381',
      semPrefixo: false,
    });
    expect(numeroDe('REC 12 / 2026')).toEqual({
      compacto: 'rec12/2026',
      semPrefixo: false,
    });
    expect(numeroDe('#381')).toEqual({ compacto: '381', semPrefixo: true });
    expect(numeroDe('412/2026')).toEqual({
      compacto: '412/2026',
      semPrefixo: true,
    });
  });

  it('texto com palavras não é número', () => {
    expect(numeroDe('obras 2026')).toBeNull();
    expect(numeroDe('rua de santo antónio')).toBeNull();
    expect(numeroDe('buraco')).toBeNull();
  });
});

describe('pareceTelefone', () => {
  it('só o número inteiro (9 dígitos ou mais)', () => {
    expect(pareceTelefone('912 345 678')).toBe(true);
    expect(pareceTelefone('+351912345678')).toBe(true);
    expect(pareceTelefone('912345')).toBe(false);
    expect(pareceTelefone('CP 412/2026')).toBe(false);
    expect(pareceTelefone('Maria 912345678')).toBe(false);
  });
});

describe('encurtar', () => {
  it('corta com reticências e junta espaços', () => {
    expect(encurtar('a  b\nc')).toBe('a b c');
    expect(encurtar('abcdefghij', 5)).toBe('abcd…');
    expect(encurtar(null)).toBe('');
  });
});
