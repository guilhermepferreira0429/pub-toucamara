import {
  cabeNoSms,
  ContextoNormalizar,
  correspondeSubscricao,
  cursorAgora,
  distanciaAZona,
  filtrarEOrdenar,
  fraseItem,
  ItemInterno,
  itemNovo,
  lerCursorAgora,
  moradaSemPorta,
  naZona,
  normalizarAvisoZona,
  normalizarComunicado,
  normalizarConsulta,
  normalizarEmergencia,
  normalizarEvento,
  normalizarLicenca,
  normalizarOcorrencia,
  noPeriodo,
  paraResposta,
  periodoDoQuando,
  pessoaColetiva,
  podeAvisarAgora,
  relevancia,
  semNumeroDePorta,
  textoAvisoSubscricao,
} from './agora.regras';

const C: ContextoNormalizar = {
  webUrl: 'https://toucamara.pt',
  slug: 'guimaraes',
  fuso: 'Europe/Lisbon',
  freguesias: [
    'Azurém',
    'Creixomil',
    'União das Freguesias de Oliveira, São Paio e São Sebastião',
  ],
};
// Quinta-feira, 22 de outubro de 2026, 11h em Lisboa.
const AGORA = new Date('2026-10-22T10:00:00Z');
const CENTRO = { lat: 41.4425, lng: -8.2918 };

function licenca(
  tipo: string,
  dados: Record<string, unknown>,
  titular: string | null = null,
) {
  return normalizarLicenca(
    {
      id: '00000000-0000-0000-0000-00000000000a',
      tipo,
      dados,
      decidida_em: new Date('2026-10-20T09:00:00Z'),
      titular,
      local_lat: CENTRO.lat,
      local_lng: CENTRO.lng,
      local_freguesia: null,
    },
    C,
  );
}

describe('moradas sem dados pessoais', () => {
  it('tira o número de porta e fica só a rua', () => {
    expect(semNumeroDePorta('Rua Direita, 45, 2.º Esq.')).toBe('Rua Direita');
    expect(semNumeroDePorta('Rua Direita 45')).toBe('Rua Direita');
    expect(semNumeroDePorta('Rua Direita n.º 45')).toBe('Rua Direita');
    expect(semNumeroDePorta('Rua 25 de Abril 12')).toBe('Rua 25 de Abril');
    expect(
      semNumeroDePorta('em frente ao n.º 45 da Rua de Santo António'),
    ).toBe('Rua de Santo António');
    expect(semNumeroDePorta('Av. da Liberdade 120B')).toBe('Av. da Liberdade');
    expect(semNumeroDePorta('')).toBeNull();
  });

  it('morada para geocodificar sem porta, com a freguesia', () => {
    expect(moradaSemPorta('Rua Direita, 45, Azurém')).toBe(
      'Rua Direita, Azurém',
    );
    expect(moradaSemPorta('Rua Direita 45, 2.º Esq, Creixomil')).toBe(
      'Rua Direita, Creixomil',
    );
  });

  it('só as entidades aparecem como organizadoras', () => {
    expect(pessoaColetiva('Associação Recreativa de Azurém')).toBe(true);
    expect(pessoaColetiva('Junta de Freguesia de Creixomil')).toBe(true);
    expect(pessoaColetiva('Café Central, Lda.')).toBe(true);
    expect(pessoaColetiva('Maria da Silva Costa')).toBe(false);
    expect(pessoaColetiva(null)).toBe(false);
  });
});

describe('normalização de cada fonte', () => {
  it('licença de ocupação da via → obras, sem morada completa nem titular', () => {
    const i = licenca(
      'ocupacao_via',
      {
        equipamento: 'andaime',
        descricao: 'pintar a casa do Sr. Joaquim',
        morada: 'Rua Direita, 45, Azurém',
        data_inicio: '2026-10-20',
        dias: 10,
        area_m2: 6,
        passeio_livre_m: 1.2,
        ocupa_estrada: false,
        nome: 'Joaquim Ferreira',
      },
      'Joaquim Ferreira',
    )!;
    expect(i).toMatchObject({
      tipo: 'obras',
      fonte: 'licenca',
      titulo: 'Andaime na via pública',
      rua: 'Rua Direita',
      freguesia: 'Azurém',
      lat: CENTRO.lat,
    });
    expect(i.resumo).toBe('De 20/10 a 29/10; passeio livre: 1,2 m.');
    expect(JSON.stringify(i)).not.toMatch(/Joaquim|45/);
    // Depois da mudança da hora (25/10) Lisboa fica em UTC+0.
    expect(i.fim).toBe('2026-10-29T23:59:59.000Z');
  });

  it('recinto: título genérico; o organizador só se for entidade', () => {
    const dados = {
      descricao: 'festa de anos da Joana',
      morada: 'Largo da Oliveira',
      data_inicio: '2026-10-24',
      dias: 2,
      lotacao: 200,
      estruturas: ['palco'],
      musica: true,
    };
    const pessoa = licenca('recinto_improvisado', dados, 'Joana Martins')!;
    expect(pessoa.titulo).toBe('Arraial ou festa ao ar livre');
    expect(JSON.stringify(pessoa)).not.toMatch(/Joana/);
    const assoc = licenca(
      'recinto_improvisado',
      dados,
      'Associação Cultural da Oliveira',
    )!;
    expect(assoc.resumo).toContain(
      'Organização: Associação Cultural da Oliveira.',
    );
    expect(assoc.tipo).toBe('eventos');
  });

  it('ruído: evento entra com as horas (passa da meia-noite); festa privada não', () => {
    const e = licenca('ruido', {
      atividade: 'evento',
      morada: 'Rua de Santa Maria 3',
      data: '2026-10-24',
      hora_inicio: '21:00',
      hora_fim: '02:00',
      musica_amplificada: true,
    })!;
    expect(e.titulo).toBe('Evento com música');
    expect(e.resumo).toBe('24/10, das 21:00 às 02:00.');
    expect(e.fim).toBe('2026-10-25T02:00:00.000Z');
    expect(
      licenca('ruido', {
        atividade: 'festa_privada',
        morada: 'Rua X 1',
        data: '2026-10-24',
        hora_inicio: '20:00',
        hora_fim: '23:00',
      }),
    ).toBeNull();
    expect(licenca('esplanada', { morada: 'Rua X' })).toBeNull();
    expect(
      licenca('ruido', {
        atividade: 'obra',
        morada: 'Rua X 1',
        data: '2026-10-24',
        hora_inicio: '20:00',
        hora_fim: '23:00',
      })!.tipo,
    ).toBe('obras');
  });

  it('aviso por zona: tipo pelo assunto, zona com o círculo, visível 7 dias', () => {
    const a = normalizarAvisoZona(
      {
        id: 'a1',
        titulo: 'Corte de trânsito',
        mensagem: 'Rua fechada amanhã das 9h às 13h.',
        tipo: 'transito',
        zona: { tipo: 'ruas', ruas: ['Rua Direita'] },
        geometria: { circulos: [{ ...CENTRO, raio_m: 150 }], poligono: null },
        zona_descricao: 'Rua Direita',
        agendado_para: new Date('2026-10-21T09:00:00Z'),
        confirmado_em: null,
      },
      C,
    );
    expect(a).toMatchObject({
      tipo: 'obras',
      raio_m: 150,
      rua: 'Rua Direita',
      gravidade: null,
    });
    expect(a.fim).toBe('2026-10-28T09:00:00.000Z');
  });

  it('emergência: avisos, com gravidade e freguesias', () => {
    const e = normalizarEmergencia(
      {
        id: 'e1',
        tipo: 'cheia',
        gravidade: 'emergencia',
        titulo: 'Cheia no rio Ave',
        mensagem_sms: 'Saia das zonas baixas.',
        instrucoes: 'Suba para um andar alto.',
        geometria: { geo: null, freguesias: ['Creixomil'] },
        zona_descricao: 'Freguesia de Creixomil',
        enviada_em: new Date('2026-10-22T08:00:00Z'),
        valida_ate: new Date('2026-10-23T08:00:00Z'),
      },
      C,
    );
    expect(e).toMatchObject({
      tipo: 'avisos',
      gravidade: 'emergencia',
      freguesia: 'Creixomil',
      todo_concelho: false,
    });
    expect(e.resumo).toContain('112');
  });

  it('ocorrência: sem descrição nem número de porta, coordenadas arredondadas', () => {
    const o = normalizarOcorrencia(
      {
        id: 'o1',
        categoria: 'Buraco na via',
        estado: 'com_equipa',
        morada: 'Rua Direita 45, Azurém',
        lat: 41.442512,
        lng: -8.291876,
        criada_em: new Date('2026-10-21T10:00:00Z'),
        resolvida_em: null,
        prevista_para: '2026-10-27',
        local_lat: null,
        local_lng: null,
        local_freguesia: null,
      },
      C,
    );
    expect(o).toMatchObject({
      tipo: 'incidentes',
      titulo: 'Buraco na via',
      rua: 'Rua Direita',
      lat: 41.443,
      lng: -8.292,
      freguesia: 'Azurém',
    });
    expect(o.resumo).toBe(
      'Com a equipa da câmara; intervenção prevista para 27/10.',
    );
    expect(JSON.stringify(o)).not.toContain('45');
  });

  it('comunicado, evento e consulta', () => {
    const geral = normalizarComunicado(
      {
        id: 'c1',
        tipo: 'noticia',
        titulo: 'Nova biblioteca',
        texto: 'Abre em novembro.',
        imagem_url: 'https://x.pt/a.jpg',
        freguesias: null,
        publicado_em: new Date('2026-10-21T10:00:00Z'),
      },
      C,
    );
    expect(geral).toMatchObject({
      tipo: 'avisos',
      etiqueta: 'Notícia',
      todo_concelho: true,
      imagem: 'https://x.pt/a.jpg',
    });
    const ev = normalizarEvento(
      {
        id: 'v1',
        titulo: 'Feira de São Martinho',
        descricao: 'Castanhas e vinho novo.',
        local: 'Largo do Toural',
        lat: CENTRO.lat,
        lng: CENTRO.lng,
        inicio: new Date('2026-11-11T10:00:00Z'),
        fim: null,
        freguesia: 'Oliveira',
        link: null,
        publicado_em: new Date('2026-10-20T10:00:00Z'),
      },
      C,
    );
    expect(ev).toMatchObject({
      tipo: 'eventos',
      rua: 'Largo do Toural',
      link: 'https://toucamara.pt/agora/guimaraes/eventos/v1',
    });
    const q = normalizarConsulta(
      {
        id: 'q1',
        codigo: 'ABC',
        titulo: 'Plano de mobilidade',
        resumo: 'Novas ciclovias.',
        freguesias: null,
        abre_em: '2026-10-01',
        fecha_em: '2026-10-31',
        aberta_em: null,
      },
      C,
    );
    expect(q).toMatchObject({
      tipo: 'consultas',
      link: 'https://toucamara.pt/consulta/ABC',
      todo_concelho: true,
    });
    expect(q.resumo).toContain('até 31 de outubro');
  });
});

function item(p: Partial<ItemInterno> & { id: string }): ItemInterno {
  return {
    tipo: 'obras',
    fonte: 'licenca',
    etiqueta: 'Obras',
    titulo: p.id,
    resumo: '',
    inicio: '2026-10-20T00:00:00.000Z',
    fim: '2026-10-30T00:00:00.000Z',
    publicado_em: '2026-10-20T00:00:00.000Z',
    lat: null,
    lng: null,
    raio_m: null,
    poligono: null,
    freguesia: null,
    freguesias: null,
    todo_concelho: false,
    rua: null,
    gravidade: null,
    link: 'x',
    imagem: null,
    zona: { circulos: [], poligono: null },
    ...p,
  };
}

/** ~111 m por milésimo de grau de latitude. */
const norte = (metros: number) => ({
  lat: CENTRO.lat + metros / 111_195,
  lng: CENTRO.lng,
});

describe('zona e distância', () => {
  it('haversine a círculos (0 lá dentro) e polígono', () => {
    const z = { circulos: [{ ...CENTRO, raio_m: 100 }], poligono: null };
    expect(distanciaAZona(norte(50), z)).toBe(0);
    expect(distanciaAZona(norte(300), z)).toBeGreaterThan(195);
    expect(distanciaAZona(norte(300), z)).toBeLessThan(205);
    const quadrado = {
      circulos: [],
      poligono: [
        { lat: 41.44, lng: -8.3 },
        { lat: 41.45, lng: -8.3 },
        { lat: 41.45, lng: -8.28 },
        { lat: 41.44, lng: -8.28 },
      ],
    };
    expect(distanciaAZona(CENTRO, quadrado)).toBe(0);
    expect(
      distanciaAZona({ lat: 41.46, lng: -8.29 }, quadrado),
    ).toBeGreaterThan(1000);
    expect(distanciaAZona(CENTRO, { circulos: [], poligono: null })).toBeNull();
  });

  it('raio, freguesia e todo o concelho', () => {
    const perto = item({
      id: 'perto',
      zona: { circulos: [{ ...norte(200), raio_m: 0 }], poligono: null },
    });
    const longe = item({
      id: 'longe',
      zona: { circulos: [{ ...norte(3000), raio_m: 0 }], poligono: null },
    });
    const freg = item({ id: 'freg', freguesias: ['Azurém'] });
    const geral = item({ id: 'geral', todo_concelho: true });
    const f = { ponto: CENTRO, raio_m: 500 };
    expect(naZona(perto, f).inclui).toBe(true);
    expect(naZona(longe, f).inclui).toBe(false);
    expect(naZona(freg, f).inclui).toBe(false);
    expect(naZona(geral, f).inclui).toBe(true);
    expect(naZona(freg, { freguesia: 'azurem' }).inclui).toBe(true);
    expect(naZona(perto, { freguesia: 'Azurém' }).inclui).toBe(false);
    expect(naZona(longe, {}).inclui).toBe(true);
  });

  it('período: sobreposição, e sem fim = a decorrer', () => {
    const de = new Date('2026-10-24T00:00:00Z');
    const ate = new Date('2026-10-25T23:59:00Z');
    expect(
      noPeriodo(
        { inicio: '2026-10-20T00:00:00Z', fim: '2026-10-30T00:00:00Z' },
        de,
        ate,
      ),
    ).toBe(true);
    expect(
      noPeriodo(
        { inicio: '2026-10-20T00:00:00Z', fim: '2026-10-21T00:00:00Z' },
        de,
        ate,
      ),
    ).toBe(false);
    expect(
      noPeriodo({ inicio: '2026-10-01T00:00:00Z', fim: null }, de, ate),
    ).toBe(true);
    expect(
      noPeriodo({ inicio: '2026-11-01T00:00:00Z', fim: null }, de, ate),
    ).toBe(false);
  });

  it('quando: hoje e fim de semana no fuso', () => {
    const hoje = periodoDoQuando('hoje', AGORA, 'Europe/Lisbon');
    expect(hoje.de.toISOString()).toBe('2026-10-21T23:00:00.000Z');
    const fds = periodoDoQuando('fim_de_semana', AGORA, 'Europe/Lisbon');
    expect(fds.de.toISOString()).toBe('2026-10-23T23:00:00.000Z');
    // 25 de outubro: muda a hora (fica UTC+0).
    expect(fds.ate.toISOString()).toBe('2026-10-25T23:59:59.000Z');
  });
});

describe('relevância e ordem', () => {
  it('mais perto, a decorrer e mais grave primeiro; emergência à frente', () => {
    const perto = item({
      id: 'perto',
      zona: { circulos: [{ ...norte(100), raio_m: 0 }], poligono: null },
    });
    const longe = item({
      id: 'longe',
      zona: { circulos: [{ ...norte(900), raio_m: 0 }], poligono: null },
    });
    const futuro = item({
      id: 'futuro',
      inicio: '2026-11-15T00:00:00.000Z',
      fim: '2026-11-16T00:00:00.000Z',
      zona: { circulos: [{ ...norte(100), raio_m: 0 }], poligono: null },
    });
    const emergencia = item({
      id: 'emergencia',
      fonte: 'emergencia',
      tipo: 'avisos',
      gravidade: 'emergencia',
      zona: { circulos: [{ ...norte(1500), raio_m: 0 }], poligono: null },
    });
    const r = filtrarEOrdenar([longe, futuro, perto, emergencia], {
      ponto: CENTRO,
      raio_m: 2000,
      tipos: ['obras'],
      agora: AGORA,
    });
    expect(r.map((x) => x.id)).toEqual([
      'emergencia',
      'perto',
      'longe',
      'futuro',
    ]);
    expect(r[1].distancia_m).toBeLessThan(110);
    expect(relevancia(perto, 100, AGORA)).toBeGreaterThan(
      relevancia(perto, 800, AGORA),
    );
  });

  it('não repete o mesmo item e respeita os tipos', () => {
    const a = item({ id: 'a' });
    const b = item({ id: 'b', tipo: 'eventos' });
    const r = filtrarEOrdenar([a, a, b], { agora: AGORA, tipos: ['eventos'] });
    expect(r.map((x) => x.id)).toEqual(['b']);
  });

  it('a resposta não leva a geometria interna; cursor por posição', () => {
    expect(paraResposta(item({ id: 'a' }))).not.toHaveProperty('zona');
    expect(lerCursorAgora(cursorAgora(20))).toBe(20);
    expect(lerCursorAgora('lixo')).toBe(-1);
    expect(lerCursorAgora(undefined)).toBe(0);
  });

  it('frase para o agente', () => {
    expect(
      fraseItem(
        item({ id: 'x', titulo: 'Andaime na via pública', rua: 'Rua Direita' }),
        AGORA,
        'Europe/Lisbon',
      ),
    ).toBe('Andaime na via pública (Rua Direita), até 30 de outubro');
  });
});

describe('subscrições', () => {
  const sub = {
    id: 's1',
    municipe_id: 'm1',
    tipos: ['obras' as const],
    lat: CENTRO.lat,
    lng: CENTRO.lng,
    raio_m: 300,
    freguesia: null,
    criada_em: new Date('2026-10-19T00:00:00Z'),
  };

  it('bate pelo tipo, pela zona e só no que apareceu depois', () => {
    const obra = item({
      id: 'o',
      zona: { circulos: [{ ...norte(100), raio_m: 0 }], poligono: null },
    });
    expect(correspondeSubscricao(obra, sub)).toBe(true);
    expect(correspondeSubscricao({ ...obra, tipo: 'eventos' }, sub)).toBe(
      false,
    );
    expect(
      correspondeSubscricao(
        {
          ...obra,
          zona: { circulos: [{ ...norte(900), raio_m: 0 }], poligono: null },
        },
        sub,
      ),
    ).toBe(false);
    expect(
      correspondeSubscricao(
        { ...obra, publicado_em: '2026-10-18T00:00:00.000Z' },
        sub,
      ),
    ).toBe(false);
    const porFreguesia = {
      ...sub,
      lat: null,
      lng: null,
      raio_m: null,
      freguesia: 'Azurém',
    };
    expect(
      correspondeSubscricao({ ...obra, freguesias: ['Azurém'] }, porFreguesia),
    ).toBe(true);
  });

  it('o que é de todo o concelho só dispara se for alerta ou emergência', () => {
    const geral = item({ id: 'g', tipo: 'avisos', todo_concelho: true });
    const s = { ...sub, tipos: ['avisos' as const] };
    expect(correspondeSubscricao(geral, s)).toBe(false);
    expect(
      correspondeSubscricao({ ...geral, gravidade: 'emergencia' }, s),
    ).toBe(true);
  });

  it('à noite só emergências; item novo = apareceu há menos de 48 h', () => {
    const noite = new Date('2026-10-22T22:30:00Z');
    expect(podeAvisarAgora(item({ id: 'a' }), noite, 'Europe/Lisbon')).toBe(
      false,
    );
    expect(
      podeAvisarAgora(
        item({ id: 'a', gravidade: 'emergencia' }),
        noite,
        'Europe/Lisbon',
      ),
    ).toBe(true);
    expect(podeAvisarAgora(item({ id: 'a' }), AGORA, 'Europe/Lisbon')).toBe(
      true,
    );
    expect(
      itemNovo(
        item({ id: 'a', publicado_em: '2026-10-21T12:00:00.000Z' }),
        AGORA,
      ),
    ).toBe(true);
    expect(
      itemNovo(
        item({ id: 'a', publicado_em: '2026-10-10T12:00:00.000Z' }),
        AGORA,
      ),
    ).toBe(false);
  });

  it('o SMS do aviso cabe em 2 partes GSM-7', () => {
    const t = textoAvisoSubscricao({
      municipio: 'Guimarães',
      item: item({
        id: 'a',
        etiqueta: 'Ocupação da via',
        titulo:
          'Andaime na via pública com um título muito comprido que não devia caber todo no SMS de jeito nenhum mesmo',
        rua: 'Rua de Santo António das Necessidades e Arredores',
      }),
      link: 'https://toucamara.pt/agora/guimaraes/obras/00000000-0000-0000-0000-000000000000',
      agora: AGORA,
      fuso: 'Europe/Lisbon',
    });
    expect(t).toMatch(/^CM Guimaraes: Ocupacao da via perto de si - Andaime/);
    expect(t).toContain('responda PARAR');
    expect(cabeNoSms(t)).toBe(true);
  });
});
