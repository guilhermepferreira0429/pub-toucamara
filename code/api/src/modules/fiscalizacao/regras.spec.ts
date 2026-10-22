import {
  aplicarRespostas,
  artigosNoTexto,
  checklistDe,
  checklistReinspecao,
  conclusaoDaChecklist,
  CONFIG_DEMONSTRACAO,
  daIa,
  dataLimite,
  esquemaConfig,
  fotosNoTexto,
  lerConfig,
  notaOcorrencia,
  notaProcesso,
  prazoNoTexto,
  relatorioLivre,
  TIPOS_VISITA,
} from './regras';

describe('checklists', () => {
  it('cada tipo tem checklist, com chaves únicas, e a config tem duração para cada tipo', () => {
    for (const t of TIPOS_VISITA) {
      const c = checklistDe(t);
      expect(c.length).toBeGreaterThan(0);
      expect(new Set(c.map((i) => i.chave)).size).toBe(c.length);
      expect(c.every((i) => i.resposta === null && i.nota === null)).toBe(true);
      expect(CONFIG_DEMONSTRACAO.duracao_min[t]).toBeGreaterThan(0);
    }
  });

  it('a nova visita verifica cada infração anterior', () => {
    const c = checklistReinspecao([
      { descricao: 'Livro de obra em falta', artigo: 'RJUE, art. 97.º' },
    ]);
    expect(c.map((i) => i.chave)).toEqual(['medidas_cumpridas', 'corrigida_1']);
    expect(c[1]).toMatchObject({
      rotulo: 'Foi corrigida: Livro de obra em falta?',
      conforme_se: 'sim',
      artigo: 'RJUE, art. 97.º',
    });
  });
});

describe('config', () => {
  it('a de demonstração é válida e está marcada; sem config ou inválida usa-a', () => {
    expect(esquemaConfig.safeParse(CONFIG_DEMONSTRACAO).success).toBe(true);
    expect(CONFIG_DEMONSTRACAO.demonstracao).toBe(true);
    expect(CONFIG_DEMONSTRACAO.ponto_partida).toBeNull();
    expect(lerConfig(null)).toBe(CONFIG_DEMONSTRACAO);
    expect(lerConfig({ velocidade_kmh: 'rápido' })).toBe(CONFIG_DEMONSTRACAO);
    const minha = {
      ...CONFIG_DEMONSTRACAO,
      ponto_partida: { nome: 'Câmara', lat: 41.4, lng: -8.3 },
      demonstracao: false,
    };
    expect(lerConfig(minha)).toEqual(minha);
  });
});

describe('conclusão pela checklist', () => {
  const obra = checklistDe('obra');

  it('por responder → inconclusivo', () => {
    expect(conclusaoDaChecklist(obra)).toBe('inconclusivo');
  });

  it('tudo respondido e bem → conforme', () => {
    const c = aplicarRespostas(
      obra,
      obra.map((i) => ({ chave: i.chave, resposta: 'sim' as const })),
    );
    expect(conclusaoDaChecklist(c)).toBe('conforme');
  });

  it('uma desconformidade chega; "não se aplica" não conta como falha', () => {
    const c = aplicarRespostas(obra, [
      { chave: 'aviso_afixado', resposta: 'na' },
      { chave: 'livro_obra', resposta: 'nao', nota: 'não estava em obra' },
    ]);
    expect(conclusaoDaChecklist(c)).toBe('com_infracoes');
  });

  it('conforme_se "nao": na ocorrência, "o problema existe? não" está bem', () => {
    const c = aplicarRespostas(checklistDe('ocorrencia'), [
      { chave: 'problema_existe', resposta: 'nao' },
      { chave: 'perigo_imediato', resposta: 'nao' },
    ]);
    // O ponto informativo (responsável identificado) não conta.
    expect(conclusaoDaChecklist(c)).toBe('conforme');
  });

  it('aplicarRespostas não sobrepõe o que já estava respondido, a não ser que se peça', () => {
    const c = aplicarRespostas(obra, [
      { chave: 'livro_obra', resposta: 'sim' },
    ]);
    const ia = aplicarRespostas(c, [{ chave: 'livro_obra', resposta: 'nao' }]);
    expect(ia.find((i) => i.chave === 'livro_obra')!.resposta).toBe('sim');
    const mao = aplicarRespostas(
      c,
      [{ chave: 'livro_obra', resposta: 'nao' }],
      true,
    );
    expect(mao.find((i) => i.chave === 'livro_obra')!.resposta).toBe('nao');
    // Chaves desconhecidas ignoram-se.
    expect(
      aplicarRespostas(obra, [{ chave: 'xpto', resposta: 'sim' }]),
    ).toEqual(obra);
  });
});

describe('leituras simples do ditado (sem IA)', () => {
  it('prazo', () => {
    expect(prazoNoTexto('Dei um prazo de 15 dias ao empreiteiro.')).toBe(15);
    expect(prazoNoTexto('Tem trinta dias para corrigir a situação.')).toBe(30);
    expect(prazoNoTexto('Prazo de quinze dias úteis.')).toBe(15);
    expect(prazoNoTexto('Voltei lá passados 3 dias.')).toBeNull();
    expect(prazoNoTexto('Sem prazo.')).toBeNull();
  });

  it('fotos e artigos', () => {
    const t =
      'Cheguei às dez. Tirei a foto 1 do aviso. Não há livro de obra, artigo 97.º do RJUE. Fotografia 2: estaleiro aberto.';
    expect(fotosNoTexto(t)).toEqual([
      'Tirei a foto 1 do aviso.',
      'Fotografia 2: estaleiro aberto.',
    ]);
    expect(artigosNoTexto(t)).toEqual(['artigo 97.º do RJUE']);
    expect(artigosNoTexto('Nada a apontar.')).toEqual([]);
  });
});

describe('relatorioLivre', () => {
  const texto =
    'Obra na Rua Nova, 12. O aviso está afixado. Não há livro de obra no local, artigo 97.º do RJUE. Prazo de 10 dias para corrigir. Tirei a foto 1 da entrada.';

  it('a estrutura sai da checklist feita à mão; o texto fica como está', () => {
    const c = aplicarRespostas(checklistDe('obra'), [
      { chave: 'aviso_afixado', resposta: 'sim' },
      { chave: 'livro_obra', resposta: 'nao', nota: 'não estava no local' },
    ]);
    const r = relatorioLivre(texto, c);
    expect(r.livre).toBe(true);
    expect(r.resumo).toBe(texto);
    expect(r.infracoes).toEqual([
      {
        descricao: 'O livro de obra está no local: não estava no local',
        artigo: 'RJUE, art. 97.º',
      },
    ]);
    expect(r.conclusao).toBe('com_infracoes');
    expect(r.prazo_dias).toBe(10);
    expect(r.fotos_referidas).toEqual(['Tirei a foto 1 da entrada.']);
    expect(r.constatacoes).toContain(
      'O aviso da licença ou comunicação prévia está afixado e visível: sim',
    );
    expect(r.constatacoes.at(-1)).toBe(
      'Normas referidas no ditado: artigo 97.º do RJUE.',
    );
    expect(r.medidas).toEqual([]);
  });

  it('sem checklist respondida: inconclusivo, sem infrações nem prazo', () => {
    const r = relatorioLivre(texto, checklistDe('obra'));
    expect(r.conclusao).toBe('inconclusivo');
    expect(r.infracoes).toEqual([]);
    expect(r.prazo_dias).toBeNull();
  });

  it('resumo curto para textos longos', () => {
    const r = relatorioLivre('palavra '.repeat(100), []);
    expect(r.resumo.length).toBe(280);
    expect(r.resumo.endsWith('...')).toBe(true);
  });
});

describe('daIa', () => {
  const base = {
    resumo: 'Obra sem livro de obra.',
    constatacoes: ['Aviso afixado'],
    infracoes: [
      { descricao: ' Livro de obra em falta ', artigo: ' ' },
      { descricao: '  ', artigo: null },
    ],
    medidas: ['Notificado o dono da obra'],
    prazo_dias: 10,
    prazo_data: 'amanhã',
    fotos_referidas: [],
    respostas_checklist: [
      { chave: 'livro_obra', resposta: 'nao' as const, nota: null },
    ],
    conclusao: 'conforme' as const,
  };

  it('limpa infrações vazias, artigo vazio, datas inválidas e corrige a conclusão', () => {
    const r = daIa(base);
    expect(r.infracoes).toEqual([
      { descricao: 'Livro de obra em falta', artigo: null },
    ]);
    expect(r.prazo_data).toBeNull();
    expect(r.prazo_dias).toBe(10);
    expect(r.conclusao).toBe('com_infracoes');
    expect(r.livre).toBe(false);
    expect('respostas_checklist' in r).toBe(false);
  });

  it('prazo absurdo cai', () => {
    expect(daIa({ ...base, prazo_dias: 5000 }).prazo_dias).toBeNull();
  });
});

describe('prazo e textos', () => {
  it('data-limite: a data dita, senão os dias ditos, senão os de omissão', () => {
    expect(
      dataLimite(
        '2026-10-21',
        { prazo_dias: null, prazo_data: '2026-11-15' },
        30,
      ),
    ).toEqual({ data: '2026-11-15', dias: 25, dito_pelo_fiscal: true });
    expect(
      dataLimite('2026-10-21', { prazo_dias: 10, prazo_data: null }, 30),
    ).toEqual({
      data: '2026-10-31',
      dias: 10,
      dito_pelo_fiscal: true,
    });
    expect(
      dataLimite('2026-10-21', { prazo_dias: null, prazo_data: null }, 30),
    ).toEqual({
      data: '2026-11-20',
      dias: 30,
      dito_pelo_fiscal: false,
    });
    // Data no passado não serve.
    expect(
      dataLimite(
        '2026-10-21',
        { prazo_dias: null, prazo_data: '2026-01-01' },
        30,
      ).data,
    ).toBe('2026-11-20');
  });

  it('notas para o munícipe', () => {
    expect(notaOcorrencia('conforme', '2026-10-21', null)).toBe(
      'A fiscalização foi ao local a 21/10/2026 e não encontrou o problema.',
    );
    expect(
      notaOcorrencia('com_infracoes', '2026-10-21', '2026-11-20'),
    ).toContain('corrigir até 20/11/2026');
    expect(notaProcesso('com_infracoes', '2026-10-21', 2, '2026-11-20')).toBe(
      'Vistoria feita a 21/10/2026: há 2 pontos a corrigir até 20/11/2026. Depois há nova vistoria.',
    );
    expect(notaProcesso('conforme', '2026-10-21', 0, null)).toBe(
      'Vistoria feita a 21/10/2026: sem desconformidades.',
    );
  });
});
