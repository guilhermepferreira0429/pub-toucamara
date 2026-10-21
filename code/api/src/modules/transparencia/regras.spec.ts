/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- o JSON-LD percorre-se como dados soltos; as asserções verificam a forma. */
import {
  CONJUNTOS,
  FactoConsulta,
  FactoOcorrencia,
  FactoProcesso,
  IDS_CONJUNTOS,
  publicar,
  tabelaAtendimento,
  tabelaConsultas,
  tabelaOcorrencias,
  tabelaProcessos,
  tabelaReclamacoes,
} from './conjuntos.js';
import { catalogoDcat, CONTEXTO_DCAT } from './dcat.js';
import { montarIndicadores, textoValor } from './indicadores.js';
import {
  celulaCsv,
  Coluna,
  fimDoMes,
  LICENCA,
  mesPorExtenso,
  mesValido,
  paraCsv,
  periodoPublicado,
  somarMeses,
  suprimir,
  suprimirLinha,
  tabelar,
} from './regras.js';

describe('transparência · supressão de células pequenas', () => {
  it('0 e ≥ 5 publicam-se; 1 a 4 viram "<5"', () => {
    expect(suprimir(0)).toBe(0);
    expect([1, 2, 3, 4].map(suprimir)).toEqual(['<5', '<5', '<5', '<5']);
    expect(suprimir(5)).toBe(5);
    expect(suprimir(1234)).toBe(1234);
  });

  const colunas: Coluna[] = [
    { nome: 'mes', tipo: 'mes', descricao: '' },
    { nome: 'prazo', tipo: 'inteiro', descricao: '' },
    { nome: 'n', tipo: 'contagem', descricao: '' },
    { nome: 'feitos', tipo: 'contagem', descricao: '' },
    { nome: 'media', tipo: 'decimal', base: 'feitos', descricao: '' },
    { nome: 'pct', tipo: 'percentagem', base: '_com_prazo', descricao: '' },
  ];

  it('médias e percentagens sobre menos de 5 casos ficam em branco', () => {
    expect(
      suprimirLinha(colunas, {
        mes: '2026-10',
        prazo: 3,
        n: 12,
        feitos: 4,
        media: 2.5,
        pct: 50,
        _com_prazo: 4,
      }),
    ).toEqual({
      mes: '2026-10',
      prazo: 3, // inteiro que não conta pessoas: não se mexe
      n: 12,
      feitos: '<5',
      media: null,
      pct: null,
    });
    expect(
      suprimirLinha(colunas, {
        mes: '2026-10',
        prazo: 3,
        n: 12,
        feitos: 6,
        media: 2.5,
        pct: 50,
        _com_prazo: 5,
      }),
    ).toEqual({
      mes: '2026-10',
      prazo: 3,
      n: 12,
      feitos: 6,
      media: 2.5,
      pct: 50,
    });
  });

  it('as chaves internas ("_") e as que não são colunas não saem', () => {
    const l = suprimirLinha(colunas, {
      mes: '2026-10',
      n: 7,
      feitos: 0,
      media: null,
      pct: null,
      _com_prazo: 9,
      telefone: '+351912345678',
    });
    expect(Object.keys(l)).toEqual(colunas.map((c) => c.nome));
    expect(JSON.stringify(l)).not.toContain('912345678');
  });

  it('as linhas e os totais publicados de um conjunto passam todos pela regra', () => {
    const fs: FactoOcorrencia[] = [
      ...Array.from({ length: 6 }, () => ({
        mes: '2026-10',
        categoria: 'Buraco na via',
        freguesia: 'Azurém',
        aberta: false,
        horas: 48,
      })),
      ...Array.from({ length: 2 }, () => ({
        mes: '2026-10',
        categoria: 'Iluminação pública',
        freguesia: 'Azurém',
        aberta: true,
        horas: null,
      })),
    ];
    const t = publicar(
      CONJUNTOS.ocorrencias,
      tabelaOcorrencias(fs, ['2026-09', '2026-10']),
    );
    expect(t.linhas).toEqual([
      {
        mes: '2026-10',
        categoria: 'Buraco na via',
        freguesia: 'Azurém',
        reportadas: 6,
        resolvidas: 6,
        em_aberto: 0,
        tempo_medio_resolucao_dias: 2,
      },
      {
        mes: '2026-10',
        categoria: 'Iluminação pública',
        freguesia: 'Azurém',
        reportadas: '<5',
        resolvidas: 0,
        em_aberto: '<5',
        tempo_medio_resolucao_dias: null,
      },
    ]);
    expect(t.resumo['2026-10']).toEqual({
      reportadas: 8,
      resolvidas: 6,
      em_aberto: '<5',
      tempo_medio_resolucao_dias: 2,
    });
    // Mês sem nada: zeros, sem médias.
    expect(t.resumo['2026-09']).toEqual({
      reportadas: 0,
      resolvidas: 0,
      em_aberto: 0,
      tempo_medio_resolucao_dias: null,
    });
  });
});

describe('transparência · CSV', () => {
  it('escapa vírgulas, aspas e mudanças de linha (RFC 4180)', () => {
    expect(celulaCsv('simples')).toBe('simples');
    expect(celulaCsv('Oliveira, São Paio e São Sebastião')).toBe(
      '"Oliveira, São Paio e São Sebastião"',
    );
    expect(celulaCsv('a "praça" nova')).toBe('"a ""praça"" nova"');
    expect(celulaCsv('linha 1\nlinha 2')).toBe('"linha 1\nlinha 2"');
    expect(celulaCsv(' espaço ')).toBe('" espaço "');
    expect(celulaCsv(null)).toBe('');
    expect(celulaCsv(12.5)).toBe('12.5');
    expect(celulaCsv(-3)).toBe('-3');
    expect(celulaCsv('<5')).toBe('<5');
  });

  it('um texto que pareceria uma fórmula ganha um apóstrofo', () => {
    expect(celulaCsv('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(celulaCsv('+351')).toBe("'+351");
    expect(celulaCsv('-')).toBe("'-");
    expect(celulaCsv('@soma')).toBe("'@soma");
  });

  it('cabeçalho com os nomes das colunas, linhas por ordem, CRLF no fim', () => {
    const colunas: Coluna[] = [
      { nome: 'mes', tipo: 'mes', descricao: '' },
      { nome: 'servico', tipo: 'texto', descricao: '' },
      { nome: 'n', tipo: 'contagem', descricao: '' },
      { nome: 'pct', tipo: 'percentagem', base: 'n', descricao: '' },
    ];
    expect(
      paraCsv(colunas, [
        { mes: '2026-10', servico: 'Águas, saneamento', n: 7, pct: 71.4 },
        { mes: '2026-10', servico: 'Obras', n: '<5', pct: null },
      ]),
    ).toBe(
      'mes,servico,n,pct\r\n' +
        '2026-10,"Águas, saneamento",7,71.4\r\n' +
        '2026-10,Obras,<5,\r\n',
    );
    expect(paraCsv(colunas, [])).toBe('mes,servico,n,pct\r\n');
  });
});

describe('transparência · meses', () => {
  it('12 meses até hoje, a atravessar o ano', () => {
    const p = periodoPublicado('2026-03-15');
    expect(p.de).toBe('2025-04-01');
    expect(p.ate).toBe('2026-03-15');
    expect(p.meses).toHaveLength(12);
    expect(p.meses[0]).toBe('2025-04');
    expect(p.meses[11]).toBe('2026-03');
  });

  it('somar meses, fim do mês e por extenso', () => {
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
    expect(somarMeses('2026-12', 1)).toBe('2027-01');
    expect(fimDoMes('2028-02')).toBe('2028-02-29');
    expect(fimDoMes('2026-04')).toBe('2026-04-30');
    expect(mesPorExtenso('2026-10')).toBe('outubro de 2026');
    expect(mesValido('2026-13')).toBe(false);
    expect(mesValido('2026-1')).toBe(false);
    expect(mesValido('2026-09')).toBe(true);
  });

  it('tabelar ordena pelas dimensões', () => {
    const t = tabelar(
      [
        { mes: '2026-10', s: 'Obras' },
        { mes: '2026-09', s: 'Obras' },
        { mes: '2026-10', s: 'Águas' },
        { mes: '2026-10', s: 'Águas' },
      ],
      ['mes', 's'],
      (g) => ({ n: g.length }),
    );
    expect(t).toEqual([
      { mes: '2026-09', s: 'Obras', n: 1 },
      { mes: '2026-10', s: 'Águas', n: 2 },
      { mes: '2026-10', s: 'Obras', n: 1 },
    ]);
  });
});

describe('transparência · contas dos conjuntos', () => {
  const feriados = new Set<string>();

  it('processos: entrados pelo mês de entrada, tempos e prazo pelo mês da decisão', () => {
    const base = {
      tipo_codigo: 'CP',
      tipo: 'Comunicação prévia',
      prazo_legal_dias_uteis: 20,
    };
    const fs: FactoProcesso[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        ...base,
        mes: '2026-10',
        kind: 'entrada' as const,
        completo: i < 5,
      })),
      // Seg 2026-10-05 → seg 2026-10-12: 5 dias úteis; dentro do prazo.
      ...Array.from({ length: 5 }, () => ({
        ...base,
        mes: '2026-10',
        kind: 'decisao' as const,
        entrada: '2026-10-05',
        decisao: '2026-10-12',
        prazo_fim: '2026-10-30',
      })),
      ...Array.from({ length: 5 }, () => ({
        ...base,
        mes: '2026-10',
        kind: 'decisao' as const,
        entrada: '2026-10-05',
        decisao: '2026-10-12',
        prazo_fim: '2026-10-09',
      })),
    ];
    const t = publicar(
      CONJUNTOS.processos,
      tabelaProcessos(fs, ['2026-10'], feriados),
    );
    expect(t.linhas).toEqual([
      {
        mes: '2026-10',
        tipo_codigo: 'CP',
        tipo: 'Comunicação prévia',
        prazo_legal_dias_uteis: 20,
        entrados: 10,
        completos_a_primeira_pct: 50,
        decididos: 10,
        tempo_medio_decisao_dias_uteis: 5,
        dentro_do_prazo_pct: 50,
      },
    ]);
    // 9 de 10 dentro do prazo: a percentagem deixava ler o "1" fora dele.
    const quase = publicar(
      CONJUNTOS.processos,
      tabelaProcessos(fs.slice(0, 19), ['2026-10'], feriados),
    );
    expect(quase.linhas[0]).toMatchObject({
      decididos: 9,
      dentro_do_prazo_pct: null,
    });
  });

  it('atendimento: soma os canais no total do mês', () => {
    const linha = (canal: string, conversas: number, resolvidas: number) => ({
      mes: '2026-10',
      canal,
      conversas,
      resolvidas,
      passadas: conversas - resolvidas,
      sem_resposta: 0,
      fora_de_horas: 1,
      duracao_total_s: conversas * 120,
      com_duracao: conversas,
    });
    const t = publicar(
      CONJUNTOS.atendimento,
      tabelaAtendimento(
        [linha('telefone', 12, 5), linha('chat', 3, 3)],
        ['2026-10'],
      ),
    );
    expect(t.linhas.find((l) => l.canal === 'chat')).toMatchObject({
      conversas: '<5',
      resolvidas_pelo_agente_pct: null,
      duracao_media_minutos: null,
    });
    expect(t.linhas.find((l) => l.canal === 'telefone')).toMatchObject({
      conversas: 12,
      resolvidas_pelo_agente: 5,
      resolvidas_pelo_agente_pct: 41.7,
    });
    expect(t.resumo['2026-10']).toMatchObject({
      conversas: 15,
      resolvidas_pelo_agente: 8,
      resolvidas_pelo_agente_pct: 53.3,
      duracao_media_minutos: 2,
    });
  });

  it('reclamações: no prazo é responder até à data-limite; em atraso por responder depois dela', () => {
    const r = (respondida: string | null, ate = '2026-10-20') => ({
      mes: '2026-10',
      servico: 'Urbanismo',
      recebida_em: '2026-10-05',
      responder_ate: ate,
      respondida_dia: respondida,
    });
    const bruta = tabelaReclamacoes(
      [
        r('2026-10-06'),
        r('2026-10-07'),
        r('2026-10-08'),
        r('2026-10-09'),
        r('2026-10-21'),
        r(null),
        r(null, '2026-10-30'),
      ],
      ['2026-10'],
      '2026-10-25',
      feriados,
    );
    expect(bruta.linhas[0].respondidas_no_prazo_pct).toBe(80);
    const t = publicar(CONJUNTOS.reclamacoes, bruta);
    expect(t.linhas[0]).toMatchObject({
      recebidas: 7,
      respondidas: 5,
      respondidas_no_prazo: '<5',
      // 4 de 5: a percentagem deixava adivinhar as contagens escondidas.
      respondidas_no_prazo_pct: null,
      em_atraso: '<5',
      // 1, 2, 3, 4 e 12 dias úteis
      tempo_medio_resposta_dias_uteis: 4.4,
    });
  });

  it('consultas: reaproveita o agregar das consultas, com as freguesias da câmara', () => {
    const c: FactoConsulta = {
      codigo: 'ABCD2345',
      titulo: 'Nova praça',
      fecha_em: '2026-09-30',
      freguesias: ['Azurém', 'Creixomil'],
      perguntas: [
        {
          id: 'p1',
          texto: 'Concorda?',
          opcoes: [
            { id: 'sim', texto: 'Sim' },
            { id: 'nao', texto: 'Não' },
          ],
        },
      ],
      participacoes: [
        ...Array.from({ length: 6 }, () => ({
          respostas: { p1: 'sim' },
          freguesia: 'Azurém',
        })),
        { respostas: { p1: 'nao' }, freguesia: 'Azurém' },
        { respostas: { p1: 'nao' }, freguesia: null },
        ...Array.from({ length: 10 }, (_, i) => ({
          respostas: { p1: i % 2 ? 'sim' : 'nao' },
          freguesia: 'Creixomil',
        })),
      ],
    };
    const t = publicar(CONJUNTOS['consultas-publicas'], tabelaConsultas([c]));
    const azurem = t.linhas.filter((l) => l.freguesia === 'Azurém');
    expect(azurem).toEqual([
      expect.objectContaining({
        opcao: 'Sim',
        respostas: 6,
        respostas_freguesia: 7,
        pct: null, // 6 de 7 deixava ler o 1 do "Não"
      }),
      expect.objectContaining({
        opcao: 'Não',
        respostas: '<5',
        respostas_freguesia: 7,
        pct: null,
      }),
    ]);
    expect(
      t.linhas
        .filter((l) => l.freguesia === 'Creixomil')
        .map((l) => [l.opcao, l.respostas, l.pct]),
    ).toEqual([
      ['Sim', 5, 50],
      ['Não', 5, 50],
    ]);
    expect(
      t.linhas.find((l) => l.freguesia === 'Sem freguesia indicada'),
    ).toMatchObject({ respostas_freguesia: '<5', pct: null });
  });

  it('todos os conjuntos têm metadados completos e colunas com tipo e descrição', () => {
    for (const id of IDS_CONJUNTOS) {
      const d = CONJUNTOS[id];
      expect(d.id).toBe(id);
      expect(d.titulo.length).toBeGreaterThan(10);
      expect(d.descricao.length).toBeGreaterThan(20);
      expect(d.palavras_chave.length).toBeGreaterThan(0);
      const nomes = d.colunas.map((c) => c.nome);
      expect(new Set(nomes).size).toBe(nomes.length);
      for (const c of d.colunas) {
        expect(c.descricao.length).toBeGreaterThan(3);
        expect(c.nome).toMatch(/^[a-z][a-z0-9_]*$/);
        if (c.tipo === 'decimal' || c.tipo === 'percentagem') {
          expect(c.base).toBeDefined();
        }
      }
      // Nada que pareça um dado pessoal nas colunas.
      expect(nomes.join(' ')).not.toMatch(
        /nome|telefone|nif|email|morada|municipe|opiniao|descricao/,
      );
    }
  });
});

describe('transparência · DCAT-AP', () => {
  const doc = catalogoDcat({
    municipio: { slug: 'guimaraes', nome: 'Guimarães', email: 'geral@cm.pt' },
    base: 'https://api.exemplo.pt/v1/public/dados/guimaraes',
    pagina: null,
    conjuntos: (['ocorrencias', 'atendimento'] as const).map((id, i) => ({
      def: CONJUNTOS[id],
      publicacao: {
        id: `p${i}`,
        gerado_em: `2026-10-2${i}T04:23:00.000Z`,
        primeira_em: '2026-09-01T04:23:00.000Z',
        periodo_de: '2025-11-01',
        periodo_ate: '2026-10-21',
        bytes_csv: 1000 + i,
        bytes_json: 2000 + i,
      },
    })),
  });

  /** Todas as chaves com prefixo usam um prefixo declarado no @context. */
  function prefixos(v: unknown, acc = new Set<string>()): Set<string> {
    if (Array.isArray(v)) v.forEach((x) => prefixos(x, acc));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (!k.startsWith('@')) acc.add(k.split(':')[0]);
        if (k === '@type' && typeof x === 'string') acc.add(x.split(':')[0]);
        prefixos(x, acc);
      }
    }
    return acc;
  }

  it('é um dcat:Catalog com o @context e só prefixos declarados', () => {
    expect(doc['@context']).toEqual(CONTEXTO_DCAT);
    expect(doc['@type']).toBe('dcat:Catalog');
    expect(doc['@id']).toBe(
      'https://api.exemplo.pt/v1/public/dados/guimaraes/catalogo.jsonld',
    );
    for (const p of prefixos(doc)) {
      expect(Object.keys(CONTEXTO_DCAT)).toContain(p);
    }
    expect(doc['dct:publisher']).toMatchObject({
      '@type': 'foaf:Agent',
      'foaf:name': 'Município de Guimarães',
    });
    expect(doc['dct:modified']).toEqual({
      '@value': '2026-10-21T04:23:00.000Z',
      '@type': 'xsd:dateTime',
    });
  });

  it('cada dcat:Dataset tem o obrigatório do DCAT-AP e duas distribuições', () => {
    const ds = doc['dcat:dataset'] as Record<string, any>[];
    expect(ds).toHaveLength(2);
    for (const d of ds) {
      expect(d['@type']).toBe('dcat:Dataset');
      expect(typeof d['@id']).toBe('string');
      expect(d['dct:title']['@value']).toBeTruthy();
      expect(d['dct:description']['@value']).toBeTruthy();
      expect(d['dct:identifier']).toMatch(/^guimaraes\//);
      expect(d['dct:accrualPeriodicity']['@id']).toBe(
        'http://publications.europa.eu/resource/authority/frequency/DAILY',
      );
      expect(d['dcat:contactPoint']['vcard:hasEmail']).toEqual({
        '@id': 'mailto:geral@cm.pt',
      });
      expect(d['dct:temporal']['dcat:startDate']['@value']).toBe('2025-11-01');
      const dist = d['dcat:distribution'] as Record<string, any>[];
      expect(dist.map((x) => x['dct:format']['@id'])).toEqual([
        'http://publications.europa.eu/resource/authority/file-type/CSV',
        'http://publications.europa.eu/resource/authority/file-type/JSON',
      ]);
      for (const x of dist) {
        expect(x['@type']).toBe('dcat:Distribution');
        expect(x['dcat:accessURL']['@id']).toBe(d['@id']);
        expect(x['dcat:downloadURL']['@id']).toMatch(
          new RegExp(`^${d['@id']}\\.(csv|json)$`),
        );
        expect(x['dct:license']['@id']).toBe(LICENCA.uri);
        expect(x['dcat:byteSize']['@type']).toBe('xsd:nonNegativeInteger');
      }
    }
  });

  it('sem email nem conjuntos continua válido', () => {
    const vazio = catalogoDcat({
      municipio: { slug: 'x', nome: 'X', email: null },
      base: 'https://a/v1/public/dados/x',
      pagina: null,
      conjuntos: [],
    });
    expect(vazio['dcat:dataset']).toEqual([]);
    expect(vazio['dct:modified']).toBeUndefined();
  });
});

describe('transparência · indicadores', () => {
  it('texto em português, "<5" e sem dados', () => {
    expect(textoValor(73.5, '%')).toBe('73,5 %');
    expect(textoValor(1, 'dias')).toBe('1 dia');
    expect(textoValor(2.25, 'dias úteis')).toBe('2,3 dias úteis');
    expect(textoValor(1234, 'número')).toMatch(/^1\s?234$/);
    expect(textoValor('<5', 'número')).toBe('Menos de 5');
    expect(textoValor(null, '%')).toBe('Sem dados suficientes');
  });

  it('só os conjuntos publicados, com a data e a ligação à origem', () => {
    const itens = montarIndicadores('2026-09', {
      ocorrencias: {
        resumo: {
          '2026-09': {
            reportadas: 40,
            resolvidas: 30,
            em_aberto: 10,
            tempo_medio_resolucao_dias: 3.2,
          },
        },
        gerado_em: '2026-10-21T04:23:00.000Z',
        url: 'https://a/ocorrencias',
        csv: 'https://a/ocorrencias.csv',
      },
    });
    expect(itens.map((i) => i.id)).toEqual([
      'ocorrencias_resolvidas',
      'tempo_medio_resolucao_ocorrencias',
    ]);
    expect(itens[0]).toMatchObject({
      valor: 30,
      de: 40,
      texto: '30 de 40',
      mes_por_extenso: 'setembro de 2026',
      atualizado_em: '2026-10-21T04:23:00.000Z',
      fonte: { url: 'https://a/ocorrencias', coluna: 'resolvidas' },
    });
    // Mês fora do que foi publicado: sem valor.
    expect(
      montarIndicadores('2020-01', {
        ocorrencias: {
          resumo: {},
          gerado_em: '',
          url: '',
          csv: '',
        },
      })[0].valor,
    ).toBeNull();
  });
});
