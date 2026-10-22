import {
  extrairNumeros,
  lerNumero,
  numerosSemFonteNaConversa,
  resumirNumeros,
  verificarNumeros,
} from './numeros-na-fonte.js';

const so = (texto: string) =>
  extrairNumeros(texto).map((n) =>
    n.unidade ? `${n.tipo}:${n.unidade}:${n.valor}` : `${n.tipo}:${n.valor}`,
  );

describe('lerNumero', () => {
  it.each([
    ['12,50', 12.5],
    ['12.50', 12.5],
    ['1 234,56', 1234.56],
    ['1.234,56', 1234.56],
    ['1.234', 1234],
    ['2.500', 2500],
    ['64,70', 64.7],
    ['30', 30],
    ['0,5', 0.5],
  ])('%s → %d', (s, n) => expect(lerNumero(s)).toBe(n));
});

describe('extrairNumeros', () => {
  it('euros em todas as formas', () => {
    expect(so('A taxa é de 12,50 €.')).toEqual(['euros:12.5']);
    expect(so('Custa 12.50 euros')).toEqual(['euros:12.5']);
    expect(so('São 3,50€ por mês')).toEqual(['euros:3.5']);
    expect(so('Total: 1 234,56 €')).toEqual(['euros:1234.56']);
    expect(so('Total: 1.234,56 EUR')).toEqual(['euros:1234.56']);
    expect(so('€ 15')).toEqual(['euros:15']);
    expect(so('paga 1 euro')).toEqual(['euros:1']);
    expect(so('Tarifa de 2 500,00 €')).toEqual(['euros:2500']);
  });

  it('decimais soltos ("64,70") ficam como número', () => {
    expect(so('O valor da taxa é 64,70.')).toEqual(['numero:64.7']);
  });

  it('percentagens', () => {
    expect(so('Desconto de 15%')).toEqual(['percentagem:15']);
    expect(so('IVA a 23 %')).toEqual(['percentagem:23']);
    expect(so('reduz 2,5 por cento')).toEqual(['percentagem:2.5']);
  });

  it('prazos com unidade', () => {
    expect(so('Tem 30 dias para reclamar')).toEqual(['prazo:dia:30']);
    expect(so('no prazo de 10 dias úteis')).toEqual(['prazo:dia:10']);
    expect(so('demora 2 meses')).toEqual(['prazo:mes:2']);
    expect(so('válido por 1 ano')).toEqual(['prazo:ano:1']);
    expect(so('resposta em 48 horas')).toEqual(['prazo:hora:48']);
    expect(so('espera de 15 min')).toEqual(['prazo:minuto:15']);
    expect(so('2 semanas')).toEqual(['prazo:semana:2']);
  });

  it('horas e horários', () => {
    expect(so('Aberto das 9h às 16h')).toEqual(['hora:09:00', 'hora:16:00']);
    expect(so('das 9 às 16h')).toEqual(['hora:09:00', 'hora:16:00']);
    expect(so('das 9h30 às 12h30')).toEqual(['hora:09:30', 'hora:12:30']);
    expect(so('entre as 9 e as 17 horas')).toEqual([
      'hora:09:00',
      'hora:17:00',
    ]);
    expect(so('horário: 9-16h')).toEqual(['hora:09:00', 'hora:16:00']);
    expect(so('abre às 09:30')).toEqual(['hora:09:30']);
    expect(so('fecha às 18')).toEqual(['hora:18:00']);
    expect(so('a partir das 14 horas')).toEqual(['hora:14:00']);
    expect(so('às 16h00')).toEqual(['hora:16:00']);
  });

  it('"3 a 5 horas" é duração, não horário', () => {
    expect(so('demora de 3 a 5 horas')).toEqual(['prazo:hora:5']);
  });

  it('telefones portugueses', () => {
    expect(so('Ligue 253 421 200')).toEqual(['telefone:253421200']);
    expect(so('Ligue 253421200')).toEqual(['telefone:253421200']);
    expect(so('Ligue 253-421-200')).toEqual(['telefone:253421200']);
    expect(so('Ligue +351 253 421 200')).toEqual(['telefone:253421200']);
    expect(so('Ligue +351253421200')).toEqual(['telefone:253421200']);
    expect(so('Ligue 253 42 12 00')).toEqual(['telefone:253421200']);
    expect(so('Linha verde 800 910 410')).toEqual(['telefone:800910410']);
    expect(so('telemóvel 912 345 678')).toEqual(['telefone:912345678']);
  });

  it('números nacionais (112, SNS 24) não contam', () => {
    expect(so('Ligue 112 ou SNS 24: 808 24 24 24')).toEqual([]);
  });

  it('datas', () => {
    expect(so('até 15/03/2026')).toEqual(['data:2026-03-15']);
    expect(so('até 15-03-26')).toEqual(['data:2026-03-15']);
    expect(so('até 2026-03-15')).toEqual(['data:2026-03-15']);
    expect(so('até 15 de março de 2026')).toEqual(['data:2026-03-15']);
    expect(so('até 15 de Março')).toEqual(['data:03-15']);
    expect(so('no 1.º de maio')).toEqual(['data:05-01']);
  });

  it('áreas e códigos postais', () => {
    expect(so('até 30 m²')).toEqual(['area:30']);
    expect(so('até 12,5 m2')).toEqual(['area:12.5']);
    expect(so('com 200 metros quadrados')).toEqual(['area:200']);
    expect(so('Largo Cónego José Maria Gomes, 4804-534 Guimarães')).toEqual([
      'codigo_postal:4804-534',
    ]);
  });

  it('ignora artigos, diplomas, ordinais, processos, listas, ligações', () => {
    expect(so('nos termos do art. 12.º, n.º 3')).toEqual([]);
    expect(so('artigo 4.º do Regulamento')).toEqual([]);
    expect(so('Decreto-Lei n.º 555/99')).toEqual([]);
    expect(so('Lei n.º 75/2013')).toEqual([]);
    expect(so('o processo 2024/1234')).toEqual([]);
    expect(so('a 2.ª prestação')).toEqual([]);
    expect(so('1. Preencha\n2. Entregue')).toEqual([]);
    expect(
      so('veja https://www.cm-guimaraes.pt/p/2024 ou geral@cm-x.pt'),
    ).toEqual([]);
    expect(so('são 2 documentos')).toEqual([]);
  });

  it('"nos 30 dias" não é tomado por "n.º"', () => {
    expect(so('nos 30 dias seguintes')).toEqual(['prazo:dia:30']);
  });

  it('números soltos com mais de um algarismo', () => {
    expect(so('desde 2019, cerca de 250 pedidos')).toEqual([
      'numero:2019',
      'numero:250',
    ]);
  });

  it('guarda o texto original', () => {
    const [n] = extrairNumeros('Custa 1 234,56 € ao todo');
    expect(n.texto).toBe('1 234,56 €');
  });
});

describe('verificarNumeros', () => {
  const fonte = [
    'Tabela de taxas 2026. Licença de ocupação da via pública: 12,50 euros por mês.',
    'Atendimento: das 9h00 às 16h00. Telefone 253421200.',
    'Prazo de decisão: 30 dias úteis. Redução de 15 % para famílias numerosas.',
  ];

  it('tudo na fonte → semFonte vazio', () => {
    const r = verificarNumeros(
      'A licença custa 12,50 € por mês, decide em 30 dias e há 15% de desconto. Ligue 253 421 200, das 9h às 16h.',
      fonte,
    );
    expect(r.semFonte).toEqual([]);
    expect(r.numeros.map((n) => n.tipo)).toEqual([
      'euros',
      'prazo',
      'percentagem',
      'telefone',
      'hora',
      'hora',
    ]);
  });

  it('marca o que não está na fonte', () => {
    const r = verificarNumeros(
      'Custa 14,50 €, decide em 60 dias, ligue 253 421 999 até às 17h.',
      fonte,
    );
    expect(r.semFonte.map((n) => n.texto)).toEqual([
      '14,50 €',
      '60 dias',
      '253 421 999',
      '17h',
    ]);
    expect(r.numeros.every((n) => !n.naFonte)).toBe(true);
  });

  it('a unidade conta: 15 € não é 15 %', () => {
    const r = verificarNumeros('A taxa é 15 €.', fonte);
    expect(r.semFonte).toHaveLength(1);
  });

  it('número sem unidade na fonte (tabela) vale para qualquer unidade', () => {
    const r = verificarNumeros('A taxa é 64,70 €.', [
      'Licença de obras ..... 64,70',
    ]);
    expect(r.semFonte).toEqual([]);
  });

  it('número solto na resposta vale se o valor está na fonte', () => {
    const r = verificarNumeros('O valor é 12,50.', fonte);
    expect(r.semFonte).toEqual([]);
  });

  it('"9h" na resposta bate com "9 horas" e "às 9" na fonte', () => {
    expect(
      verificarNumeros('Abre às 9h.', ['abre às 9 horas']).semFonte,
    ).toEqual([]);
    expect(verificarNumeros('Abre às 9h.', ['abre às 9']).semFonte).toEqual([]);
    expect(
      verificarNumeros('Abre às 9h.', ['abre 9 horas por dia']).semFonte,
    ).toEqual([]);
  });

  it('datas: com e sem ano', () => {
    const f = ['Inscrições até 15/03/2026.'];
    expect(verificarNumeros('até 15 de março', f).semFonte).toEqual([]);
    expect(verificarNumeros('até 15 de março de 2026', f).semFonte).toEqual([]);
    expect(
      verificarNumeros('até 15 de março de 2025', f).semFonte,
    ).toHaveLength(1);
    expect(
      verificarNumeros('até 15/03/2026', ['até 15 de março']).semFonte,
    ).toEqual([]);
  });

  it('telefone escrito de outra maneira na fonte', () => {
    expect(
      verificarNumeros('Ligue 253 42 12 00', ['Tel.: +351 253 421 200'])
        .semFonte,
    ).toEqual([]);
  });

  it('repetidos contam uma vez', () => {
    const r = verificarNumeros('Custa 20 €. Sim, 20 euros.', []);
    expect(r.numeros).toHaveLength(1);
    expect(r.semFonte).toHaveLength(1);
  });

  it('sem fontes, tudo o que tem número fica sem fonte; sem números, nada', () => {
    expect(verificarNumeros('Custa 20 €.', []).semFonte).toHaveLength(1);
    expect(verificarNumeros('Dirija-se ao balcão.', fonte)).toEqual({
      numeros: [],
      semFonte: [],
    });
  });

  it('artigos citados não são números inventados', () => {
    expect(
      verificarNumeros('Segundo o art. 12.º, n.º 3, do Regulamento.', [])
        .semFonte,
    ).toEqual([]);
  });
});

describe('resposta real do agente', () => {
  it('apanha a taxa inventada no meio de uma resposta longa', () => {
    const trechos = [
      'Cartão de residente: emissão 10,00 €; 2.ª via 5,00 €. O pedido é decidido no prazo de 15 dias úteis. Balcão Único: das 9h00 às 16h00, Tel. 253 421 200.',
    ];
    const r = verificarNumeros(
      'Para o cartão de residente paga 10 € (a 2.ª via custa 7,50 €). A decisão sai em 15 dias úteis. Pode tratar no Balcão Único, das 9h às 16h, ou ligar para o 253 421 200. Segundo o art. 4.º do Regulamento.',
      trechos,
    );
    expect(r.semFonte.map((n) => n.texto)).toEqual(['7,50 €']);
    expect(r.numeros).toHaveLength(6);
  });
});

describe('numerosSemFonteNaConversa', () => {
  const turnos = [
    { id: '1', papel: 'municipe', texto: 'O meu número é 912 345 678.' },
    {
      id: '2',
      papel: 'agente',
      texto: 'A taxa é 12,50 €; ligamos-lhe para o 912 345 678.',
    },
    { id: '3', papel: 'agente', texto: 'O seu pedido é o 4521.' },
    { id: '4', papel: 'agente', texto: 'Custa 99 € e demora 30 dias.' },
  ];

  it('só os turnos do agente com citações; o munícipe também é fonte', () => {
    const r = numerosSemFonteNaConversa(turnos, [
      { turno_id: '2', texto: 'Taxa: 12,50 euros.' },
      { turno_id: '4', texto: 'Prazo: 30 dias.' },
    ]);
    expect(r).toEqual([
      {
        turno_id: '4',
        numeros: [{ texto: '99 €', valor: '99', tipo: 'euros' }],
      },
    ]);
  });

  it('sem citações não há nada a marcar', () => {
    expect(numerosSemFonteNaConversa(turnos, [])).toEqual([]);
  });
});

describe('resumirNumeros', () => {
  it('conta respostas e números sem fonte', () => {
    const r = resumirNumeros([
      { texto: 'Custa 10 €.', fontes: ['10 euros'] },
      { texto: 'Custa 11 € e 12 €.', fontes: ['10 euros'] },
      { texto: 'Dirija-se ao balcão.', fontes: [] },
      { texto: null, fontes: [] },
    ]);
    expect(r).toMatchObject({
      respostas: 4,
      com_numeros: 2,
      com_numeros_sem_fonte: 1,
      numeros_sem_fonte: 2,
      percentagem: 25,
    });
  });

  it('sem respostas, percentagem null', () => {
    expect(resumirNumeros([]).percentagem).toBeNull();
  });
});
