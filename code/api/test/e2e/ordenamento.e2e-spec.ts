/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  MUNICIPIO_ID,
  ferramenta,
  novaChamada,
  smsPara,
} from './app';

/**
 * "Diga-me a morada e eu digo-lhe o que pode fazer": zonas de demonstração
 * do PDM, a ferramenta do agente (pergunta de volta a área, responde com o
 * controlo, SMS com a planta) e a página pública.
 */
describe('Ordenamento: o que posso fazer nesta morada (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  const RESIDENCIAL = 'Rua de Teste do PDM 5';
  const CENTRO = 'Largo da Oliveira 1';
  const LONGE = 'Rua Muito Longe 9';

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    // Começa sem PDM: outro ficheiro (ex.: verificacoes) pode já ter
    // carregado as zonas de demonstração, e a BD é partilhada.
    await ctx.db.query(
      `UPDATE consultas_pdm SET zona_id = NULL
       WHERE zona_id IN (SELECT id FROM zonas_pdm WHERE municipio_id = $1)`,
      [MUNICIPIO_ID],
    );
    await ctx.db.query(`DELETE FROM zonas_pdm WHERE municipio_id = $1`, [
      MUNICIPIO_ID,
    ]);
    ctx.geo.moradas.set(RESIDENCIAL, { lat: 41.45, lng: -8.305 });
    ctx.geo.moradas.set(CENTRO, { lat: 41.4432, lng: -8.2947 });
    ctx.geo.moradas.set(LONGE, { lat: 41.3, lng: -8.1 });
  });
  afterAll(() => ctx.fechar());

  it('sem PDM carregado → sem_pdm (não inventa)', async () => {
    const r = await ferramenta(ctx, novaChamada('pdm'), 'o_que_posso_fazer', {
      morada: RESIDENCIAL,
      obra: 'anexo',
    }).expect(200);
    expect(r.body).toMatchObject({ respondido: false, motivo: 'sem_pdm' });
  });

  it('carregar as zonas de demonstração: só quem gere o conhecimento, e uma vez', async () => {
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await ctx
      .http()
      .post('/v1/painel/ordenamento/demonstracao')
      .set(tecnico)
      .expect(403);
    const r = await ctx
      .http()
      .post('/v1/painel/ordenamento/demonstracao')
      .set(chefe)
      .expect(201);
    expect(r.body.zonas).toHaveLength(4);
    expect(
      r.body.zonas.every((z: { demonstracao: boolean }) => z.demonstracao),
    ).toBe(true);
    await ctx
      .http()
      .post('/v1/painel/ordenamento/demonstracao')
      .set(chefe)
      .expect(409);
  });

  it('anexo no residencial: pergunta a área e a altura, depois diz comunicação prévia e manda SMS', async () => {
    const chamada = novaChamada('pdm');
    const primeiro = await ferramenta(ctx, chamada, 'o_que_posso_fazer', {
      morada: RESIDENCIAL,
      obra: 'anexo',
    }).expect(200);
    expect(primeiro.body).toMatchObject({
      respondido: false,
      motivo: 'faltam_medidas',
      zona: 'Espaço residencial consolidado',
      em_falta: ['area_m2', 'altura_m'],
    });

    const r = await ferramenta(ctx, chamada, 'o_que_posso_fazer', {
      morada: RESIDENCIAL,
      obra: 'anexo',
      area_m2: 25,
      altura_m: 2.5,
    }).expect(200);
    expect(r.body).toMatchObject({
      respondido: true,
      controlo: 'comunicacao_previa',
      zona: { codigo: 'ERC', demonstracao: true },
      sms_enviado: true,
      link: expect.stringMatching(/\/zona\/[A-Z0-9]{8}$/),
    });
    expect(r.body.passos.length).toBeGreaterThan(0);
    const sms = await smsPara(ctx, chamada.telefone, 'fim_chamada');
    expect(sms.map((s) => s.corpo).join(' ')).toContain('/zona/');

    const codigo = String(r.body.link).split('/').pop();
    const pub = await ctx
      .http()
      .get(`/v1/public/consultas-pdm/${codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      morada: RESIDENCIAL,
      obra: 'anexo',
      resultado: { controlo: 'comunicacao_previa' },
      zona: { codigo: 'ERC', poligono: expect.any(Array) },
    });
  });

  it('no centro histórico um anexo não é permitido (sem perguntar medidas)', async () => {
    const r = await ferramenta(ctx, novaChamada('pdm'), 'o_que_posso_fazer', {
      morada: CENTRO,
      obra: 'anexo',
    }).expect(200);
    expect(r.body).toMatchObject({
      controlo: 'nao_permitido',
      zona: { codigo: 'CH' },
    });
  });

  it('fora das zonas e morada desconhecida: passa a técnico ou pergunta outra vez', async () => {
    const fora = await ferramenta(
      ctx,
      novaChamada('pdm'),
      'o_que_posso_fazer',
      {
        morada: LONGE,
        obra: 'muro',
        altura_m: 1,
      },
    ).expect(200);
    expect(fora.body).toMatchObject({ respondido: false, zona: null });
    expect(fora.body.dizer).toContain('técnico');
    const nada = await ferramenta(
      ctx,
      novaChamada('pdm'),
      'o_que_posso_fazer',
      {
        morada: 'Rua que não existe',
        obra: 'muro',
      },
    ).expect(200);
    expect(nada.body.motivo).toBe('morada_nao_encontrada');
  });

  it('o painel mostra as consultas no mapa e por obra', async () => {
    const r = await ctx
      .http()
      .get('/v1/painel/ordenamento')
      .set(chefe)
      .expect(200);
    expect(r.body.consultas.length).toBeGreaterThanOrEqual(3);
    expect(r.body.por_obra).toEqual(
      expect.arrayContaining([expect.objectContaining({ obra: 'anexo' })]),
    );
  });

  it('no painel, a morada: a zona e o que cada obra precisa, sem gravar nem mandar SMS', async () => {
    const contar = async () =>
      (
        await ctx.db.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM consultas_pdm WHERE municipio_id = $1',
          [MUNICIPIO_ID],
        )
      ).rows[0].n;
    const antes = await contar();
    const morada = (m: string) =>
      ctx
        .http()
        .get(`/v1/painel/ordenamento/morada?morada=${encodeURIComponent(m)}`)
        .set(chefe)
        .expect(200);

    const centro = await morada(CENTRO);
    expect(centro.body.motivo).toBeNull();
    expect(centro.body.zona).toMatchObject({ demonstracao: true });
    expect(centro.body.encontrada).toMatchObject({
      lat: 41.4432,
      lng: -8.2947,
    });
    expect(centro.body.obras).toHaveLength(6);
    expect(centro.body.obras).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ obra: 'anexo', controlo: 'nao_permitido' }),
      ]),
    );

    // Sem medidas: diz de que depende, com os limites da regra.
    const residencial = await morada(RESIDENCIAL);
    const anexo = residencial.body.obras.find(
      (o: { obra: string }) => o.obra === 'anexo',
    );
    expect(anexo.controlo).toBeNull();
    expect(anexo.depende_de).toEqual(expect.arrayContaining(['area_m2']));
    expect(anexo.limites.length).toBeGreaterThan(0);

    expect((await morada(LONGE)).body).toMatchObject({
      motivo: 'fora_das_zonas',
      zona: null,
      obras: [],
    });
    expect((await morada('Rua Que Não Existe 0')).body).toMatchObject({
      motivo: 'morada_nao_encontrada',
    });
    expect(await contar()).toBe(antes);
  });
});
