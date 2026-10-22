import {
  anonimizar,
  citacaoAnonima,
  contar,
  ConversaLida,
  escolherAmostra,
  frasesComparacao,
  interpretarPergunta,
  LinhaConversa,
  limparTextoIa,
  pareceDadoPessoal,
  periodoDaPergunta,
  prepararLeitura,
  resolverAnaliseIa,
  resolverFiltros,
  sinaisDaSemana,
} from './concelho.regras';

const HOJE = '2026-10-22'; // quinta-feira
const FREGUESIAS = [
  'Azurém',
  'Creixomil',
  'Oliveira, São Paio e São Sebastião',
  'Urgezes',
];
const TEMAS = [
  { id: '11111111-1111-4111-8111-111111111111', nome: 'Vias e passeios' },
  { id: '22222222-2222-4222-8222-222222222222', nome: 'Resíduos e limpeza' },
  { id: '33333333-3333-4333-8333-333333333333', nome: 'Água e saneamento' },
];

describe('anonimizar', () => {
  it('tira contactos, NIF, matrículas, códigos postais e números de porta', () => {
    const t = anonimizar(
      'Liguem-me para o 912 345 678 ou +351 253 421 200, email ana.silva@gmail.com. O meu NIF é 123456789, carro AA-12-BB, moro na Rua da Liberdade, 25, 2.º esq, 4800-058 Guimarães.',
    );
    expect(t).not.toMatch(/912|253 421|gmail|123456789|AA-12-BB|4800|\b25\b/);
    expect(t).toContain('[telefone]');
    expect(t).toContain('[email]');
    expect(t).toContain('[NIF]');
    expect(t).toContain('[matrícula]');
    expect(t).toContain('Rua da Liberdade');
    expect(t).toContain('[n.º]');
  });

  it('tira nomes: apresentações, tratamentos e nomes conhecidos', () => {
    const t = anonimizar(
      'Boa tarde, chamo-me Joaquim Ferreira. Falei com a Sra. Albertina Gomes e com o Rui ontem.',
      ['Rui Fulano'],
    );
    expect(t).not.toMatch(/Joaquim|Ferreira|Albertina|Gomes|Rui/);
    expect(t).toContain('chamo-me [nome]');
    expect(t).toContain('Sra. [nome]');
  });

  it('deixa as ruas sem número, as freguesias e o texto normal', () => {
    const t =
      'Desde a obra na Rua da Universidade não há onde estacionar em Azurém.';
    expect(anonimizar(t)).toBe(t);
    expect(pareceDadoPessoal(t)).toBe(false);
    expect(anonimizar('A Rua 25 de Abril está cheia de buracos.')).toBe(
      'A Rua 25 de Abril está cheia de buracos.',
    );
  });

  it('a citação recusa frases com qualquer dado (não corta)', () => {
    expect(
      citacaoAnonima(
        'Já liguei três vezes e ninguém resolve o problema do passeio.',
        [],
        [],
      ),
    ).toBe('Já liguei três vezes e ninguém resolve o problema do passeio.');
    expect(
      citacaoAnonima(
        'Sou a Maria e ninguém resolve o passeio.',
        ['Maria Fulana'],
        [],
      ),
    ).toBeNull();
    expect(
      citacaoAnonima(
        'Moro na rua de cima e o contentor está sempre cheio.',
        [],
        [],
      ),
    ).toBeNull();
    expect(
      citacaoAnonima(
        'O meu telefone é 912345678, liguem-me por favor.',
        [],
        [],
      ),
    ).toBeNull();
  });
});

describe('interpretar a pergunta', () => {
  it('freguesia, período e tema por sinónimo', () => {
    const f = interpretarPergunta(
      'O que mais irrita as pessoas em Azurém este mês sobre estacionamento?',
      {
        hoje: HOJE,
        freguesias: FREGUESIAS,
        temas: TEMAS,
      },
    );
    expect(f.freguesias).toEqual(['Azurém']);
    expect(f.periodo).toEqual({ de: '2026-10-01', ate: HOJE });
    expect(f.tema_ids).toEqual([TEMAS[0].id]);
  });

  it('idosos → lista da ação social; rua → texto; canal', () => {
    const f = interpretarPergunta(
      'Do que se queixam os idosos ao telefone desde a obra da Rua da Universidade?',
      { hoje: HOJE, freguesias: FREGUESIAS, temas: TEMAS },
    );
    expect(f.faixa).toBe('lista_cuidado');
    expect(f.canais).toEqual(['telefone']);
    expect(f.texto).toBe('Rua da Universidade');
    expect(f.tema_ids).toBeUndefined();
  });

  it('parte de uma freguesia composta e períodos', () => {
    const f = interpretarPergunta('E em São Sebastião?', {
      hoje: HOJE,
      freguesias: FREGUESIAS,
      temas: TEMAS,
    });
    expect(f.freguesias).toEqual(['Oliveira, São Paio e São Sebastião']);
    expect(periodoDaPergunta('nos últimos 14 dias', HOJE)).toEqual({
      de: '2026-10-09',
      ate: HOJE,
    });
    expect(periodoDaPergunta('na semana passada', HOJE)).toEqual({
      de: '2026-10-12',
      ate: '2026-10-18',
    });
    expect(periodoDaPergunta('no mês passado', HOJE)).toEqual({
      de: '2026-09-01',
      ate: '2026-09-30',
    });
    expect(periodoDaPergunta('últimas duas semanas', HOJE)).toEqual({
      de: '2026-10-09',
      ate: HOJE,
    });
    expect(periodoDaPergunta('o que sentem?', HOJE)).toBeNull();
  });

  it('os filtros do ecrã ganham; por omissão 30 dias; nunca no futuro', () => {
    const f = resolverFiltros(
      { freguesias: ['Creixomil'], ate: '2030-01-01' },
      { freguesias: ['Azurém'], faixa: 'lista_cuidado' },
      HOJE,
    );
    expect(f.freguesias).toEqual(['Creixomil']);
    expect(f.faixa).toBe('lista_cuidado');
    expect(f.periodo).toEqual({ de: '2026-09-23', ate: HOJE });
    const g = resolverFiltros(
      { faixa: null },
      { faixa: 'lista_cuidado' },
      HOJE,
    );
    expect(g.faixa).toBeNull();
  });
});

function linha(
  id: string,
  tema: string | null,
  extra: Partial<LinhaConversa> = {},
): LinhaConversa {
  return {
    id,
    dia: '2026-10-20',
    canal: 'telefone',
    resultado: 'resolvida',
    tema_id: null,
    tema,
    freguesia: null,
    atual: true,
    ...extra,
  };
}

describe('amostra', () => {
  it('é determinística e não perde temas pequenos', () => {
    const linhas = [
      ...Array.from({ length: 50 }, (_, i) => linha(`a${i}`, 'Vias')),
      ...Array.from({ length: 5 }, (_, i) => linha(`b${i}`, 'Água')),
      linha('c0', null),
    ];
    const a = escolherAmostra(linhas, 9);
    const b = escolherAmostra([...linhas].reverse(), 9);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a).toHaveLength(9);
    expect(a.filter((x) => x.tema === 'Água').length).toBeGreaterThanOrEqual(3);
    expect(a.some((x) => x.tema === null)).toBe(true);
  });

  it('com poucas conversas lê todas', () => {
    expect(
      escolherAmostra([linha('x', 'A'), linha('y', 'B')], 10),
    ).toHaveLength(2);
  });

  it('pára no limite de caracteres e numera C/E', () => {
    const conversas = Array.from({ length: 10 }, (_, i) => ({
      ...linha(`id${i}`, 'Vias'),
      resumo:
        'Queixa-se de não haver estacionamento perto de casa desde a obra.'.repeat(
          3,
        ),
      nomes: ['Ana Beltrana'],
      frases: [
        'Sou a Ana Beltrana e desde a obra não consigo estacionar perto de casa.',
      ],
    }));
    const lidas = prepararLeitura(conversas, {
      permitidas: [],
      maxCaracteres: 900,
      citar: true,
    });
    expect(lidas.length).toBeLessThan(10);
    expect(lidas[0].ref).toBe('C1');
    expect(lidas[0].excertos[0].ref).toBe('E1');
    expect(lidas[0].excertos[0].texto).not.toContain('Ana');
    expect(lidas[0].excertos[0].citavel).toBeNull();
  });
});

describe('números', () => {
  const linhas: LinhaConversa[] = [
    ...Array.from({ length: 9 }, (_, i) =>
      linha(`v${i}`, 'Vias e passeios', {
        freguesia: 'Azurém',
        dia: '2026-10-1' + (i % 9),
      }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      linha(`p${i}`, 'Vias e passeios', {
        freguesia: 'Azurém',
        atual: false,
        dia: '2026-09-10',
      }),
    ),
    linha('r1', 'Resíduos e limpeza', { resultado: 'passada_funcionario' }),
    linha('r2', 'Resíduos e limpeza', { atual: false, dia: '2026-09-12' }),
  ];

  it('conta o período e o anterior e calcula a variação', () => {
    const c = contar(linhas, { de: '2026-09-23', ate: HOJE });
    expect(c.total).toBe(10);
    expect(c.anterior_total).toBe(4);
    expect(c.variacao).toBe(150);
    expect(c.temas[0]).toMatchObject({
      rotulo: 'Vias e passeios',
      n: 9,
      anterior: 3,
      diferenca: 6,
      variacao: 200,
      pct: 90,
    });
    expect(c.freguesias[0]).toMatchObject({ chave: 'Azurém', n: 9 });
    expect(c.sem_freguesia).toBe(1);
    expect(
      c.resultados.find((r) => r.chave === 'passada_funcionario')?.rotulo,
    ).toBe('Passada a funcionário');
    expect(c.semanas.reduce((s, x) => s + x.n, 0)).toBe(14);
    expect(frasesComparacao(c)[0]).toContain('mais 150%');
    expect(frasesComparacao(c)[1]).toBe(
      'Vias e passeios: 9 conversas, mais 6 do que no período anterior (3).',
    );
  });

  it('sinais da semana: freguesia + tema primeiro, sem repetir', () => {
    const s = sinaisDaSemana(
      [
        {
          freguesia: 'Azurém',
          tema_id: TEMAS[0].id,
          tema: 'Vias e passeios',
          n: 9,
          anterior: 2,
        },
        {
          freguesia: 'Creixomil',
          tema_id: TEMAS[1].id,
          tema: 'Resíduos e limpeza',
          n: 2,
          anterior: 0,
        },
        {
          freguesia: 'Urgezes',
          tema_id: TEMAS[2].id,
          tema: 'Água e saneamento',
          n: 3,
          anterior: 3,
        },
      ],
      HOJE,
    );
    expect(s[0].texto).toBe(
      'Azurém: +350% conversas sobre vias e passeios nos últimos 7 dias (9 contra 2)',
    );
    expect(s[0].filtros).toEqual({
      de: '2026-10-16',
      ate: HOJE,
      freguesias: ['Azurém'],
      tema_ids: [TEMAS[0].id],
    });
    expect(s).toHaveLength(1);
  });
});

describe('resposta da IA', () => {
  const lidas: ConversaLida[] = [
    {
      ref: 'C1',
      id: 'id-1',
      dia: '2026-10-20',
      canal: 'telefone',
      tema: 'Vias e passeios',
      freguesia: 'Azurém',
      resultado: 'resolvida',
      resumo: 'r',
      excertos: [
        {
          ref: 'E1',
          texto: 'x',
          citavel: 'Desde a obra não há onde deixar o carro.',
        },
      ],
    },
    {
      ref: 'C2',
      id: 'id-2',
      dia: '2026-10-21',
      canal: 'chat',
      tema: 'Vias e passeios',
      freguesia: 'Azurém',
      resultado: 'resolvida',
      resumo: 'r',
      excertos: [{ ref: 'E2', texto: 'x', citavel: null }],
    },
  ];

  const bruto = {
    sintese:
      'Em Azurém 80% das pessoas queixam-se. Ligue ao Sr. Manuel Couto para o 912345678.',
    temas: [
      {
        tema: 'Estacionamento depois da obra',
        descricao: 'Não há lugares.',
        conversas: ['C1', 'c2', 'C9'],
        causas: [
          { texto: 'A obra tirou lugares', conversas: ['C1'] },
          { texto: 'Sem suporte', conversas: ['C99'] },
        ],
      },
      { tema: 'Inventado', descricao: 'x', conversas: [], causas: [] },
    ],
    irritacao: [
      { conversa: 'C1', nivel: 3 },
      { conversa: 'C2', nivel: 1 },
      { conversa: 'C7', nivel: 2 },
    ],
    citacoes: [
      { excerto: 'E1', tema: 'Estacionamento' },
      { excerto: 'E2', tema: 'Estacionamento' },
    ],
    sugestoes: [
      {
        texto: 'Criar lugares provisórios',
        tema: 'Estacionamento',
        conversas: ['C1'],
      },
      { texto: 'Sem factos', tema: 'x', conversas: [] },
    ],
  };

  it('só referências que existem, números nossos, citações nossas, sem dados pessoais', () => {
    const r = resolverAnaliseIa(bruto, lidas, {
      nomes: [],
      verConversas: true,
      citar: true,
    })!;
    expect(r.temas).toHaveLength(1);
    expect(r.temas[0]).toMatchObject({
      conversas_n: 2,
      conversas: ['id-1', 'id-2'],
      pct_lidas: 100,
      irritacao_media: 2,
      irritacao_rotulo: 'Irritado',
    });
    expect(r.temas[0].causas).toHaveLength(1);
    expect(r.irritacao.conversas_classificadas).toBe(2);
    expect(r.citacoes).toEqual([
      expect.objectContaining({
        texto: 'Desde a obra não há onde deixar o carro.',
        conversa_id: 'id-1',
      }),
    ]);
    expect(r.sugestoes).toHaveLength(1);
    expect(r.sintese).not.toMatch(/80%|Manuel|Couto|912345678/);
    expect(r.texto_verificado).toBe(false);
  });

  it('sem permissão de ver conversas: só a contagem', () => {
    const r = resolverAnaliseIa(bruto, lidas, {
      nomes: [],
      verConversas: false,
      citar: false,
    })!;
    expect(r.temas[0].conversas).toBeNull();
    expect(r.temas[0].conversas_n).toBe(2);
    expect(r.citacoes).toEqual([]);
  });

  it('formato errado: null (fica a versão por contagens)', () => {
    expect(
      resolverAnaliseIa({ temas: 'x' }, lidas, {
        nomes: [],
        verConversas: true,
        citar: true,
      }),
    ).toBeNull();
  });

  it('limpa contagens escritas pela IA', () => {
    expect(
      limparTextoIa('12 pessoas queixam-se e 40% estão irritadas', []).texto,
    ).toBe('várias pessoas queixam-se e parte das conversas estão irritadas');
  });
});
