import { Formulario } from '../processos/formulario.js';
import {
  aplicarTraducao,
  camposATraduzir,
  idiomaCanonico,
  linhaSmsNaLingua,
  precisaTraducao,
} from './traducao.js';

const formulario: Formulario = [
  {
    chave: 'morada_obra',
    rotulo: 'Morada da obra',
    tipo: 'morada',
    obrigatorio: true,
  },
  { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true },
  { chave: 'area_m2', rotulo: 'Área', tipo: 'numero', obrigatorio: true },
  { chave: 'notas', rotulo: 'Notas', tipo: 'texto', obrigatorio: false },
];

const dados = {
  morada_obra: 'Street of Santo Antonio 12',
  descricao: 'Open a door in the kitchen',
  area_m2: 18.5,
  notas: 'Já em português',
};

describe('idioma', () => {
  it('só traduz o que não é português', () => {
    expect(precisaTraducao('pt-PT')).toBe(false);
    expect(precisaTraducao('pt-BR')).toBe(false);
    expect(precisaTraducao('PT')).toBe(false);
    expect(precisaTraducao('')).toBe(false);
    expect(precisaTraducao('en')).toBe(true);
    expect(precisaTraducao('uk-UA')).toBe(true);
    // 'ptx' não é português.
    expect(precisaTraducao('ptx')).toBe(true);
  });

  it('canonicaliza BCP 47', () => {
    expect(idiomaCanonico('EN-gb')).toBe('en-GB');
    expect(idiomaCanonico('')).toBeNull();
    expect(idiomaCanonico('não é língua')).toBeNull();
  });

  it('linha do SMS só em en/es/fr', () => {
    expect(linhaSmsNaLingua('en-GB')).toMatch(/^EN: /);
    expect(linhaSmsNaLingua('es')).toMatch(/^ES: /);
    expect(linhaSmsNaLingua('fr-FR')).toMatch(/^FR: /);
    expect(linhaSmsNaLingua('uk')).toBeNull();
    expect(linhaSmsNaLingua('pt-PT')).toBeNull();
  });
});

describe('camposATraduzir', () => {
  it('só texto e morada com valor, e não os já traduzidos', () => {
    expect(
      camposATraduzir(formulario, dados, null).map((c) => c.chave),
    ).toEqual(['morada_obra', 'descricao', 'notas']);
    expect(
      camposATraduzir(formulario, dados, {
        descricao: 'Open a door in the kitchen',
      }).map((c) => c.chave),
    ).toEqual(['morada_obra', 'notas']);
  });
});

describe('aplicarTraducao', () => {
  it('substitui, guarda originais só do que mudou e ignora chaves estranhas', () => {
    const pedidos = camposATraduzir(formulario, dados, null);
    const r = aplicarTraducao(formulario, dados, null, pedidos, {
      campos: [
        { chave: 'morada_obra', valor: 'Rua de Santo António, 12' },
        { chave: 'descricao', valor: 'Abrir uma porta na cozinha' },
        { chave: 'notas', valor: 'Já em português' },
        { chave: 'area_m2', valor: '99' },
        { chave: 'inventada', valor: 'x' },
      ],
    });
    expect(r.traduzidos).toEqual(['morada_obra', 'descricao']);
    expect(r.dados).toEqual({
      ...dados,
      morada_obra: 'Rua de Santo António, 12',
      descricao: 'Abrir uma porta na cozinha',
    });
    expect(r.originais).toEqual({
      morada_obra: 'Street of Santo Antonio 12',
      descricao: 'Open a door in the kitchen',
    });
  });

  it('valor inválido para o tipo não entra', () => {
    const pedidos = camposATraduzir(formulario, dados, null);
    const r = aplicarTraducao(formulario, dados, null, pedidos, {
      campos: [{ chave: 'morada_obra', valor: '12' }],
    });
    expect(r.traduzidos).toEqual([]);
    expect(r.originais).toBeNull();
    expect(r.dados).toEqual(dados);
  });
});
