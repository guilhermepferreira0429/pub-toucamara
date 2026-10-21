/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { LicencasService } from '../../src/modules/licencas/licencas.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  novaChamada,
  smsPara,
} from './app';

/** Um dia útil daqui a ~3 semanas (AAAA-MM-DD). */
function daquiA(dias = 21): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Outras licenças simples decididas na chamada (ocupação da via pública,
 * esplanada, dístico de residente) e "testar uma lei antes de a aprovar"
 * contra os pedidos antigos.
 */
describe('Licenças: outros tipos e simulação de regras (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  async function pagar(processoId: string) {
    const l = await linha(
      ctx.db,
      `SELECT lc.codigo FROM pagamentos pg
       JOIN links_curtos lc ON lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
       WHERE pg.processo_id = $1 ORDER BY lc.expira_em DESC LIMIT 1`,
      [processoId],
    );
    await ctx
      .http()
      .post(`/v1/public/pagamentos/${l.codigo}/simular-pagamento`)
      .send({})
      .expect((r) => expect([200, 201]).toContain(r.status));
  }

  async function licencaDe(numero: string) {
    const l = await linha<{
      id: string;
      estado: string;
      tipo: string;
      processo_id: string;
      codigo: string;
    }>(
      ctx.db,
      `SELECT l.id, l.estado, l.tipo, l.processo_id, t.codigo
       FROM licencas l JOIN processos p ON p.id = l.processo_id
       JOIN tipos_processo t ON t.id = p.tipo_processo_id
       WHERE p.numero = $1`,
      [numero],
    );
    if (!l) throw new Error(`Licença ${numero} não existe.`);
    return l;
  }

  async function pdfDe(codigo: string) {
    const pdf = await ctx
      .http()
      .get(`/v1/public/licencas/${codigo}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  }

  const andaime = (p: object = {}) => ({
    equipamento: 'andaime',
    descricao: 'Pintar a fachada do prédio',
    morada: 'Rua de Santo António 10, Guimarães',
    data_inicio: daquiA(),
    dias: 10,
    area_m2: 12,
    passeio_livre_m: 1.5,
    nome: 'Obras Silva Lda',
    ...p,
  });

  it('ocupação da via pública: andaime dentro das regras → MB WAY de teste → aprovar → página e PDF', async () => {
    const chamada = novaChamada('ovp');
    const r = await ferramenta(
      ctx,
      chamada,
      'pedir_licenca_ocupacao_via',
      andaime(),
    ).expect(200);
    expect(r.body).toMatchObject({
      pedida: true,
      tipo: 'ocupacao_via',
      numero: expect.stringMatching(/^OVP \d+\/\d{4}$/),
      proposta: 'aprovar',
      // 10 € + 12 m² × 10 dias × 0,50 €
      pagamento: { modo_teste: true, metodo: 'mbway', valor_cent: 7000 },
      regras_de_demonstracao: true,
      dizer: expect.stringContaining(
        'licença de ocupação da via pública segue por SMS',
      ),
    });
    const l = await licencaDe(r.body.numero);
    expect(l).toMatchObject({
      estado: 'a_pagar',
      tipo: 'ocupacao_via',
      codigo: 'OVP',
    });

    await pagar(l.processo_id);
    const lista = await ctx
      .http()
      .get('/v1/painel/licencas?tipo=ocupacao_via')
      .set(chefe)
      .expect(200);
    expect(
      lista.body.licencas.every(
        (x: { tipo: string }) => x.tipo === 'ocupacao_via',
      ),
    ).toBe(true);
    expect(
      lista.body.licencas.find((x: { id: string }) => x.id === l.id),
    ).toMatchObject({
      estado: 'por_aprovar',
      tipo_nome: 'Licença de ocupação da via pública',
      resumo: { rotulo_dia: 'Período' },
    });
    expect(lista.body.tipos).toHaveLength(6);

    const ap = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(200);
    expect(ap.body.estado).toBe('emitida');
    const codigo = ap.body.codigo_verificacao;
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms.map((s) => s.corpo).join(' ')).toContain(`/licenca/${codigo}`);
    expect(sms.map((s) => s.corpo).join(' ')).toContain(
      'ocupação da via pública',
    );

    const pub = await ctx
      .http()
      .get(`/v1/public/licencas/${codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      tipo: 'ocupacao_via',
      titulo: 'Licença de ocupação da via pública',
      valida: true,
      titular: 'Obras L.',
      rotulo_dia: 'Período',
      horario: null,
      detalhes: expect.arrayContaining([
        { rotulo: 'Área ocupada', valor: '12 m²' },
      ]),
    });
    await pdfDe(codigo);
  });

  it('ocupação fora das regras (passeio estreito e estrada) → técnico, sem pagamento', async () => {
    const r = await ferramenta(
      ctx,
      novaChamada('ovp'),
      'pedir_licenca_ocupacao_via',
      andaime({ passeio_livre_m: 0.8, ocupa_estrada: true }),
    ).expect(200);
    expect(r.body).toMatchObject({
      proposta: 'tecnico',
      pagamento: null,
      taxa: null,
    });
    expect(r.body.regras.filter((x: string) => x.startsWith('✗'))).toHaveLength(
      2,
    );
  });

  it('esplanada: a câmara deixa emitir sozinha → paga → emitida sem clique', async () => {
    const atual = await ctx
      .http()
      .get('/v1/painel/licencas/regras/esplanada')
      .set(chefe)
      .expect(200);
    expect(atual.body.config).toMatchObject({
      aprovacao: 'funcionario',
      demonstracao: true,
    });
    await ctx
      .http()
      .put('/v1/painel/licencas/regras/esplanada')
      .set(chefe)
      .send({ ...atual.body.config, aprovacao: 'automatica' })
      .expect(200);

    const chamada = novaChamada('esp');
    const r = await ferramenta(ctx, chamada, 'pedir_licenca_esplanada', {
      estabelecimento: 'Café Central',
      morada: 'Largo do Toural 5, Guimarães',
      data_inicio: daquiA(),
      meses: 6,
      area_m2: 12,
      mesas: 4,
      passeio_livre_m: 2,
    }).expect(200);
    expect(r.body).toMatchObject({
      proposta: 'aprovar',
      numero: expect.stringMatching(/^ESP /),
      pagamento: { valor_cent: 12 * 6 * 300 },
    });
    const l = await licencaDe(r.body.numero);
    await pagar(l.processo_id);
    await ctx.app.get(LicencasService).sincronizar();
    const d = await ctx
      .http()
      .get(`/v1/painel/licencas/${l.id}`)
      .set(chefe)
      .expect(200);
    expect(d.body).toMatchObject({
      estado: 'emitida',
      decidida_por_nome: null,
    });
    const pub = await ctx
      .http()
      .get(`/v1/public/licencas/${d.body.codigo_verificacao}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      titulo: 'Licença de esplanada',
      valida: true,
    });
    expect(pub.body.condicoes.join(' ')).toContain('Recolher');
    await pdfDe(d.body.codigo_verificacao);

    await ctx
      .http()
      .put('/v1/painel/licencas/regras/esplanada')
      .set(chefe)
      .send(atual.body.config)
      .expect(200);
  });

  it('dístico de residente: 3.º da casa vai a técnico → técnico aprova → paga → emitido, válido 12 meses', async () => {
    const chamada = novaChamada('dre');
    const r = await ferramenta(ctx, chamada, 'pedir_distico_residente', {
      morada: 'Rua da Rainha 20, Guimarães',
      matricula: 'aa12bb',
      disticos_ja_tem: 2,
      morada_comprovada: true,
      viatura_em_nome: true,
      nome: 'Ana Moradora',
    }).expect(200);
    expect(r.body).toMatchObject({
      proposta: 'tecnico',
      numero: expect.stringMatching(/^DRE /),
    });
    expect(r.body.regras.join(' ')).toContain('3.º');
    const l = await licencaDe(r.body.numero);
    expect(l.estado).toBe('para_tecnico');

    const ap = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(200);
    expect(ap.body).toMatchObject({ estado: 'a_pagar', taxa_cent: 3000 });
    await pagar(l.processo_id);
    await ctx.app.get(LicencasService).sincronizar();
    const d = await ctx
      .http()
      .get(`/v1/painel/licencas/${l.id}`)
      .set(chefe)
      .expect(200);
    expect(d.body.estado).toBe('emitida');
    const pub = await ctx
      .http()
      .get(`/v1/public/licencas/${d.body.codigo_verificacao}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      tipo: 'distico_residente',
      titulo: 'Dístico de residente',
      feminino: false,
      valida: true,
      rotulo_dia: 'Validade',
      detalhes: expect.arrayContaining([
        { rotulo: 'Matrícula', valor: 'AA-12-BB' },
      ]),
    });
    const ano = new Date();
    ano.setUTCFullYear(ano.getUTCFullYear() + 1);
    expect(pub.body.valida_ate.slice(0, 4)).toBe(String(ano.getUTCFullYear()));
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms.map((s) => s.corpo).join(' ')).toContain(
      'o seu dístico de residente',
    );
    await pdfDe(d.body.codigo_verificacao);
  });

  it('publicidade: placa de 2 m² no próprio estabelecimento → paga → aprovar → página e PDF', async () => {
    const chamada = novaChamada('pub');
    const r = await ferramenta(ctx, chamada, 'pedir_licenca_publicidade', {
      suporte: 'placa',
      estabelecimento: 'Sapataria Moderna',
      mensagem: 'Nome e logótipo da loja',
      morada: 'Rua de Santo António 30, Guimarães',
      largura_m: 2,
      altura_m: 1,
      iluminado: false,
      no_proprio_estabelecimento: true,
      data_inicio: daquiA(),
      meses: 12,
      nome: 'Sapataria Moderna Lda',
    }).expect(200);
    expect(r.body).toMatchObject({
      pedida: true,
      tipo: 'publicidade',
      numero: expect.stringMatching(/^PUB \d+\/\d{4}$/),
      proposta: 'aprovar',
      // 2 m² × 12 meses × 1,50 €
      pagamento: { modo_teste: true, valor_cent: 3600 },
      regras_de_demonstracao: true,
      fonte: expect.stringContaining('Lei 97/88'),
    });
    const l = await licencaDe(r.body.numero);
    expect(l).toMatchObject({ estado: 'a_pagar', codigo: 'PUB' });
    await pagar(l.processo_id);
    await ctx.app.get(LicencasService).sincronizar();
    const ap = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(200);
    expect(ap.body.estado).toBe('emitida');
    const pub = await ctx
      .http()
      .get(`/v1/public/licencas/${ap.body.codigo_verificacao}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      tipo: 'publicidade',
      titulo: 'Licença de publicidade',
      valida: true,
      rotulo_dia: 'Período',
      aviso_dias_antes: 30,
      detalhes: expect.arrayContaining([
        { rotulo: 'Medidas', valor: '2 × 1 m (2 m²)' },
      ]),
    });
    expect(pub.body.valida_ate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await pdfDe(ap.body.codigo_verificacao);
  });

  it('publicidade pequena no próprio estabelecimento: mera comunicação, sem taxa; fora dele vai a técnico', async () => {
    const base = {
      suporte: 'letras',
      estabelecimento: 'Barbearia Afonso',
      mensagem: 'Barbearia',
      morada: 'Rua da Rainha 4, Guimarães',
      largura_m: 1,
      altura_m: 0.5,
      iluminado: false,
      no_proprio_estabelecimento: true,
      data_inicio: daquiA(),
      meses: 12,
    };
    const r = await ferramenta(
      ctx,
      novaChamada('pub'),
      'pedir_licenca_publicidade',
      base,
    ).expect(200);
    expect(r.body).toMatchObject({ proposta: 'aprovar', pagamento: null });
    expect(r.body.regras.join(' ')).toContain('mera comunicação');
    expect((await licencaDe(r.body.numero)).estado).toBe('por_aprovar');

    const t = await ferramenta(
      ctx,
      novaChamada('pub'),
      'pedir_licenca_publicidade',
      { ...base, no_proprio_estabelecimento: false, centro_historico: true },
    ).expect(200);
    expect(t.body).toMatchObject({ proposta: 'tecnico', pagamento: null });
    expect(t.body.regras.filter((x: string) => x.startsWith('✗'))).toHaveLength(
      2,
    );
  });

  it('recinto improvisado: arraial com palco e música → aprova e lembra a licença de ruído; com bancadas e muita gente vai a vistoria', async () => {
    const chamada = novaChamada('lri');
    const arraial = {
      descricao: 'Arraial de São Martinho da associação',
      morada: 'Largo da Oliveira, Guimarães',
      data_inicio: daquiA(),
      dias: 2,
      lotacao: 200,
      estruturas: ['palco', 'barracas'],
      musica: true,
      nome: 'Associação Recreativa',
    };
    const r = await ferramenta(
      ctx,
      chamada,
      'pedir_licenca_recinto_improvisado',
      arraial,
    ).expect(200);
    expect(r.body).toMatchObject({
      pedida: true,
      tipo: 'recinto_improvisado',
      numero: expect.stringMatching(/^LRI /),
      proposta: 'aprovar',
      tambem_ruido: true,
      // 25 € + 2 dias × 10 €
      pagamento: { valor_cent: 4500 },
      dizer: expect.stringContaining('licença especial de ruído'),
    });
    const l = await licencaDe(r.body.numero);
    await pagar(l.processo_id);
    await ctx.app.get(LicencasService).sincronizar();
    const ap = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(200);
    const pub = await ctx
      .http()
      .get(`/v1/public/licencas/${ap.body.codigo_verificacao}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      titulo: 'Licença de recinto improvisado',
      valida: true,
      // Não se renova: não há avisos.
      aviso_dias_antes: null,
      detalhes: expect.arrayContaining([
        { rotulo: 'Lotação', valor: '200 pessoas' },
      ]),
    });
    expect(pub.body.condicoes.join(' ')).toContain('licença especial de ruído');
    await pdfDe(ap.body.codigo_verificacao);

    const v = await ferramenta(
      ctx,
      novaChamada('lri'),
      'pedir_licenca_recinto_improvisado',
      {
        ...arraial,
        lotacao: 900,
        estruturas: ['palco', 'bancadas'],
        musica: false,
      },
    ).expect(200);
    expect(v.body).toMatchObject({ proposta: 'tecnico', pagamento: null });
    expect(v.body.tambem_ruido).toBeUndefined();
    expect(v.body.regras.filter((x: string) => x.startsWith('✗'))).toHaveLength(
      2,
    );
  });

  it('simular publicidade e recinto com os pedidos de demonstração', async () => {
    for (const [tipo, mudar] of [
      ['publicidade', { area_max_m2: 12 }],
      ['recinto_improvisado', { lotacao_max: 1000 }],
    ] as const) {
      const antes = await ctx
        .http()
        .get(`/v1/painel/licencas/regras/${tipo}`)
        .set(chefe)
        .expect(200);
      const c = await ctx
        .http()
        .post(`/v1/painel/licencas/historico/${tipo}/demonstracao`)
        .set(chefe)
        .expect(200);
      expect(c.body).toEqual({ criados: 120, ja_havia: 0 });
      const s = await ctx
        .http()
        .post(`/v1/painel/licencas/regras/${tipo}/simular`)
        .set(chefe)
        .send({ ...antes.body.config, ...mudar })
        .expect(200);
      expect(s.body).toMatchObject({
        tipo,
        pedidos_de_demonstracao: 120,
        deixam_de_ser_aprovados: 0,
      });
      expect(s.body.passam_a_ser_aprovados).toBeGreaterThan(0);
    }
  });

  it('tipos: as regras de cada um, os campos editáveis e a validação', async () => {
    const t = await ctx
      .http()
      .get('/v1/painel/licencas/tipos')
      .set(chefe)
      .expect(200);
    expect(t.body.tipos.map((x: { tipo: string }) => x.tipo)).toEqual([
      'ruido',
      'ocupacao_via',
      'esplanada',
      'distico_residente',
      'publicidade',
      'recinto_improvisado',
    ]);
    const dre = t.body.tipos.find(
      (x: { tipo: string }) => x.tipo === 'distico_residente',
    );
    expect(dre.campos.map((c: { chave: string }) => c.chave)).toContain(
      'taxa_por_ordem_cent',
    );
    await ctx
      .http()
      .put('/v1/painel/licencas/regras/distico_residente')
      .set(chefe)
      .send({ ...dre.config, disticos_max_por_fogo: 0 })
      .expect(400);
    await ctx
      .http()
      .get('/v1/painel/licencas/regras/inventado')
      .set(chefe)
      .expect(400);
    await ctx
      .http()
      .get('/v1/painel/licencas?tipo=inventado')
      .set(chefe)
      .expect(400);
  });

  it('simular: carrega pedidos de demonstração (uma vez), corre a regra proposta sem gravar e diz o que muda', async () => {
    const antes = await ctx
      .http()
      .get('/v1/painel/licencas/regras/ocupacao_via')
      .set(chefe)
      .expect(200);

    const c1 = await ctx
      .http()
      .post('/v1/painel/licencas/historico/ocupacao_via/demonstracao')
      .set(chefe)
      .expect(200);
    expect(c1.body).toEqual({ criados: 120, ja_havia: 0 });
    const c2 = await ctx
      .http()
      .post('/v1/painel/licencas/historico/ocupacao_via/demonstracao')
      .set(chefe)
      .expect(200);
    expect(c2.body).toEqual({ criados: 0, ja_havia: 120 });

    // Passeio livre de 1 m em vez de 1,20 m e taxa por m² mais alta.
    const s = await ctx
      .http()
      .post('/v1/painel/licencas/regras/ocupacao_via/simular')
      .set(chefe)
      .send({
        ...antes.body.config,
        passeio_livre_min_m: 1,
        taxa_m2_dia_cent: 60,
      })
      .expect(200);
    expect(s.body).toMatchObject({
      tipo: 'ocupacao_via',
      anos: 5,
      pedidos_de_demonstracao: 120,
      deixam_de_ser_aprovados: 0,
    });
    // Os 120 inventados mais os pedidos feitos ao agente neste teste.
    expect(s.body.total).toBeGreaterThanOrEqual(122);
    expect(s.body.passam_a_ser_aprovados).toBeGreaterThan(0);
    expect(s.body.mudam_de_taxa).toBeGreaterThan(0);
    expect(s.body.receita.diferenca_cent).toBe(
      s.body.receita.depois_cent - s.body.receita.antes_cent,
    );
    expect(s.body.receita.diferenca_cent).toBeGreaterThan(0);
    const ex = s.body.exemplos[0];
    expect(ex).toMatchObject({
      referencia: expect.any(String),
      antes: { aprovado: false },
      depois: { aprovado: true },
    });
    expect(ex.porque.join(' ')).toContain('Passa a cumprir');
    expect(s.body.por_regra[0]).toMatchObject({ id: 'passeio' });

    // Apertar: o máximo de dias passa para 7.
    const s2 = await ctx
      .http()
      .post('/v1/painel/licencas/regras/ocupacao_via/simular')
      .set(chefe)
      .send({ ...antes.body.config, dias_max: 7 })
      .expect(200);
    expect(s2.body.deixam_de_ser_aprovados).toBeGreaterThan(0);
    expect(s2.body.receita.diferenca_cent).toBeLessThan(0);
    expect(s2.body.exemplos[0].porque[0]).toMatch(
      /^Passa a falhar: Fica \d+ dias/,
    );

    // Nada ficou gravado.
    const depois = await ctx
      .http()
      .get('/v1/painel/licencas/regras/ocupacao_via')
      .set(chefe)
      .expect(200);
    expect(depois.body.config).toEqual(antes.body.config);

    // Regras inválidas não se simulam.
    await ctx
      .http()
      .post('/v1/painel/licencas/regras/ocupacao_via/simular')
      .set(chefe)
      .send({ ...antes.body.config, equipamentos: [] })
      .expect(400);

    const tipos = await ctx
      .http()
      .get('/v1/painel/licencas/tipos')
      .set(chefe)
      .expect(200);
    expect(
      tipos.body.tipos.find((x: { tipo: string }) => x.tipo === 'ocupacao_via')
        .historico,
    ).toEqual({ pedidos: 120, demonstracao: 120 });
  });

  it('simular o ruído também conta as licenças pedidas ao agente', async () => {
    const atual = await ctx
      .http()
      .get('/v1/painel/licencas/regras/ruido')
      .set(chefe)
      .expect(200);
    const s = await ctx
      .http()
      .post('/v1/painel/licencas/regras/ruido/simular')
      .set(chefe)
      .send({ ...atual.body.config, taxa_cent: 3000 })
      .expect(200);
    // Os outros e2e podem ter pedido licenças de ruído na mesma BD.
    const n = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM licencas WHERE tipo = 'ruido'`,
    );
    const h = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM licenca_historico WHERE tipo = 'ruido'`,
    );
    expect(s.body).toMatchObject({
      tipo: 'ruido',
      total: (n?.n ?? 0) + (h?.n ?? 0),
    });
    // Só muda a taxa: ninguém muda de decisão.
    expect(s.body.deixam_de_ser_aprovados).toBe(0);
    expect(s.body.passam_a_ser_aprovados).toBe(0);
  });

  it('permissões: técnico vê, mas não muda nem simula regras; atendimento não vê licenças', async () => {
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    const t = await ctx
      .http()
      .get('/v1/painel/licencas/tipos')
      .set(tecnico)
      .expect(200);
    const cfg = t.body.tipos.find(
      (x: { tipo: string }) => x.tipo === 'esplanada',
    ).config;
    await ctx
      .http()
      .put('/v1/painel/licencas/regras/esplanada')
      .set(tecnico)
      .send(cfg)
      .expect(403);
    await ctx
      .http()
      .post('/v1/painel/licencas/regras/esplanada/simular')
      .set(tecnico)
      .send(cfg)
      .expect(403);
    await ctx
      .http()
      .post('/v1/painel/licencas/historico/esplanada/demonstracao')
      .set(tecnico)
      .expect(403);

    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .get('/v1/painel/licencas?tipo=esplanada')
      .set(atendimento)
      .expect(403);
    await ctx
      .http()
      .get('/v1/painel/licencas/tipos')
      .set(atendimento)
      .expect(403);
    await ctx.http().get('/v1/painel/licencas/tipos').expect(401);
  });
});
