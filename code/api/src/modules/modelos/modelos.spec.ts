import {
  analisarCorpo,
  dataCurta,
  dataPorExtenso,
  juntarLista,
  NOMES_VARIAVEIS,
  podeTransitar,
  preencher,
  transicoesDe,
} from './modelos.js';

describe('analisarCorpo', () => {
  it('as variáveis suportadas, por ordem e sem repetidas', () => {
    expect(
      analisarCorpo(
        'Exmo(a). Sr(a). {nome}, processo {numero_processo} ({tipo_processo}). {nome}, entregue até {prazo}: {documentos_em_falta}. {link} {data} {municipio} {morada}',
      ),
    ).toEqual({
      variaveis: [
        'nome',
        'numero_processo',
        'tipo_processo',
        'prazo',
        'documentos_em_falta',
        'link',
        'data',
        'municipio',
        'morada',
      ],
      desconhecidas: [],
      chavetas_soltas: 0,
      valido: true,
    });
  });

  it('desconhecidas e chavetas soltas tornam o corpo inválido', () => {
    expect(
      analisarCorpo('Olá {Nome}, {n.º do processo} {nif} {nif} {nome'),
    ).toEqual({
      variaveis: [],
      desconhecidas: ['{Nome}', '{n.º do processo}', '{nif}'],
      chavetas_soltas: 1,
      valido: false,
    });
    expect(analisarCorpo('prazo} e {}').valido).toBe(false);
    expect(analisarCorpo('Sem variáveis.')).toMatchObject({
      variaveis: [],
      valido: true,
    });
  });

  it('as nove variáveis documentadas', () => {
    expect(NOMES_VARIAVEIS).toEqual([
      'nome',
      'numero_processo',
      'tipo_processo',
      'morada',
      'prazo',
      'documentos_em_falta',
      'link',
      'data',
      'municipio',
    ]);
  });
});

describe('preencher', () => {
  it('troca as variáveis pelos valores', () => {
    expect(
      preencher('{municipio}: processo {numero_processo}, {nome}.', {
        municipio: 'Teste',
        numero_processo: 'CP 1/2026',
        nome: 'Ana Silva',
      }),
    ).toEqual({
      texto: 'Teste: processo CP 1/2026, Ana Silva.',
      em_falta: [],
    });
  });

  it('sem valor: marca para completar e diz o que falta (uma vez)', () => {
    expect(
      preencher('{nome} ({nome}) até {prazo}. {outra}', {
        nome: '  ',
        prazo: null,
      }),
    ).toEqual({
      texto:
        '[a completar: nome do requerente] ([a completar: nome do requerente]) até [a completar: prazo]. {outra}',
      em_falta: ['nome', 'prazo'],
    });
  });
});

describe('auxiliares', () => {
  it('juntarLista', () => {
    expect(juntarLista([])).toBe('');
    expect(juntarLista(['A'])).toBe('A');
    expect(juntarLista(['A', 'B'])).toBe('A e B');
    expect(juntarLista(['A', 'B', 'C'])).toBe('A, B e C');
  });

  it('datas', () => {
    expect(dataCurta('2026-11-15')).toBe('15/11/2026');
    expect(dataCurta(null)).toBeNull();
    expect(
      dataPorExtenso(new Date('2026-10-20T23:30:00Z'), 'Europe/Lisbon'),
    ).toBe('21 de outubro de 2026');
  });
});

describe('estados', () => {
  it('rascunho → a_rever → aprovado; devolver; aprovado não volta atrás', () => {
    expect(podeTransitar('rascunho', 'a_rever')).toBe(true);
    expect(podeTransitar('a_rever', 'aprovado')).toBe(true);
    expect(podeTransitar('a_rever', 'rascunho')).toBe(true);
    expect(podeTransitar('rascunho', 'aprovado')).toBe(false);
    expect(podeTransitar('aprovado', 'rascunho')).toBe(false);
    expect(podeTransitar('substituido', 'aprovado')).toBe(false);
    expect(podeTransitar('rascunho', 'rascunho')).toBe(true);
    expect(transicoesDe('aprovado')).toEqual([]);
  });
});
