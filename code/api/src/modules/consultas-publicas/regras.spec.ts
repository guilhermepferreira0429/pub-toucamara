import {
  agregar,
  anonimizarTexto,
  csvParticipacoes,
  deduzirFreguesia,
  diaDito,
  lerRespostas,
  montarPerguntas,
  motivoSemParticipar,
  palavrasFrequentes,
  partesFreguesia,
  resolverFreguesia,
  resultadosPublicos,
  SEM_FREGUESIA,
  situacao,
} from './regras';

const PERGUNTAS = montarPerguntas([
  {
    texto: 'Concorda com a ciclovia na Avenida?',
    opcoes: ['Concordo', 'Não concordo', 'Tenho dúvidas'],
  },
  { texto: 'Usaria a ciclovia?', opcoes: ['Sim', 'Não'] },
]);

describe('montarPerguntas', () => {
  it('dá ids estáveis às perguntas e às opções', () => {
    expect(PERGUNTAS[0]).toEqual({
      id: 'p1',
      texto: 'Concorda com a ciclovia na Avenida?',
      opcoes: [
        { id: 'concordo', texto: 'Concordo' },
        { id: 'nao_concordo', texto: 'Não concordo' },
        { id: 'tenho_duvidas', texto: 'Tenho dúvidas' },
      ],
    });
    expect(PERGUNTAS[1].id).toBe('p2');
  });

  it('opções repetidas não colidem', () => {
    const [p] = montarPerguntas([
      { texto: 'Qual prefere?', opcoes: ['Sim', 'sim'] },
    ]);
    expect(p.opcoes.map((o) => o.id)).toEqual(['sim', 'sim_2']);
  });
});

describe('prazo (situacao)', () => {
  const c = {
    abre_em: '2026-11-01',
    fecha_em: '2026-11-30',
    relatorio_em: '2026-12-15',
  };

  it('rascunho e fechada não dependem da data', () => {
    expect(situacao({ ...c, estado: 'rascunho' }, '2026-11-10')).toBe(
      'rascunho',
    );
    expect(situacao({ ...c, estado: 'fechada' }, '2026-11-10')).toBe('fechada');
  });

  it('aberta só entre o primeiro e o último dia (inclusive)', () => {
    const a = { ...c, estado: 'aberta' as const };
    expect(situacao(a, '2026-10-31')).toBe('agendada');
    expect(situacao(a, '2026-11-01')).toBe('aberta');
    expect(situacao(a, '2026-11-30')).toBe('aberta');
    expect(situacao(a, '2026-12-01')).toBe('terminou');
  });

  it('resultados públicos só quando já não se pode participar', () => {
    expect(resultadosPublicos('aberta')).toBe(false);
    expect(resultadosPublicos('agendada')).toBe(false);
    expect(resultadosPublicos('terminou')).toBe(true);
    expect(resultadosPublicos('fechada')).toBe(true);
  });

  it('explica porque não se pode participar, com as datas ditas', () => {
    expect(motivoSemParticipar('aberta', c)).toBeNull();
    expect(motivoSemParticipar('agendada', c)).toContain('1 de novembro');
    expect(motivoSemParticipar('terminou', c)).toContain('15 de dezembro');
    expect(diaDito('2026-03-07')).toBe('7 de março');
  });
});

describe('lerRespostas', () => {
  it('aceita ids, números e textos das perguntas e das opções', () => {
    expect(
      lerRespostas(PERGUNTAS, [
        { pergunta: '1', opcao: 'não concordo' },
        { pergunta: 'Usaria a ciclovia?', opcao: 'SIM' },
      ]),
    ).toEqual({ ok: true, respostas: { p1: 'nao_concordo', p2: 'sim' } });
  });

  it('sem pergunta, vai pela ordem', () => {
    expect(
      lerRespostas(PERGUNTAS, [{ opcao: 'tenho_duvidas' }, { opcao: 'Não' }]),
    ).toEqual({ ok: true, respostas: { p1: 'tenho_duvidas', p2: 'nao' } });
  });

  it('"concordo plenamente" encaixa em "Concordo", mas não é ambíguo com "Não concordo"', () => {
    const r = lerRespostas(PERGUNTAS, [
      { pergunta: 'p1', opcao: 'concordo plenamente' },
      { pergunta: 'p2', opcao: 'sim' },
    ]);
    expect(r).toEqual({ ok: true, respostas: { p1: 'concordo', p2: 'sim' } });
  });

  it('diz o que falta e o que não é uma opção', () => {
    const r = lerRespostas(PERGUNTAS, [{ pergunta: 'p1', opcao: 'talvez' }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.em_falta.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(r.invalidas[0]).toMatchObject({
      dito: 'talvez',
      opcoes: ['Concordo', 'Não concordo', 'Tenho dúvidas'],
    });
  });

  it('ao alterar, as respostas anteriores contam para as que não vierem', () => {
    expect(
      lerRespostas(PERGUNTAS, [{ pergunta: 'p2', opcao: 'não' }], {
        p1: 'concordo',
        p2: 'sim',
      }),
    ).toEqual({ ok: true, respostas: { p1: 'concordo', p2: 'nao' } });
  });
});

describe('freguesias', () => {
  const LISTA = [
    'Azurém',
    'União das Freguesias de Oliveira, São Paio e São Sebastião',
    'Creixomil',
  ];

  it('partes de uma união de freguesias', () => {
    expect(partesFreguesia(LISTA[1])).toEqual([
      'oliveira',
      'sao paio',
      'sao sebastiao',
    ]);
  });

  it('a freguesia dita fica com o nome da lista', () => {
    expect(resolverFreguesia('azurem', LISTA)).toBe('Azurém');
    expect(resolverFreguesia('Freguesia de Creixomil', LISTA)).toBe(
      'Creixomil',
    );
    expect(resolverFreguesia('São Paio', LISTA)).toBe(LISTA[1]);
    expect(resolverFreguesia('  Pevidém ', LISTA)).toBe('Pevidém');
  });

  it('deduz da morada geocodificada só quando há uma candidata', () => {
    expect(
      deduzirFreguesia(
        'Rua Doutor José Sampaio, Azurém, Guimarães, Braga, 4800-000, Portugal',
        LISTA,
      ),
    ).toBe('Azurém');
    expect(
      deduzirFreguesia('Largo da Oliveira, Guimarães, Portugal', LISTA),
    ).toBe(LISTA[1]);
    expect(deduzirFreguesia('Rua X, Fafe, Braga, Portugal', LISTA)).toBeNull();
  });
});

describe('agregar (resultados por freguesia)', () => {
  const participacoes = [
    { respostas: { p1: 'concordo', p2: 'sim' }, freguesia: 'Azurém' },
    { respostas: { p1: 'concordo', p2: 'nao' }, freguesia: 'azurem' },
    { respostas: { p1: 'nao_concordo', p2: 'nao' }, freguesia: 'Creixomil' },
    { respostas: { p1: 'tenho_duvidas', p2: 'sim' }, freguesia: 'Pevidém' },
    { respostas: { p1: 'concordo', p2: 'sim' }, freguesia: null },
  ];

  it('conta por opção no total e por freguesia, abrangidas primeiro (mesmo com 0)', () => {
    const r = agregar(PERGUNTAS, participacoes, [
      'Azurém',
      'Creixomil',
      'Urgezes',
    ]);
    expect(r.total).toBe(5);
    expect(r.freguesias).toEqual([
      { freguesia: 'Azurém', abrangida: true, participacoes: 2 },
      { freguesia: 'Creixomil', abrangida: true, participacoes: 1 },
      { freguesia: 'Urgezes', abrangida: true, participacoes: 0 },
      { freguesia: 'Pevidém', abrangida: false, participacoes: 1 },
      { freguesia: SEM_FREGUESIA, abrangida: false, participacoes: 1 },
    ]);
    const p1 = r.perguntas[0];
    expect(p1.opcoes).toEqual([
      { id: 'concordo', texto: 'Concordo', n: 3, pct: 60 },
      { id: 'nao_concordo', texto: 'Não concordo', n: 1, pct: 20 },
      { id: 'tenho_duvidas', texto: 'Tenho dúvidas', n: 1, pct: 20 },
    ]);
    expect(p1.por_freguesia[0]).toEqual({
      freguesia: 'Azurém',
      abrangida: true,
      total: 2,
      opcoes: { concordo: 2, nao_concordo: 0, tenho_duvidas: 0 },
    });
    expect(p1.por_freguesia[2].total).toBe(0);
  });

  it('todo o concelho: todas as freguesias são abrangidas', () => {
    const r = agregar(PERGUNTAS, participacoes, null);
    expect(r.freguesias.map((f) => f.freguesia)).toEqual([
      'Azurém',
      'Creixomil',
      'Pevidém',
      SEM_FREGUESIA,
    ]);
    expect(r.freguesias.slice(0, 3).every((f) => f.abrangida)).toBe(true);
  });

  it('sem participações: zeros, sem dividir por zero', () => {
    const r = agregar(PERGUNTAS, [], ['Azurém']);
    expect(r.total).toBe(0);
    expect(r.perguntas[0].opcoes[0]).toMatchObject({ n: 0, pct: 0 });
  });
});

describe('opiniões, anonimização e CSV', () => {
  it('palavras frequentes contam uma vez por opinião e ignoram palavras vazias', () => {
    const r = palavrasFrequentes([
      'Falta estacionamento na avenida',
      'Sem estacionamento ninguém vai às lojas',
      'O estacionamento e a segurança das crianças',
      'Segurança das crianças primeiro, segurança!',
      'Gosto da ideia',
    ]);
    expect(r[0]).toEqual({ palavra: 'estacionamento', n: 3 });
    expect(r).toContainEqual({ palavra: 'seguranca', n: 2 });
    expect(r.find((x) => x.palavra === 'para')).toBeUndefined();
  });

  it('tira telefones e emails das opiniões', () => {
    expect(
      anonimizarTexto(
        'Liguem-me para o 912 345 678 ou ana@exemplo.pt, obrigado',
      ),
    ).toBe('Liguem-me para o [número] ou [email], obrigado');
  });

  it('CSV sem dados pessoais, com ";" e aspas quando é preciso', () => {
    const csv = csvParticipacoes(PERGUNTAS, true, [
      {
        dia: '2026-11-02',
        canal: 'telefone',
        freguesia: 'Azurém',
        respostas: { p1: 'nao_concordo', p2: 'sim' },
        opiniao: 'Tirem o "parque"; liguem 912345678',
      },
    ]);
    const [cab, linha] = csv.replace('﻿', '').trim().split('\r\n');
    expect(cab).toBe(
      'n;dia;canal;freguesia;Concorda com a ciclovia na Avenida?;Usaria a ciclovia?;opiniao',
    );
    expect(linha).toBe(
      '1;2026-11-02;telefone;Azurém;Não concordo;Sim;"Tirem o ""parque""; liguem [número]"',
    );
  });
});
