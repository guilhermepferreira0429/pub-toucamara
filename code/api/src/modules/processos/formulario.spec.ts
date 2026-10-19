import { ErroApi } from '../../common/erros.js';
import {
  camposEmFalta,
  CampoFormulario,
  dadosComRotulos,
  lerFormulario,
  NIF_REGISTADO,
  primeiroDoTipo,
  proximaPergunta,
  validarValor,
} from './formulario.js';

const formulario = lerFormulario(
  [
    {
      chave: 'morada_obra',
      rotulo: 'Morada da obra',
      tipo: 'morada',
      obrigatorio: true,
      pergunta_do_agente: 'Qual é a morada da obra?',
    },
    { chave: 'nif', rotulo: 'NIF do requerente', tipo: 'nif' },
    { chave: 'area_m2', rotulo: 'Área (m²)', tipo: 'numero' },
    {
      chave: 'inicio',
      rotulo: 'Início previsto',
      tipo: 'data',
      obrigatorio: false,
    },
    { chave: 'tem_tecnico', rotulo: 'Tem técnico?', tipo: 'sim_nao' },
    {
      chave: 'obra',
      rotulo: 'Tipo de obra',
      tipo: 'escolha',
      opcoes: ['Obras de alteração', 'Obras de ampliação', 'Demolição'],
    },
  ],
  'CP',
);

const campo = (chave: string): CampoFormulario =>
  formulario.find((c) => c.chave === chave)!;

describe('lerFormulario', () => {
  it('obrigatorio por defeito', () => {
    expect(campo('nif').obrigatorio).toBe(true);
    expect(campo('inicio').obrigatorio).toBe(false);
  });

  it('recusa escolha sem opções, chaves repetidas e a chave reservada', () => {
    for (const mau of [
      [{ chave: 'x', rotulo: 'X', tipo: 'escolha' }],
      [
        { chave: 'x', rotulo: 'X', tipo: 'texto' },
        { chave: 'x', rotulo: 'Y', tipo: 'texto' },
      ],
      [{ chave: NIF_REGISTADO, rotulo: 'X', tipo: 'texto' }],
      [{ chave: 'x', rotulo: 'X', tipo: 'cor' }],
    ]) {
      expect(() => lerFormulario(mau, 'XX')).toThrow(ErroApi);
    }
  });
});

describe('validarValor', () => {
  it('números com vírgula decimal', () => {
    expect(validarValor(campo('area_m2'), '18,5')).toEqual({
      ok: true,
      valor: 18.5,
    });
    expect(validarValor(campo('area_m2'), 42)).toEqual({ ok: true, valor: 42 });
    expect(validarValor(campo('area_m2'), 'muitos').ok).toBe(false);
  });

  it('datas portuguesas e ISO, recusa dias que não existem', () => {
    expect(validarValor(campo('inicio'), '3/11/2026')).toEqual({
      ok: true,
      valor: '2026-11-03',
    });
    expect(validarValor(campo('inicio'), '2026-11-03')).toEqual({
      ok: true,
      valor: '2026-11-03',
    });
    expect(validarValor(campo('inicio'), '31/02/2026').ok).toBe(false);
  });

  it('sim e não falados', () => {
    expect(validarValor(campo('tem_tecnico'), 'Não')).toEqual({
      ok: true,
      valor: false,
    });
    expect(validarValor(campo('tem_tecnico'), 'sim')).toEqual({
      ok: true,
      valor: true,
    });
    expect(validarValor(campo('tem_tecnico'), true)).toEqual({
      ok: true,
      valor: true,
    });
    expect(validarValor(campo('tem_tecnico'), 'talvez').ok).toBe(false);
  });

  it('NIF com espaços e dígito de controlo', () => {
    expect(validarValor(campo('nif'), '123 456 789')).toEqual({
      ok: true,
      valor: '123456789',
    });
    expect(validarValor(campo('nif'), '123456788').ok).toBe(false);
  });

  it('escolha por palavras parecidas, sem acentos', () => {
    expect(validarValor(campo('obra'), 'demolicao')).toEqual({
      ok: true,
      valor: 'Demolição',
    });
    expect(validarValor(campo('obra'), 'alteração')).toEqual({
      ok: true,
      valor: 'Obras de alteração',
    });
    // "obras" serve para duas: ambíguo.
    expect(validarValor(campo('obra'), 'obras').ok).toBe(false);
  });

  it('morada precisa de texto', () => {
    expect(validarValor(campo('morada_obra'), '12').ok).toBe(false);
    expect(validarValor(campo('morada_obra'), ' Rua Direita, 12 ')).toEqual({
      ok: true,
      valor: 'Rua Direita, 12',
    });
  });
});

describe('campos em falta e próxima pergunta', () => {
  it('pela ordem do formulário, NIF pela marca', () => {
    const dados = { area_m2: 10 };
    const falta = camposEmFalta(formulario, dados);
    expect(falta).toEqual(['morada_obra', 'nif', 'tem_tecnico', 'obra']);
    expect(proximaPergunta(formulario, falta)).toEqual({
      chave: 'morada_obra',
      pergunta: 'Qual é a morada da obra?',
    });
    const resto = camposEmFalta(formulario, {
      ...dados,
      morada_obra: 'Rua Direita, 12',
      [NIF_REGISTADO]: true,
      tem_tecnico: false,
      obra: 'Demolição',
    });
    expect(resto).toEqual([]);
    expect(proximaPergunta(formulario, resto)).toBeNull();
  });

  it('sem pergunta configurada usa o rótulo', () => {
    expect(proximaPergunta(formulario, ['tem_tecnico'])?.pergunta).toBe(
      'Tem técnico?',
    );
    expect(proximaPergunta(formulario, ['area_m2'])?.pergunta).toBe(
      'Área (m²)?',
    );
  });
});

describe('dadosComRotulos', () => {
  it('formata e nunca mostra o NIF', () => {
    const r = dadosComRotulos(formulario, {
      [NIF_REGISTADO]: true,
      tem_tecnico: true,
      inicio: '2026-11-03',
      area_m2: 18.5,
    });
    const v = Object.fromEntries(r.map((c) => [c.chave, c.valor]));
    expect(v).toEqual({
      morada_obra: null,
      nif: 'Registado (não se mostra)',
      area_m2: '18,5',
      inicio: '03/11/2026',
      tem_tecnico: 'Sim',
      obra: null,
    });
  });

  it('primeira morada para o processo', () => {
    expect(
      primeiroDoTipo(formulario, { morada_obra: 'Rua A, 1' }, 'morada'),
    ).toBe('Rua A, 1');
  });
});
