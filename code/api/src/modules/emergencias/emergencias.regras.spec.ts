import {
  aLigar,
  contarResultados,
  descreverZonaEmergencia,
  Destinatario,
  esquemaZona,
  freguesiaNaLista,
  geometriaEmergencia,
  instanteDoEnvio,
  juntarFontes,
  lerCsvTelefones,
  minutosParaEnviar,
  necessidadesCampanha,
  planear,
  politicaPorGravidade,
  pontoNaZonaEmergencia,
  PRECOS_DEMONSTRACAO,
  resultadoDe,
  ResultadoFonte,
  RITMO_OMISSAO,
  textoSmsEmergencia,
} from './emergencias.regras';
import { FonteExternaNaoConfigurada, FonteLista } from './fontes';

const fonte = (
  id: ResultadoFonte['fonte'],
  tels: string[],
  extra: Partial<ResultadoFonte> = {},
  vulneravel = false,
): ResultadoFonte => ({
  fonte: id,
  nome: id,
  estado: 'ok',
  nota: null,
  candidatos: tels.map((t, i) => ({
    telefone_e164: t,
    municipe_id: `m-${id}-${i}`,
    nome: `Pessoa ${i}`,
    vulneravel,
  })),
  ...extra,
});

describe('zona', () => {
  it('polígono: dentro e fora', () => {
    const z = esquemaZona.parse({
      tipo: 'poligono',
      pontos: [
        { lat: 41, lng: -8 },
        { lat: 41, lng: -7.9 },
        { lat: 41.1, lng: -7.9 },
        { lat: 41.1, lng: -8 },
      ],
    });
    const g = geometriaEmergencia(z);
    expect(pontoNaZonaEmergencia({ lat: 41.05, lng: -7.95 }, g)).toBe(true);
    expect(pontoNaZonaEmergencia({ lat: 41.2, lng: -7.95 }, g)).toBe(false);
    expect(descreverZonaEmergencia(z)).toBe('Na área marcada no mapa');
  });

  it('freguesias: sem geometria, descrição em palavras', () => {
    const z = esquemaZona.parse({
      tipo: 'freguesias',
      freguesias: ['Azurém', 'Creixomil', 'Urgezes'],
    });
    const g = geometriaEmergencia(z);
    expect(g.geo).toBeNull();
    expect(pontoNaZonaEmergencia({ lat: 41, lng: -8 }, g)).toBe(false);
    expect(descreverZonaEmergencia(z)).toBe(
      'Freguesias de Azurém, Creixomil e Urgezes',
    );
  });

  it('ruas não são aceites (a emergência é por área ou freguesia)', () => {
    expect(
      esquemaZona.safeParse({ tipo: 'ruas', ruas: ['Rua Direita'] }).success,
    ).toBe(false);
  });

  it('freguesiaNaLista: acentos, prefixo e uniões de freguesias', () => {
    expect(freguesiaNaLista('azurem', ['Azurém'])).toBe(true);
    expect(freguesiaNaLista('Freguesia de Azurém', ['Azurém'])).toBe(true);
    expect(
      freguesiaNaLista(
        'União das Freguesias de Oliveira, São Paio e São Sebastião',
        ['São Paio'],
      ),
    ).toBe(true);
    expect(freguesiaNaLista('Creixomil', ['Azurém'])).toBe(false);
    expect(freguesiaNaLista(null, ['Azurém'])).toBe(false);
  });
});

describe('lerCsvTelefones', () => {
  it('lê telefones com e sem nome, ignora cabeçalho, comentários e repetidos', () => {
    const r = lerCsvTelefones(
      [
        'telefone;nome',
        '912345678;Maria Silva',
        '# comentário',
        '',
        'João Costa, +351 913 000 111',
        '912345678',
        'abc',
        '12',
      ].join('\n'),
    );
    expect(r.linhas).toEqual([
      { telefone: '+351912345678', nome: 'Maria Silva' },
      { telefone: '+351913000111', nome: 'João Costa' },
    ]);
    expect(r.repetidas).toBe(1);
    expect(r.invalidas.map((x) => x.linha)).toEqual([7, 8]);
  });
});

describe('juntarFontes', () => {
  it('um destinatário por telefone, com todas as fontes; vulnerável primeiro', () => {
    const r = juntarFontes([
      fonte('municipes', ['+351912000001', '+351912000002']),
      fonte('cuidado', ['+351912000002', '+351253000003'], {}, true),
      fonte('lista', ['912000001', '+351912000004', '+351912000004']),
      {
        fonte: 'externa',
        nome: 'externa',
        estado: 'nao_configurada',
        candidatos: [],
        nota: null,
      },
    ]);
    expect(r.por_fonte).toEqual({
      municipes: 2,
      cuidado: 2,
      lista: 2,
      externa: 0,
    });
    expect(r.destinatarios).toHaveLength(4);
    expect(r.em_varias_fontes).toBe(2);
    const d2 = r.destinatarios.find((d) => d.telefone_e164 === '+351912000002');
    expect(d2).toMatchObject({
      fontes: ['municipes', 'cuidado'],
      vulneravel: true,
      sms: true,
      ligavel: true,
    });
    const fixo = r.destinatarios.find(
      (d) => d.telefone_e164 === '+351253000003',
    );
    expect(fixo).toMatchObject({ sms: false, ligavel: true, vulneravel: true });
    expect(r.destinatarios[0].vulneravel).toBe(true);
    expect(
      r.destinatarios.find((d) => d.telefone_e164 === '+351912000001')?.fontes,
    ).toEqual(['municipes', 'lista']);
  });

  it('números de tarifa especial ficam de fora (contados)', () => {
    const r = juntarFontes([fonte('lista', ['+351760000000'])]);
    expect(r.destinatarios).toHaveLength(0);
    expect(r.sem_contacto_possivel).toBe(1);
  });
});

describe('chamadas e ritmo', () => {
  const d = (tel: string, vulneravel: boolean, sms = true): Destinatario => ({
    telefone_e164: tel,
    municipe_id: null,
    nome: null,
    vulneravel,
    fontes: ['lista'],
    sms,
    ligavel: true,
  });
  const lista = [
    d('+351912000001', true),
    d('+351912000002', false),
    d('+351253000003', true, false),
  ];

  it('política por gravidade', () => {
    expect(politicaPorGravidade('aviso')).toBe('nenhuma');
    expect(politicaPorGravidade('alerta')).toBe('vulneraveis');
    expect(politicaPorGravidade('emergencia')).toBe('todos');
    expect(aLigar(lista, 'nenhuma')).toHaveLength(0);
    expect(aLigar(lista, 'vulneraveis')).toHaveLength(2);
    expect(aLigar(lista, 'todos')).toHaveLength(3);
  });

  it('instanteDoEnvio: por minuto, a começar já', () => {
    const inicio = new Date('2026-10-21T03:00:00Z');
    expect(instanteDoEnvio(0, 60, inicio)).toEqual(inicio);
    expect(instanteDoEnvio(59, 60, inicio)).toEqual(inicio);
    expect(instanteDoEnvio(60, 60, inicio).toISOString()).toBe(
      '2026-10-21T03:01:00.000Z',
    );
    expect(instanteDoEnvio(250, 100, inicio).toISOString()).toBe(
      '2026-10-21T03:02:00.000Z',
    );
    expect(minutosParaEnviar(0, 60)).toBe(0);
    expect(minutosParaEnviar(1, 60)).toBe(1);
    expect(minutosParaEnviar(121, 60)).toBe(3);
  });

  it('planear: SMS, chamadas, tempo até todos avisados e custo (demonstração)', () => {
    const p = planear({
      destinatarios: lista,
      politica: 'vulneraveis',
      segmentosPorSms: 2,
      ritmo: { sms_por_minuto: 1, chamadas_por_minuto: 1 },
      ritmoDemonstracao: true,
    });
    expect(p.sms).toEqual({ total: 2, segmentos_por_sms: 2, segmentos: 4 });
    expect(p.chamadas).toEqual({ total: 2, politica: 'vulneraveis' });
    expect(p.tempo.minutos_sms).toBe(2);
    // 2 chamadas a 1/min + 2 min de chamada.
    expect(p.tempo.minutos_chamadas).toBe(4);
    // O fixo só é avisado pela chamada.
    expect(p.tempo.minutos_ate_todos_avisados).toBe(4);
    expect(p.custo).toMatchObject({
      demonstracao: true,
      sms: 4 * PRECOS_DEMONSTRACAO.sms_por_segmento,
      chamadas:
        2 *
        PRECOS_DEMONSTRACAO.minutos_por_chamada *
        PRECOS_DEMONSTRACAO.chamada_por_minuto,
    });
    expect(p.custo.total).toBeCloseTo(p.custo.sms + p.custo.chamadas);
    expect(p.ritmo.demonstracao).toBe(true);
    expect(RITMO_OMISSAO.demonstracao).toBe(true);
  });

  it('planear sem chamadas: só o tempo dos SMS', () => {
    const p = planear({
      destinatarios: lista,
      politica: 'nenhuma',
      segmentosPorSms: 1,
      ritmo: { sms_por_minuto: 60, chamadas_por_minuto: 10 },
      ritmoDemonstracao: false,
    });
    expect(p.chamadas.total).toBe(0);
    expect(p.tempo).toEqual({
      minutos_sms: 1,
      minutos_chamadas: 0,
      minutos_ate_todos_avisados: 1,
    });
  });
});

describe('textoSmsEmergencia', () => {
  it('prefixo da gravidade, instruções e número de emergência', () => {
    const s = textoSmsEmergencia({
      municipio: 'Guimarães',
      gravidade: 'emergencia',
      mensagem: 'Risco de cheia no rio Ave esta noite',
      instrucoes: 'Afaste-se das margens',
      numero: '112',
    });
    expect(s.texto).toBe(
      'EMERGENCIA - CM Guimarães: Risco de cheia no rio Ave esta noite. Afaste-se das margens. Emergencia: 112',
    );
    // Sai sem acentos (GSM-7).
    expect(s.codificacao).toBe('gsm7');
    expect(s.segmentos).toBe(1);
  });
});

describe('resultadoDe e contagens', () => {
  it('a resposta manda; depois a chamada; depois o SMS', () => {
    expect(
      resultadoDe({ resposta: 'precisa_ajuda', chamada: 'bem', sms: null }),
    ).toBe('precisa_ajuda');
    expect(resultadoDe({ resposta: null, chamada: 'bem', sms: null })).toBe(
      'em_seguranca',
    );
    expect(
      resultadoDe({ resposta: null, chamada: 'precisa_ajuda', sms: null }),
    ).toBe('precisa_ajuda');
    expect(
      resultadoDe({ resposta: null, chamada: 'nao_atendeu', sms: 'enviada' }),
    ).toBe('nao_atendeu');
    expect(
      resultadoDe({ resposta: null, chamada: 'a_ligar', sms: 'pendente' }),
    ).toBe('a_ligar');
    expect(
      resultadoDe({ resposta: null, chamada: 'a_ligar', sms: 'entregue' }),
    ).toBe('avisado');
    expect(resultadoDe({ resposta: null, chamada: null, sms: 'enviada' })).toBe(
      'avisado',
    );
    expect(
      resultadoDe({ resposta: null, chamada: null, sms: 'agendada' }),
    ).toBe('por_avisar');
    expect(resultadoDe({ resposta: null, chamada: null, sms: 'falhou' })).toBe(
      'sem_aviso',
    );
  });

  it('contarResultados: avisados inclui quem respondeu e quem não atendeu (teve SMS)', () => {
    const c = contarResultados([
      'avisado',
      'em_seguranca',
      'precisa_ajuda',
      'nao_atendeu',
      'por_avisar',
    ]);
    expect(c).toMatchObject({ total: 5, avisados: 4, precisa_ajuda: 1 });
  });

  it('necessidades da campanha a partir das ajudas', () => {
    expect(
      necessidadesCampanha(['sair_de_casa', 'transporte', 'abrigo']),
    ).toEqual(['transporte', 'outro']);
  });
});

describe('fontes sem BD', () => {
  it('lista: devolve os números carregados', async () => {
    const r = await new FonteLista().procurar({
      municipio: { id: 'x', slug: 'x', nome: 'X', fuso: 'Europe/Lisbon' },
      zona: { geo: null, freguesias: ['A'] },
      lista: [{ telefone: '+351912000001', nome: 'Ana' }],
      desde: new Date(),
    });
    expect(r).toMatchObject({
      fonte: 'lista',
      estado: 'ok',
      candidatos: [{ telefone_e164: '+351912000001', nome: 'Ana' }],
    });
  });

  it('externa: não configurada, sem números', async () => {
    const r = await new FonteExternaNaoConfigurada().procurar();
    expect(r).toMatchObject({
      fonte: 'externa',
      estado: 'nao_configurada',
      candidatos: [],
    });
    expect(r.nota).toMatch(/não configurada/);
  });
});
