import {
  calcularPrazo,
  codigoNaMensagem,
  codigoValido,
  escolherProcesso,
  excertoTemDias,
  fraseFaltam,
  LeituraCarta,
  ocultarDadosPessoais,
  porExtenso,
  rascunhoPronuncia,
  rascunhoProrrogacao,
  respostasPossiveis,
  validarLeitura,
} from './regras';

function leitura(over: Partial<LeituraCarta> = {}): LeituraCarta {
  return {
    legivel: true,
    motivo_ilegivel: null,
    entidade_emissora: 'Câmara Municipal de Teste',
    tipo_entidade: 'camara',
    tipo: 'audiencia_previa',
    assunto: 'Porta na cozinha',
    referencia: { valor: 'CP 412/2026', excerto: 'Processo n.º CP 412/2026' },
    data_documento: { valor: '2026-10-15', excerto: 'Data: 15/10/2026' },
    data_notificacao: { valor: null, excerto: null },
    prazo: {
      dias: 10,
      unidade: 'uteis',
      data_limite_escrita: null,
      a_contar_de: 'notificacao',
      base_legal: 'artigos 121.º e 122.º do CPA',
      excerto: 'no prazo de 10 (dez) dias úteis a contar da notificação',
    },
    pedido: [],
    valores: [],
    consequencias: [],
    explicacao: 'A câmara pensa recusar o pedido.',
    ...over,
  };
}

const SEM_FERIADOS = new Set<string>();

describe('cartas · validar a leitura da IA', () => {
  it('aceita o prazo quando o excerto o sustenta', () => {
    const v = validarLeitura(leitura());
    expect(v.prazo).toMatchObject({
      encontrado: true,
      dias: 10,
      unidade: 'uteis',
      descartado: null,
    });
    expect(v.da_camara).toBe(true);
    expect(v.tipo_rotulo).toBe('Notificação para audiência prévia');
  });

  it('nunca aceita um prazo que o excerto não diz', () => {
    const v = validarLeitura(
      leitura({
        prazo: {
          dias: 15,
          unidade: 'uteis',
          data_limite_escrita: null,
          a_contar_de: 'notificacao',
          base_legal: null,
          excerto: 'no prazo de 10 dias úteis',
        },
      }),
    );
    expect(v.prazo.encontrado).toBe(false);
    expect(v.prazo.dias).toBeNull();
    expect(v.prazo.descartado).toMatch(/não diz 15 dias/);
  });

  it('sem excerto não há prazo (nem data-limite)', () => {
    const v = validarLeitura(
      leitura({
        prazo: {
          dias: 10,
          unidade: 'uteis',
          data_limite_escrita: '2026-11-30',
          a_contar_de: 'notificacao',
          base_legal: 'CPA',
          excerto: null,
        },
      }),
    );
    expect(v.prazo).toMatchObject({
      encontrado: false,
      dias: null,
      data_limite_escrita: null,
      base_legal: null,
    });
  });

  it('descarta datas inválidas e dias fora do plausível', () => {
    const v = validarLeitura(
      leitura({
        data_documento: { valor: '2026-02-30', excerto: '30/02/2026' },
        prazo: {
          dias: 900,
          unidade: 'uteis',
          data_limite_escrita: null,
          a_contar_de: null,
          base_legal: null,
          excerto: '900 dias',
        },
      }),
    );
    expect(v.data_documento).toEqual({ valor: null, excerto: null });
    expect(v.prazo.encontrado).toBe(false);
  });

  it('sem consequências na carta usa a regra geral, marcada como tal', () => {
    const v = validarLeitura(leitura());
    expect(v.consequencias).toEqual([
      expect.objectContaining({ origem: 'regra_geral', excerto: null }),
    ]);
    const c = validarLeitura(
      leitura({
        consequencias: [
          { texto: 'O pedido é rejeitado.', excerto: 'será rejeitada' },
        ],
      }),
    );
    expect(c.consequencias).toEqual([
      {
        texto: 'O pedido é rejeitado.',
        excerto: 'será rejeitada',
        origem: 'carta',
      },
    ]);
  });

  it('cartas das Finanças não são da câmara', () => {
    const v = validarLeitura(
      leitura({
        tipo_entidade: 'financas',
        entidade_emissora: 'Autoridade Tributária e Aduaneira',
      }),
    );
    expect(v.da_camara).toBe(false);
    // Entidade desconhecida mas com "Câmara Municipal" no cabeçalho: é nossa.
    expect(
      validarLeitura(
        leitura({
          tipo_entidade: 'desconhecida',
          entidade_emissora: 'Município de Teste',
        }),
      ).da_camara,
    ).toBe(true);
  });

  it('tira dados pessoais dos textos que guarda', () => {
    const v = validarLeitura(
      leitura({
        explicacao:
          'A carta é para a Sandra (NIF 123456789, telemóvel 912 345 678, sandra@exemplo.pt).',
      }),
    );
    expect(v.explicacao).not.toMatch(/123456789|912 345 678|sandra@/);
    expect(v.explicacao).toContain('[NIF]');
  });
});

describe('cartas · números do prazo', () => {
  it('reconhece algarismos e por extenso', () => {
    expect(excertoTemDias('no prazo de 10 (dez) dias úteis', 10)).toBe(true);
    expect(excertoTemDias('no prazo de dez dias', 10)).toBe(true);
    expect(excertoTemDias('quinze dias seguidos', 15)).toBe(true);
    expect(excertoTemDias('vinte e cinco dias', 25)).toBe(true);
    expect(excertoTemDias('no prazo de 10 dias', 15)).toBe(false);
    expect(excertoTemDias('no prazo de 10', 10)).toBe(false);
    expect(excertoTemDias(null, 10)).toBe(false);
  });

  it('formas por extenso', () => {
    expect(porExtenso(1)).toEqual(['um', 'uma']);
    expect(porExtenso(14)).toEqual(['catorze', 'quatorze']);
    expect(porExtenso(30)).toEqual(['trinta']);
    expect(porExtenso(0)).toEqual([]);
  });
});

describe('cartas · calcular o prazo', () => {
  const base = (over: Partial<Parameters<typeof calcularPrazo>[0]> = {}) =>
    calcularPrazo({
      prazo: validarLeitura(leitura()).prazo,
      dataNotificacao: null,
      dataDocumento: '2026-10-15',
      dataRececaoDita: '2026-10-22',
      hoje: '2026-10-22',
      feriados: SEM_FERIADOS,
      ...over,
    });

  it('dias úteis a partir do dia seguinte à notificação', () => {
    const p = base();
    expect(p).toMatchObject({
      estado: 'calculado',
      inicio: '2026-10-22',
      inicio_origem: 'rececao_dita',
      data_limite: '2026-11-05',
      unidade: 'uteis',
      faltam_dias_uteis: 10,
      faltam_dias: 14,
      terminou: false,
    });
    expect(p.fontes).toContain(
      'Código do Procedimento Administrativo, art. 87.º',
    );
    expect(fraseFaltam(p)).toBe(
      'Faltam 10 dias úteis: o prazo termina a 5 de novembro.',
    );
  });

  it('os feriados não contam', () => {
    expect(base({ feriados: new Set(['2026-10-30']) }).data_limite).toBe(
      '2026-11-06',
    );
  });

  it('dias seguidos: se acabar ao domingo passa para segunda', () => {
    const p = base({
      prazo: { ...validarLeitura(leitura()).prazo, unidade: 'corridos' },
    });
    expect(p.data_limite).toBe('2026-11-02');
    expect(p.regra).toMatch(/dia útil seguinte/);
  });

  it('só "dias": regra geral do CPA (dias úteis)', () => {
    const p = base({
      prazo: { ...validarLeitura(leitura()).prazo, unidade: 'nao_diz' },
    });
    expect(p.unidade).toBe('uteis');
    expect(p.regra).toMatch(/regra geral do CPA/);
  });

  it('sem data de notificação pede a data em vez de inventar', () => {
    const p = base({ dataRececaoDita: null });
    expect(p).toMatchObject({ estado: 'falta_data', data_limite: null });
    expect(fraseFaltam(p)).toBeNull();
  });

  it('a contar da data da carta, quando a carta o diz', () => {
    const p = base({
      dataRececaoDita: null,
      prazo: {
        ...validarLeitura(leitura()).prazo,
        a_contar_de: 'data_documento',
      },
    });
    expect(p).toMatchObject({
      inicio: '2026-10-15',
      inicio_origem: 'data_documento',
      data_limite: '2026-10-29',
    });
  });

  it('carta sem prazo: sem_prazo', () => {
    const sem = validarLeitura(
      leitura({
        prazo: {
          dias: null,
          unidade: null,
          data_limite_escrita: null,
          a_contar_de: null,
          base_legal: null,
          excerto: null,
        },
      }),
    ).prazo;
    expect(base({ prazo: sem }).estado).toBe('sem_prazo');
  });

  it('data-limite escrita vale como está; e diz se já terminou', () => {
    const escrita = validarLeitura(
      leitura({
        prazo: {
          dias: null,
          unidade: null,
          data_limite_escrita: '2026-10-20',
          a_contar_de: null,
          base_legal: null,
          excerto: 'até 20 de outubro de 2026',
        },
      }),
    ).prazo;
    const p = base({ prazo: escrita });
    expect(p).toMatchObject({ data_limite: '2026-10-20', terminou: true });
    expect(fraseFaltam(p)).toMatch(/já terminou/);
  });
});

describe('cartas · ligar ao processo', () => {
  const candidatos = [
    { id: 'p1', numero: 'CP 412/2026', municipe_id: 'ana' },
    { id: 'p2', numero: 'LO 412/2025', municipe_id: 'rui' },
  ];

  it('liga só ao processo da própria pessoa', () => {
    expect(escolherProcesso('CP 412/2026', 'ana', candidatos)).toEqual({
      tipo: 'ligado',
      processoId: 'p1',
      numero: 'CP 412/2026',
    });
  });

  it('processo de outra pessoa: não liga nem revela', () => {
    expect(escolherProcesso('CP 412/2026', 'rui', candidatos)).toEqual({
      tipo: 'de_outro',
    });
  });

  it('sem identificação pede-a', () => {
    expect(escolherProcesso('CP 412/2026', null, candidatos)).toEqual({
      tipo: 'precisa_identificacao',
    });
  });

  it('referência que não é nossa: documento solto', () => {
    expect(escolherProcesso('CP 999/2026', 'ana', candidatos).tipo).toBe(
      'solto',
    );
    expect(escolherProcesso(null, 'ana', candidatos).tipo).toBe('solto');
  });
});

describe('cartas · dados pessoais', () => {
  it('NIF, telefone, email, IBAN e cartão de cidadão', () => {
    const t = ocultarDadosPessoais(
      'NIF 123 456 789; tel. +351 912 345 678; email a.b@c.pt; IBAN PT50 0002 0123 1234 5678 9015 4; CC 12345678 9 ZZ1',
    );
    expect(t).toBe(
      'NIF [NIF]; tel. [telefone]; email [email]; IBAN [IBAN]; CC [n.º do cartão de cidadão]',
    );
  });

  it('um NIF válido solto também sai', () => {
    expect(ocultarDadosPessoais('requerente 123456789')).toBe(
      'requerente [NIF]',
    );
  });

  it('mantém referências Multibanco e números de processo', () => {
    expect(
      ocultarDadosPessoais('Entidade 21000, Referência: 123 456 789'),
    ).toBe('Entidade 21000, Referência: 123 456 789');
    expect(ocultarDadosPessoais('Processo n.º CP 412/2026')).toBe(
      'Processo n.º CP 412/2026',
    );
  });
});

describe('cartas · rascunhos', () => {
  const dados = {
    municipio: 'Teste',
    nome: 'Sandra Martins',
    referencia: 'CP 412/2026',
    assunto: 'Porta na cozinha',
    dataCarta: '2026-10-15',
    argumentos:
      'A parede não é estrutural.\nO técnico pode confirmar por escrito.',
    diasPedidos: null,
    dataLimite: '2026-11-05',
    pedido: [],
  };

  it('pronúncia com os argumentos da pessoa, numerados, sem inventar artigos', () => {
    const t = rascunhoPronuncia(dados);
    expect(t).toContain('Assunto: Porta na cozinha — Processo n.º CP 412/2026');
    expect(t).toContain('1. A parede não é estrutural.');
    expect(t).toContain('2. O técnico pode confirmar por escrito.');
    expect(t).toContain('Sandra Martins');
    expect(t).not.toMatch(/art(igo)?\.? ?\d/);
  });

  it('sem argumentos deixa o espaço para a pessoa escrever', () => {
    expect(rascunhoPronuncia({ ...dados, argumentos: null })).toContain(
      '[Explique aqui',
    );
  });

  it('prorrogação: 10 dias úteis por defeito e o prazo atual', () => {
    const t = rascunhoProrrogacao({ ...dados, argumentos: null });
    expect(t).toContain('por mais 10 dias úteis');
    expect(t).toContain('05/11/2026');
  });

  it('respostas por tipo de carta', () => {
    expect(respostasPossiveis('audiencia_previa', false)).toEqual([
      'pronuncia',
      'prorrogacao',
    ]);
    expect(respostasPossiveis('decisao', true)).toEqual(['pagamento']);
    expect(respostasPossiveis('edital', false)).toEqual([]);
  });
});

describe('cartas · códigos', () => {
  it('valida e encontra o código no chat', () => {
    expect(codigoValido('ABCDEFGH23')).toBe(true);
    expect(codigoValido('ABCDEFGH20')).toBe(false); // 0 não existe
    expect(codigoNaMensagem('Enviei a carta [carta abcdefgh23]')).toBe(
      'ABCDEFGH23',
    );
    expect(codigoNaMensagem('sem código')).toBeNull();
  });
});
