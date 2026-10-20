import type { LinhaResultados } from '../painel/agregados.js';
import {
  aberturaSemIa,
  citacaoSegura,
  conversaEReclamacao,
  emailEReclamacao,
  EntradaDiario,
  escolherCitacoes,
  horaDeGerar,
  horaNoFuso,
  instanteLocal,
  janelaAte,
  janelaDiaria,
  montarDiario,
  numerosConferem,
  pareceReclamacao,
  paraIa,
  picos,
  repetidasPorZona,
  temasDoDia,
  variacaoVsMedia,
  zonaDaMorada,
} from './diario.js';
import { emailDiario, gerarPdfDiario } from './diario-saida.js';
import { escreverAbertura } from './resumo-diario.service.js';

describe('janela das 24 horas no fuso', () => {
  it('das 07:30 de ontem às 07:30 de hoje em Lisboa (verão: UTC+1)', () => {
    const j = janelaDiaria('2026-10-20', 'Europe/Lisbon');
    expect(j.dia).toBe('2026-10-20');
    expect(j.de.toISOString()).toBe('2026-10-19T06:30:00.000Z');
    expect(j.ate.toISOString()).toBe('2026-10-20T06:30:00.000Z');
  });

  it('no inverno é a mesma hora de UTC', () => {
    const j = janelaDiaria('2026-12-15', 'Europe/Lisbon');
    expect(j.de.toISOString()).toBe('2026-12-14T07:30:00.000Z');
    expect(j.ate.toISOString()).toBe('2026-12-15T07:30:00.000Z');
  });

  it('nos Açores é uma hora mais tarde em UTC', () => {
    const j = janelaDiaria('2026-10-20', 'Atlantic/Azores');
    expect(j.ate.toISOString()).toBe('2026-10-20T07:30:00.000Z');
  });

  it('no dia em que a hora muda tem 25 (ou 23) horas', () => {
    // 25 out. 2026: os relógios atrasam uma hora às 02:00.
    const out = janelaDiaria('2026-10-25', 'Europe/Lisbon');
    expect(out.ate.getTime() - out.de.getTime()).toBe(25 * 3600_000);
    // 29 mar. 2026: adiantam uma hora.
    const mar = janelaDiaria('2026-03-29', 'Europe/Lisbon');
    expect(mar.ate.getTime() - mar.de.getTime()).toBe(23 * 3600_000);
  });

  it('pedido à mão: as 24 horas até `ate`, no dia de `ate` no fuso', () => {
    const j = janelaAte(new Date('2026-10-19T23:30:00Z'), 'Europe/Lisbon');
    expect(j.dia).toBe('2026-10-20');
    expect(j.de.toISOString()).toBe('2026-10-18T23:30:00.000Z');
  });

  it('instanteLocal e horaNoFuso batem certo', () => {
    const t = instanteLocal('2026-07-01', '07:30', 'Europe/Lisbon');
    expect(horaNoFuso('Europe/Lisbon', t)).toBe('07:30');
    expect(horaNoFuso('Atlantic/Azores', t)).toBe('06:30');
  });

  it('o job só gera entre as 07:30 e o meio-dia', () => {
    expect(horaDeGerar('07:29')).toBe(false);
    expect(horaDeGerar('07:30')).toBe(true);
    expect(horaDeGerar('11:30')).toBe(true);
    expect(horaDeGerar('12:00')).toBe(false);
  });
});

describe('variação face à média dos 7 dias anteriores', () => {
  it('média por dia e % sobre ela', () => {
    expect(variacaoVsMedia(6, 14)).toEqual({
      media_7d: 2,
      variacao_pct: 200,
      subiu_muito: true,
    });
    expect(variacaoVsMedia(3, 14)).toEqual({
      media_7d: 2,
      variacao_pct: 50,
      subiu_muito: false,
    });
  });

  it('"subiu muito" pede mais do dobro E pelo menos 5 casos', () => {
    expect(variacaoVsMedia(4, 0).subiu_muito).toBe(false); // poucos casos
    expect(variacaoVsMedia(5, 0)).toEqual({
      media_7d: 0,
      variacao_pct: null,
      subiu_muito: true,
    });
    expect(variacaoVsMedia(10, 35).subiu_muito).toBe(false); // exatamente o dobro
    expect(variacaoVsMedia(11, 35).subiu_muito).toBe(true);
  });

  it('temas ordenados e picos com o maior salto primeiro', () => {
    const temas = temasDoDia([
      { tema_id: 'a', tema: 'Água', total: 6, anteriores_7d: 7 },
      { tema_id: 'b', tema: 'Buracos', total: 9, anteriores_7d: 56 },
      { tema_id: 'c', tema: 'Calçada', total: 12, anteriores_7d: 7 },
      { tema_id: 'd', tema: 'Dormente', total: 0, anteriores_7d: 70 },
    ]);
    expect(temas.map((t) => t.tema)).toEqual(['Calçada', 'Buracos', 'Água']);
    expect(picos(temas).map((t) => t.tema)).toEqual(['Calçada', 'Água']);
  });
});

describe('reclamações', () => {
  it('reconhece queixas no texto, sem acentos nem maiúsculas a contar', () => {
    expect(pareceReclamacao('Munícipe apresenta RECLAMAÇÃO sobre o lixo')).toBe(
      true,
    );
    expect(pareceReclamacao('Está insatisfeita com a demora')).toBe(true);
    expect(pareceReclamacao('O buraco continua sem ser tapado')).toBe(true);
    expect(pareceReclamacao('Já liguei várias vezes por causa disto')).toBe(
      true,
    );
    expect(pareceReclamacao('Pediu o horário da piscina')).toBe(false);
    expect(pareceReclamacao(null)).toBe(false);
  });

  it('conversa: tema, resumo ou passagem; motivo "outro" só com texto de queixa', () => {
    const base = {
      id: '1',
      canal: 'telefone',
      tema: 'Recolha de monos',
      resumo: 'Marcou a recolha.',
      resultado: 'resolvida',
      passagens: [],
    };
    expect(conversaEReclamacao(base)).toBe(false);
    expect(conversaEReclamacao({ ...base, tema: 'Reclamações' })).toBe(true);
    expect(
      conversaEReclamacao({
        ...base,
        passagens: [{ motivo: 'outro', resumo: 'Quer falar com alguém.' }],
      }),
    ).toBe(false);
    expect(
      conversaEReclamacao({
        ...base,
        passagens: [
          { motivo: 'outro', resumo: 'Queixa-se do ruído das obras.' },
        ],
      }),
    ).toBe(true);
    expect(
      conversaEReclamacao({
        ...base,
        passagens: [{ motivo: 'reclamacao', resumo: 'x' }],
      }),
    ).toBe(true);
  });

  it('email: classificado como reclamação ou assunto de queixa', () => {
    expect(emailEReclamacao({ id: '1', tema: 'Queixas', assunto: null })).toBe(
      true,
    );
    expect(
      emailEReclamacao({ id: '1', tema: 'Água', assunto: 'Reclamação fatura' }),
    ).toBe(true);
    expect(
      emailEReclamacao({ id: '1', tema: 'Água', assunto: 'Pedido de ligação' }),
    ).toBe(false);
  });

  it('zona: a rua sem número de porta nem código postal', () => {
    expect(zonaDaMorada('Rua de Santo António, 12, 4800-123 Guimarães')).toBe(
      'Rua de Santo António',
    );
    expect(zonaDaMorada('Avenida da Liberdade 230')).toBe(
      'Avenida da Liberdade',
    );
    expect(zonaDaMorada('Rua 25 de Abril, n.º 3')).toBe('Rua 25 de Abril');
    expect(zonaDaMorada('4800-123')).toBe('Sem zona');
  });

  it('ocorrências repetidas agrupadas por categoria e zona', () => {
    const z = repetidasPorZona([
      { numero: 'OC-1', categoria: 'Buraco', morada: 'Rua A, 1', repetidas: 2 },
      {
        numero: 'OC-2',
        categoria: 'Buraco',
        morada: 'Rua A, 40',
        repetidas: 3,
      },
      { numero: 'OC-3', categoria: 'Luz', morada: 'Rua A, 2', repetidas: 1 },
    ]);
    expect(z).toEqual([
      {
        categoria: 'Buraco',
        zona: 'Rua A',
        ocorrencias: ['OC-1', 'OC-2'],
        repetidas: 5,
      },
      { categoria: 'Luz', zona: 'Rua A', ocorrencias: ['OC-3'], repetidas: 1 },
    ]);
  });
});

describe('citações sem dados pessoais', () => {
  it('aceita frases sem nada que identifique', () => {
    expect(
      citacaoSegura(
        'O contentor do lixo está cheio há uma semana e ninguém vem.',
      ),
    ).toBe('O contentor do lixo está cheio há uma semana e ninguém vem.');
    expect(
      citacaoSegura('Liguei para a Câmara de Vila Teste e não atenderam.', [
        'Vila Teste',
      ]),
    ).not.toBeNull();
  });

  it.each([
    ['telefone', 'Podem ligar-me para o 912 345 678 amanhã de manhã?'],
    ['NIF', 'O meu contribuinte é este que está na fatura, confirmem.'],
    ['algarismos', 'Moro no número doze, terceiro esquerdo, há anos.'],
    ['porta', 'O buraco está em frente ao 25 há duas semanas.'],
    ['email', 'Mandem a resposta para ana.silva@gmail.com por favor.'],
    ['rua', 'O candeeiro da rua da escola está apagado há dias.'],
    ['nome', 'Chamo-me Maria e queria saber da minha licença.'],
    ['nome a meio', 'Falei com o Joaquim da junta e ele não resolveu.'],
    ['tratamento', 'O senhor da recolha disse que voltava amanhã.'],
    ['familiar', 'A minha mãe precisa de apoio para ir ao centro de saúde.'],
    ['curta', 'Obrigado.'],
  ])('recusa: %s', (_caso, texto) => {
    expect(citacaoSegura(texto)).toBeNull();
  });

  it('corta no fim de uma frase até 160 caracteres', () => {
    const longa =
      'O caminho está cheio de buracos e os carros desviam para o passeio. ' +
      'Já reportámos isto e continua tudo igual, é perigoso para as crianças que vão a pé. ' +
      'Alguém tem de fazer alguma coisa antes que aconteça um acidente grave aqui.';
    const c = citacaoSegura(longa);
    expect(c).not.toBeNull();
    expect(c!.length).toBeLessThanOrEqual(160);
    expect(c!.endsWith('.')).toBe(true);
  });

  it('escolhe uma por conversa, primeiro as reclamações, no máximo 5', () => {
    const turnos = [
      {
        conversa_id: 'a',
        tema: 'Água',
        texto: 'Queria saber como pago a fatura da água.',
      },
      {
        conversa_id: 'b',
        tema: 'Lixo',
        texto: 'O contentor está cheio há uma semana inteira.',
      },
      {
        conversa_id: 'b',
        tema: 'Lixo',
        texto: 'Já ninguém aguenta o cheiro aqui no bairro.',
      },
      {
        conversa_id: 'c',
        tema: 'Lixo',
        texto: 'O meu NIF é o que está no sistema.',
      },
      ...['d', 'e', 'f', 'g'].map((id) => ({
        conversa_id: id,
        tema: 'Outros',
        texto: 'Queria uma informação sobre os horários do mercado.',
      })),
      {
        conversa_id: 'h',
        tema: 'Outros',
        texto: 'Quando abre a piscina municipal este ano?',
      },
    ];
    const r = escolherCitacoes(turnos, {
      reclamacoes: new Set(['b', 'c']),
      temasTop: ['Água'],
    });
    expect(r[0]).toEqual({
      texto: 'O contentor está cheio há uma semana inteira.',
      tema: 'Lixo',
    });
    expect(r[1].tema).toBe('Água');
    expect(r.map((c) => c.texto)).not.toContain(
      'O meu NIF é o que está no sistema.',
    );
    // texto repetido não entra duas vezes
    expect(r).toHaveLength(4);
  });
});

function linhaCanal(
  canal: string,
  x: Partial<LinhaResultados>,
): LinhaResultados {
  return {
    canal,
    total: 0,
    terminadas: 0,
    resolvidas_sem_humano: 0,
    passadas: 0,
    sem_resposta: 0,
    marcacoes: 0,
    emergencias: 0,
    fora_de_horas: 0,
    duracao_total_s: 0,
    com_duracao: 0,
    ...x,
  };
}

function entrada(x: Partial<EntradaDiario> = {}): EntradaDiario {
  return {
    municipio: { nome: 'Vila Teste', slug: 'vila' },
    fuso: 'Europe/Lisbon',
    janela: janelaDiaria('2026-10-20', 'Europe/Lisbon'),
    porCanal: [
      linhaCanal('telefone', {
        total: 8,
        terminadas: 8,
        resolvidas_sem_humano: 5,
        passadas: 2,
        emergencias: 1,
        fora_de_horas: 3,
      }),
      linhaCanal('chat', { total: 4, terminadas: 4, resolvidas_sem_humano: 4 }),
    ],
    operacao: {
      ocorrencias_novas: 3,
      ocorrencias_resolvidas: 1,
      requerimentos_novos: 2,
      processos_novos: 1,
      pagamentos_pagos: 1,
      pagos_cent: 1500,
      pagamentos_modo_teste: 1,
      chamadas_saida: 2,
      chamadas_saida_atendidas: 1,
    },
    temas: [
      { tema_id: 't1', tema: 'Recolha de monos', total: 6, anteriores_7d: 7 },
      { tema_id: 't2', tema: 'Água', total: 3, anteriores_7d: 14 },
    ],
    conversas: [
      {
        id: 'c1',
        canal: 'telefone',
        tema: 'Recolha de monos',
        resumo: 'Reclamação: a recolha não passou.',
        resultado: 'passada_funcionario',
        passagens: [],
      },
    ],
    emails: [{ id: 'e1', tema: 'Reclamações', assunto: 'Ruído' }],
    repetidas: [
      {
        numero: 'OC-9',
        categoria: 'Buraco na via',
        morada: 'Rua A, 3',
        repetidas: 2,
      },
    ],
    emergencias: [
      { iniciada_em: '2026-10-19T22:10:00Z', canal: 'telefone', tema: null },
    ],
    passagens: {
      total: 1,
      itens: [
        {
          motivo: 'pedido',
          tema: 'Água',
          responder_ate: '2026-10-20T11:00:00Z',
          atribuida_a: 'Ana Técnica',
          atrasada: false,
        },
      ],
    },
    processosHoje: { total: 0, itens: [] },
    turnos: [
      {
        conversa_id: 'c1',
        tema: 'Recolha de monos',
        texto: 'A recolha devia ter passado ontem e não passou ninguém.',
      },
    ],
    ...x,
  };
}

describe('montarDiario', () => {
  it('números, mais pedidos, reclamações, atenção e citações', () => {
    const d = montarDiario(entrada());
    expect(d.periodo).toEqual({ de: '2026-10-20', ate: '2026-10-20' });
    expect(d.janela).toEqual({
      de: '2026-10-19T06:30:00.000Z',
      ate: '2026-10-20T06:30:00.000Z',
      fuso: 'Europe/Lisbon',
    });
    expect(d.numeros).toMatchObject({
      conversas: 12,
      por_canal: { telefone: 8, chat: 4 },
      chamadas: 8,
      escritas: 4,
      resolvidas_sem_humano: 9,
      resolvidas_sem_humano_pct: 75,
      passadas: 2,
      fora_de_horas: 3,
      emergencias: 1,
      pagamentos: { pagos: 1, valor_cent: 1500, modo_teste: 1 },
    });
    expect(d.mais_pedidos[0]).toMatchObject({
      tema: 'Recolha de monos',
      media_7d: 1,
      subiu_muito: true,
    });
    expect(d.reclamacoes).toMatchObject({
      total: 2,
      conversas: 1,
      emails: 1,
      ocorrencias_repetidas: [
        { categoria: 'Buraco na via', zona: 'Rua A', repetidas: 2 },
      ],
    });
    expect(d.atencao.picos.map((t) => t.tema)).toEqual(['Recolha de monos']);
    expect(d.atencao.passagens).toMatchObject({ total: 1, atrasadas: 0 });
    expect(d.citacoes).toHaveLength(1);
  });

  it('para a IA vão só números e temas, nunca as citações', () => {
    const d = montarDiario(entrada());
    const j = JSON.stringify(paraIa(d));
    expect(j).not.toContain('não passou ninguém');
    expect(j).not.toContain('Ana Técnica');
  });
});

describe('abertura', () => {
  it('sem IA: 3 a 4 frases só com os números', () => {
    const d = montarDiario(entrada());
    const t = aberturaSemIa(d);
    const frases = t.split(/(?<=\.)\s+/);
    expect(frases.length).toBeGreaterThanOrEqual(3);
    expect(frases.length).toBeLessThanOrEqual(4);
    expect(t).toContain('12 conversas');
    expect(t).toContain('«Recolha de monos», com 6 casos');
    expect(t).toContain('2 reclamações');
    expect(t).toContain('1 emergência');
    expect(numerosConferem(t, paraIa(d))).toBe(true);
  });

  it('sem conversas nem prazos diz isso mesmo', () => {
    const d = montarDiario(
      entrada({
        porCanal: [],
        temas: [],
        conversas: [],
        emails: [],
        repetidas: [],
        emergencias: [],
        passagens: { total: 0, itens: [] },
        turnos: [],
      }),
    );
    expect(aberturaSemIa(d)).toBe(
      'Nas últimas 24 horas não houve conversas com o agente. Não houve reclamações. Não há nada com prazo para hoje.',
    );
  });

  it('numerosConferem apanha números inventados', () => {
    const dados = { a: 12, b: 62.5, c: 1234 };
    expect(
      numerosConferem('Houve 12 conversas, 62,5% resolvidas.', dados),
    ).toBe(true);
    expect(numerosConferem('Foram 1 234 casos nas 24 horas.', dados)).toBe(
      true,
    );
    expect(numerosConferem('Houve 13 conversas.', dados)).toBe(false);
  });

  it('com IA: usa o texto do Claude se os números baterem; senão o modelo', async () => {
    const d = montarDiario(entrada());
    const claude = (texto: string | Error) => ({
      disponivel: true,
      escrever: jest.fn(() =>
        texto instanceof Error ? Promise.reject(texto) : Promise.resolve(texto),
      ),
    });

    const bom = claude(
      'Houve 12 conversas e 1 emergência. Ficaram 9 resolvidas.',
    );
    expect(await escreverAbertura(bom, d)).toEqual({
      texto: 'Houve 12 conversas e 1 emergência. Ficaram 9 resolvidas.',
      origem: 'ia',
    });
    expect(bom.escrever).toHaveBeenCalledWith(
      expect.objectContaining({ esforco: 'low' }),
    );
    const pedido = bom.escrever.mock.calls[0] as unknown as [
      { sistema: string; conteudo: string },
    ];
    // O sistema fica em cache: sem datas nem nomes do município.
    expect(pedido[0].sistema).not.toContain('Vila Teste');
    expect(pedido[0].sistema).not.toMatch(/\d{4}-\d{2}/);

    const inventa = claude('Houve 40 conversas.');
    expect((await escreverAbertura(inventa, d)).origem).toBe('modelo');
    const falha = claude(new Error('503'));
    expect((await escreverAbertura(falha, d)).origem).toBe('modelo');
    const sem = { disponivel: false, escrever: jest.fn() };
    expect((await escreverAbertura(sem, d)).origem).toBe('modelo');
    expect(sem.escrever).not.toHaveBeenCalled();
  });
});

describe('email e PDF', () => {
  const d = {
    ...montarDiario(entrada()),
    abertura: {
      texto: 'Texto <b>de</b> abertura & mais.',
      origem: 'modelo' as const,
    },
  };

  it('email curto com HTML escapado e o texto simples', () => {
    const e = emailDiario(d);
    expect(e.assunto).toBe('Resumo diário · Vila Teste · 20/10/2026');
    expect(e.texto).toContain('das 07:30 de 19/10/2026 às 07:30 de 20/10/2026');
    expect(e.texto).toContain('Atenção hoje:');
    expect(e.html).toContain(
      'Texto &lt;b&gt;de&lt;/b&gt; abertura &amp; mais.',
    );
    expect(e.html).toContain('width=device-width');
    expect(e.html).toContain(
      '«A recolha devia ter passado ontem e não passou ninguém.»',
    );
  });

  it('PDF de uma página, mesmo com listas cheias', async () => {
    const cheio = {
      ...d,
      citacoes: Array.from({ length: 5 }, () => ({
        texto:
          'Uma frase comprida de um munícipe sobre o estado da estrada e dos passeios do bairro onde vive.',
        tema: 'Vias',
      })),
    };
    const pdf = await gerarPdfDiario(cheio);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const paginas = pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? [];
    expect(paginas).toHaveLength(1);
  });
});
