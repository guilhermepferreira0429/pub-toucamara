import {
  caixaDaZona,
  contarPorOrigem,
  deduplicar,
  dentroDaJanela,
  dentroDoRaio,
  descreverZona,
  esquemaZona,
  geometriaDaZona,
  juntarComE,
  mascararNome,
  moradaAfetada,
  MoradaMunicipe,
  normalizarRua,
  palavraChave,
  pontoNaZona,
  pontoNoPoligono,
  proximaJanela,
  quandoEnviar,
  ruaDaMorada,
  telefoneParaSms,
  textoSms,
} from './avisos-zona.regras.js';

const FUSO = 'Europe/Lisbon';
const QUADRADO = [
  { lat: 41.0, lng: -8.0 },
  { lat: 41.0, lng: -7.99 },
  { lat: 41.01, lng: -7.99 },
  { lat: 41.01, lng: -8.0 },
];

describe('pontoNoPoligono', () => {
  it('dentro e fora de um quadrado', () => {
    expect(pontoNoPoligono({ lat: 41.005, lng: -7.995 }, QUADRADO)).toBe(true);
    expect(pontoNoPoligono({ lat: 41.02, lng: -7.995 }, QUADRADO)).toBe(false);
    expect(pontoNoPoligono({ lat: 41.005, lng: -8.01 }, QUADRADO)).toBe(false);
  });

  it('polígono côncavo (em L): a reentrância fica fora', () => {
    const l = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 1, lng: 2 },
      { lat: 1, lng: 1 },
      { lat: 2, lng: 1 },
      { lat: 2, lng: 0 },
    ];
    expect(pontoNoPoligono({ lat: 0.5, lng: 1.5 }, l)).toBe(true);
    expect(pontoNoPoligono({ lat: 1.5, lng: 0.5 }, l)).toBe(true);
    expect(pontoNoPoligono({ lat: 1.5, lng: 1.5 }, l)).toBe(false);
  });

  it('menos de 3 pontos nunca contém nada', () => {
    expect(pontoNoPoligono({ lat: 0, lng: 0 }, QUADRADO.slice(0, 2))).toBe(
      false,
    );
  });
});

describe('dentroDoRaio e pontoNaZona', () => {
  const centro = { lat: 41.44, lng: -8.29 };
  it('~100 m a norte: dentro de 150 m, fora de 50 m', () => {
    const p = { lat: 41.44 + 100 * 0.000009, lng: -8.29 };
    expect(dentroDoRaio(p, centro, 150)).toBe(true);
    expect(dentroDoRaio(p, centro, 50)).toBe(false);
  });

  it('zona com vários círculos (várias ruas) e polígono', () => {
    const g = geometriaDaZona(
      {
        tipo: 'ruas',
        ruas: ['Rua A', 'Rua B'],
        raio_m: 100,
      },
      new Map([
        ['Rua A', centro],
        ['Rua B', { lat: 41.45, lng: -8.29 }],
      ]),
    );
    expect(g.circulos).toHaveLength(2);
    expect(pontoNaZona({ lat: 41.45, lng: -8.29 }, g)).toBe(true);
    expect(pontoNaZona({ lat: 41.445, lng: -8.29 }, g)).toBe(false);
    const pg = geometriaDaZona({ tipo: 'poligono', pontos: QUADRADO });
    expect(pontoNaZona({ lat: 41.005, lng: -7.995 }, pg)).toBe(true);
  });

  it('caixaDaZona contém os círculos e o polígono; sem coordenadas é null', () => {
    const g = geometriaDaZona({
      tipo: 'ponto',
      lat: 41,
      lng: -8,
      raio_m: 1000,
    });
    const c = caixaDaZona(g)!;
    expect(c.minLat).toBeLessThan(41 - 0.0089);
    expect(c.maxLng).toBeGreaterThan(-8 + 0.0118);
    expect(
      caixaDaZona(
        geometriaDaZona({ tipo: 'ruas', ruas: ['Rua X'], raio_m: 100 }),
      ),
    ).toBeNull();
  });
});

describe('ruas', () => {
  it.each([
    ['Rua Direita, 45', 'Rua Direita'],
    ['Rua Direita 45, 2.º Esq.', 'Rua Direita'],
    ['Rua 25 de Abril 12', 'Rua 25 de Abril'],
    ['Av. da Liberdade, n.º 300', 'Av. da Liberdade'],
    ['Rua Direita nº 7', 'Rua Direita'],
    ['Rua Direita 45 (em frente à farmácia)', 'Rua Direita'],
    ['Rua de Santo António 12-A', 'Rua de Santo António'],
  ])('ruaDaMorada(%s) = %s', (morada, rua) => {
    expect(ruaDaMorada(morada)).toBe(rua);
  });

  it('normalizarRua: sem acentos, R. = Rua, Av. = Avenida, sem nº de porta', () => {
    expect(normalizarRua('R. de Santo António, 12')).toBe(
      'rua de santo antonio',
    );
    expect(normalizarRua('Rua de Santo Antonio 3')).toBe(
      'rua de santo antonio',
    );
    expect(normalizarRua('Av. Dom João IV, n.º 4')).toBe('avenida dom joao iv');
    expect(normalizarRua('AVENIDA DOM JOÃO IV')).toBe('avenida dom joao iv');
    expect(normalizarRua('na Rua Direita 45')).toBe('rua direita');
    expect(normalizarRua('Lg. do Toural')).toBe('largo do toural');
    expect(normalizarRua('')).toBe('');
  });

  it('moradaAfetada: pelo nome (sem coordenadas) ou pelas coordenadas', () => {
    const g = geometriaDaZona(
      { tipo: 'ruas', ruas: ['Rua de Santo António'], raio_m: 100 },
      new Map([['Rua de Santo António', { lat: 41, lng: -8 }]]),
    );
    const base: MoradaMunicipe = {
      origem: 'recolha',
      municipe_id: '1',
      morada: 'R. Santo Antonio 5',
      lat: null,
      lng: null,
      telefone_e164: '+351912345678',
      nome: null,
      aceita_avisos: true,
      anonimizado: false,
    };
    // 'de' faz parte do nome: sem ele não é a mesma rua.
    expect(moradaAfetada(base, g)).toBe(false);
    expect(
      moradaAfetada({ ...base, morada: 'R. de Santo António, 5' }, g),
    ).toBe(true);
    expect(
      moradaAfetada(
        { ...base, morada: 'Outra rua 3', lat: 41.0005, lng: -8 },
        g,
      ),
    ).toBe(true);
    expect(
      moradaAfetada({ ...base, morada: 'Outra rua 3', lat: 41.01, lng: -8 }, g),
    ).toBe(false);
  });

  it('palavraChave: a mais comprida que não é o tipo de via', () => {
    expect(palavraChave('rua de santo antonio')).toBe('antonio');
    expect(palavraChave('avenida dom joao iv')).toBe('joao');
    expect(palavraChave('rua')).toBeNull();
  });
});

describe('telefoneParaSms', () => {
  it.each([
    ['+351912345678', true],
    ['+351962345678', true],
    ['+351253000000', false], // fixo
    ['+351800000000', false],
    ['+447911123456', true],
    ['+12', false],
    [null, false],
  ])('%s → %s', (t, ok) => {
    expect(telefoneParaSms(t)).toBe(ok);
  });
});

describe('deduplicar', () => {
  const m = (o: Partial<MoradaMunicipe>): MoradaMunicipe => ({
    origem: 'processo',
    municipe_id: 'a',
    morada: 'Rua Direita 1',
    lat: null,
    lng: null,
    telefone_e164: '+351910000001',
    nome: 'Ana Silva',
    aceita_avisos: true,
    anonimizado: false,
    ...o,
  });

  it('um por munícipe, com as origens todas; e um por telefone', () => {
    const { afetados, excluidos } = deduplicar(
      [
        m({ origem: 'processo' }),
        m({ origem: 'ocorrencia' }),
        m({ origem: 'processo' }),
        m({ municipe_id: 'b', origem: 'recolha' }), // mesmo telefone
        m({ municipe_id: 'c', telefone_e164: '+351910000003' }),
      ],
      { ignorarRecusa: false },
    );
    expect(afetados).toHaveLength(2);
    expect(afetados[0]).toMatchObject({
      municipe_id: 'a',
      origens: ['ocorrencia', 'processo', 'recolha'],
      rua: 'Rua Direita',
    });
    expect(excluidos).toEqual({
      sem_telefone: 0,
      recusaram_avisos: 0,
      anonimizados: 0,
    });
  });

  it('fora: anonimizados, sem telemóvel e quem recusou (salvo emergência)', () => {
    const linhas = [
      m({ municipe_id: 'x', anonimizado: true }),
      m({ municipe_id: 'y', telefone_e164: '+351253000000' }),
      m({ municipe_id: 'z', telefone_e164: null }),
      m({
        municipe_id: 'w',
        aceita_avisos: false,
        telefone_e164: '+351910000009',
      }),
      m({
        municipe_id: 'w',
        aceita_avisos: false,
        telefone_e164: '+351910000009',
      }),
    ];
    const normal = deduplicar(linhas, { ignorarRecusa: false });
    expect(normal.afetados).toHaveLength(0);
    expect(normal.excluidos).toEqual({
      sem_telefone: 2,
      recusaram_avisos: 1,
      anonimizados: 1,
    });
    const emergencia = deduplicar(linhas, { ignorarRecusa: true });
    expect(emergencia.afetados.map((a) => a.municipe_id)).toEqual(['w']);
  });

  it('contarPorOrigem conta cada pessoa em cada origem que tem', () => {
    const { afetados } = deduplicar(
      [
        m({ origem: 'processo' }),
        m({ origem: 'ocorrencia' }),
        m({ municipe_id: 'c', telefone_e164: '+351910000003' }),
      ],
      { ignorarRecusa: false },
    );
    expect(contarPorOrigem(afetados)).toEqual({
      processo: 2,
      ocorrencia: 1,
      recolha: 0,
      requerimento: 0,
    });
  });

  it('mascararNome: só iniciais', () => {
    expect(mascararNome('Maria da Silva')).toBe('M. S.');
    expect(mascararNome('joão')).toBe('J.');
    expect(mascararNome(null)).toBe('—');
  });
});

describe('janela horária (9h-21h no fuso)', () => {
  // 20 out. 2026: Lisboa em UTC+1 (hora de verão).
  it('dentro: devolve o mesmo instante', () => {
    const t = new Date('2026-10-20T10:00:00Z'); // 11h
    expect(dentroDaJanela(t, FUSO)).toBe(true);
    expect(proximaJanela(t, FUSO)).toEqual(t);
  });

  it('de madrugada: às 9h do mesmo dia', () => {
    expect(proximaJanela(new Date('2026-10-20T04:00:00Z'), FUSO)).toEqual(
      new Date('2026-10-20T08:00:00Z'),
    );
  });

  it('às 21h30: às 9h do dia seguinte (fim de semana incluído)', () => {
    expect(proximaJanela(new Date('2026-10-23T20:30:00Z'), FUSO)).toEqual(
      new Date('2026-10-24T08:00:00Z'),
    );
  });

  it('na mudança de hora (25 out.): 9h locais = 9h UTC', () => {
    expect(proximaJanela(new Date('2026-10-24T21:00:00Z'), FUSO)).toEqual(
      new Date('2026-10-25T09:00:00Z'),
    );
  });

  it('quandoEnviar: emergência vai já, a qualquer hora; o resto espera', () => {
    const agora = new Date('2026-10-20T01:00:00Z'); // 2h
    expect(
      quandoEnviar({ tipo: 'emergencia', pedido: null, agora, fuso: FUSO }),
    ).toEqual(agora);
    expect(
      quandoEnviar({ tipo: 'agua', pedido: null, agora, fuso: FUSO }),
    ).toEqual(new Date('2026-10-20T08:00:00Z'));
    // Pedido no passado conta como já.
    expect(
      quandoEnviar({
        tipo: 'obras',
        pedido: new Date('2026-10-19T12:00:00Z'),
        agora: new Date('2026-10-20T12:00:00Z'),
        fuso: FUSO,
      }),
    ).toEqual(new Date('2026-10-20T12:00:00Z'));
    // Pedido no futuro, dentro da janela: fica.
    const pedido = new Date('2026-10-21T14:00:00Z');
    expect(
      quandoEnviar({ tipo: 'transito', pedido, agora, fuso: FUSO }),
    ).toEqual(pedido);
  });
});

describe('textoSms', () => {
  const url = 'https://toucamara.pt/r/8K2F9Q';

  it('título, mensagem e link; GSM-7 num só SMS', () => {
    const s = textoSms({
      municipio: 'Teste',
      titulo: 'Corte de agua',
      mensagem: 'Na Rua X amanha das 9h as 13h.',
      url,
      tipo: 'agua',
    });
    expect(s.texto).toBe(
      `CM Teste: Corte de agua. Na Rua X amanha das 9h as 13h. Mais info/deixar de receber: ${url}`,
    );
    expect(s).toMatchObject({ codificacao: 'gsm7', segmentos: 1 });
  });

  it('não repete o título; emergência começa por URGENTE', () => {
    const s = textoSms({
      municipio: 'Teste',
      titulo: 'Incendio',
      mensagem: 'Incendio no monte: feche janelas',
      url,
      tipo: 'emergencia',
    });
    expect(s.texto).toBe(
      `URGENTE - CM Teste: Incendio no monte: feche janelas. Mais info/deixar de receber: ${url}`,
    );
  });

  it('com acentos passa a UCS-2 e conta mais segmentos', () => {
    const s = textoSms({
      municipio: 'Guimarães',
      titulo: 'Recolha do lixo',
      mensagem:
        'A recolha de resíduos na sua rua passa a ser às terças e sextas, a partir de 1 de novembro. Obrigado pela compreensão.',
      url,
      tipo: 'residuos',
    });
    expect(s.codificacao).toBe('ucs2');
    expect(s.segmentos).toBe(Math.ceil(s.texto.length / 67));
    expect(s.segmentos).toBeGreaterThan(1);
  });
});

describe('zona', () => {
  it('esquemaZona: ruas com raio por omissão; polígono precisa de 3 pontos', () => {
    expect(
      esquemaZona.parse({ tipo: 'ruas', ruas: ['Rua Direita'] }),
    ).toMatchObject({ raio_m: 150 });
    expect(
      esquemaZona.safeParse({ tipo: 'poligono', pontos: QUADRADO.slice(0, 2) })
        .success,
    ).toBe(false);
  });

  it('geometriaDaZona: ruas não encontradas ficam só pelo nome', () => {
    const g = geometriaDaZona(
      { tipo: 'ruas', ruas: ['Rua A 3', 'R. B'], raio_m: 100 },
      new Map([['Rua A 3', { lat: 1, lng: 2 }]]),
    );
    expect(g.circulos).toEqual([{ lat: 1, lng: 2, raio_m: 100 }]);
    expect(g.ruas).toEqual(['rua a', 'rua b']);
    expect(g.ruas_sem_coordenadas).toEqual(['R. B']);
  });

  it('descreverZona em palavras', () => {
    expect(
      descreverZona({
        tipo: 'ruas',
        ruas: ['Rua A, 3', 'Rua B', 'Rua C'],
        raio_m: 150,
      }),
    ).toBe('Rua A, Rua B e Rua C');
    expect(descreverZona({ tipo: 'ponto', lat: 1, lng: 1, raio_m: 1500 })).toBe(
      'Num raio de 1,5 km à volta do local indicado no mapa',
    );
    expect(
      descreverZona({
        tipo: 'poligono',
        pontos: QUADRADO,
        descricao: 'Centro histórico',
      }),
    ).toBe('Centro histórico');
    expect(juntarComE(['A'])).toBe('A');
  });
});
