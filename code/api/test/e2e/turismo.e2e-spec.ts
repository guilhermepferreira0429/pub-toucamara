/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  Contexto,
  conversaId,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  MUNICIPIO,
  MUNICIPIO_ID,
  novaChamada,
} from './app';

/**
 * Turistas (V4 #10): fontes de turismo de demonstração em PT/EN/ES/FR
 * (rota idempotente), pesquisa noutra língua, página pública /visitar,
 * a ferramenta o_que_visitar e o indicador do painel.
 */
describe('Turismo: fontes em várias línguas, /visitar e o_que_visitar (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let eventoId: string;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    const inicio = new Date(Date.now() + 86_400_000);
    const ev = await ctx
      .http()
      .post('/v1/painel/eventos')
      .set(chefe)
      .send({
        titulo: 'Visita guiada de teste ao castelo',
        descricao: 'Visita a pé.',
        local: 'Castelo',
        lat: 41.4479,
        lng: -8.2902,
        inicio: inicio.toISOString(),
        publicar: true,
      })
      .expect(201);
    eventoId = ev.body.id;
  });
  afterAll(() => ctx.fechar());

  it('carregar as fontes de demonstração: só quem gere o conhecimento, idempotente', async () => {
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await ctx
      .http()
      .post('/v1/painel/turismo/demonstracao')
      .set(tecnico)
      .expect(403);
    // A BD é partilhada: o "preparar demo" (demo.e2e) pode já as ter criado.
    const antes = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM fontes WHERE municipio_id = $1 AND tipo = 'turismo'`,
      [MUNICIPIO_ID],
    );
    const r = await ctx
      .http()
      .post('/v1/painel/turismo/demonstracao')
      .set(chefe)
      .expect(201);
    expect(r.body).toMatchObject({
      criadas: 36 - antes!.n,
      com_texto: 36 - antes!.n,
      total: 36,
      demonstracao: true,
    });
    const outra = await ctx
      .http()
      .post('/v1/painel/turismo/demonstracao')
      .set(chefe)
      .expect(201);
    expect(outra.body).toMatchObject({ criadas: 0, com_texto: 0 });

    const contas = await linha<{ n: number; demo: number; linguas: number }>(
      ctx.db,
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE demonstracao)::int AS demo,
              count(DISTINCT lingua)::int AS linguas
       FROM fontes WHERE municipio_id = $1 AND tipo = 'turismo'`,
      [MUNICIPIO_ID],
    );
    expect(contas).toEqual({ n: 36, demo: 36, linguas: 4 });
  });

  it('aparecem nas fontes do painel (com língua e demonstração) e o texto editado não é substituído', async () => {
    const r = await ctx
      .http()
      .get('/v1/painel/conhecimento/fontes')
      .set(chefe)
      .expect(200);
    const turismo = r.body.itens.filter(
      (f: { tipo: string }) => f.tipo === 'turismo',
    );
    expect(turismo).toHaveLength(36);
    expect(turismo[0]).toMatchObject({ demonstracao: true });
    const pt = turismo.find((f: { url: string }) =>
      f.url.endsWith('turismo-demonstracao-comer-pt'),
    );
    expect(pt.lingua).toBe('pt');

    const editado =
      'Texto revisto pelo turismo da câmara.\n\n## Doces conventuais\nToucinho do céu e tortas de Guimarães, nas pastelarias do centro histórico.';
    await ctx
      .http()
      .post(`/v1/painel/conhecimento/fontes/${pt.id}/texto`)
      .set(chefe)
      .send({ texto: editado })
      .expect(200);
    await ctx
      .http()
      .post('/v1/painel/turismo/demonstracao')
      .set(chefe)
      .expect(201);
    const atual = await linha<{ texto: string }>(
      ctx.db,
      `SELECT texto FROM fonte_versoes WHERE fonte_id = $1 ORDER BY lida_em DESC LIMIT 1`,
      [pt.id],
    );
    expect(atual?.texto).toContain('Texto revisto pelo turismo');
  });

  it('procurar_conhecimento em inglês e em francês encontra a fonte nessa língua', async () => {
    const en = await ferramenta(
      ctx,
      novaChamada('tur'),
      'procurar_conhecimento',
      { pergunta: 'How do I get to Guimarães Castle?' },
    ).expect(200);
    expect(en.body.sem_fonte).toBe(false);
    expect(en.body.trechos[0].tipo_fonte).toBe('turismo');
    expect(en.body.trechos[0].url).toMatch(/turismo-demonstracao-.+-en$/);
    const primeiros = en.body.trechos.slice(0, 3);
    expect(
      primeiros.some(
        (t: { texto: string; url: string }) =>
          t.texto.includes('Guimarães Castle') && t.url.endsWith('-en'),
      ),
    ).toBe(true);

    const fr = await ferramenta(
      ctx,
      novaChamada('tur'),
      'procurar_conhecimento',
      { pergunta: 'Comment venir en train depuis Porto ?' },
    ).expect(200);
    expect(fr.body.trechos[0].url).toMatch(/turismo-demonstracao-.+-fr$/);
  });

  it('página pública /visitar: temas na língua pedida, pontos com texto, roteiros e eventos', async () => {
    const r = await ctx
      .http()
      .get(`/v1/public/turismo/${MUNICIPIO}?lingua=en`)
      .expect(200);
    expect(r.body).toMatchObject({
      lingua: 'en',
      demonstracao: true,
      linguas_disponiveis: ['en', 'es', 'fr', 'pt'],
    });
    expect(r.body.aviso).toMatch(/demonstração/);
    expect(r.body.temas).toHaveLength(9);
    expect(
      r.body.temas.every((t: { lingua: string }) => t.lingua === 'en'),
    ).toBe(true);
    const castelo = r.body.pontos.find(
      (p: { chave: string }) => p.chave === 'castelo',
    );
    expect(castelo).toMatchObject({ nome: 'Guimarães Castle' });
    expect(castelo.descricao).toMatch(/medieval castle/);
    expect(r.body.roteiros).toHaveLength(4);
    for (const rt of r.body.roteiros)
      expect(rt.paragens.length).toBeGreaterThan(1);
    expect(r.body.eventos.map((e: { id: string }) => e.id)).toContain(eventoId);
    // Sem dados pessoais nem ids internos das fontes além do necessário.
    expect(JSON.stringify(r.body)).not.toMatch(/telefone|nif/i);

    // Língua sem conteúdo → português.
    const de = await ctx
      .http()
      .get(`/v1/public/turismo/${MUNICIPIO}?lingua=de`)
      .expect(200);
    expect(de.body.lingua).toBe('pt');
    expect(de.body.pontos[0].nome).toBe('Castelo de Guimarães');

    await ctx.http().get('/v1/public/turismo/nao-existe').expect(404);
  });

  it('roteiro à medida: mobilidade reduzida tira o castelo; interesses inválidos → 400', async () => {
    const r = await ctx
      .http()
      .get(
        `/v1/public/turismo/${MUNICIPIO}/roteiro?lingua=fr&minutos=180&mobilidade=1`,
      )
      .expect(200);
    const chaves = r.body.paragens.map((p: { chave: string }) => p.chave);
    expect(chaves).not.toContain('castelo');
    expect(r.body.excluidos_mobilidade).toContain('Château de Guimarães');
    expect(r.body.minutos_total).toBeLessThanOrEqual(180);
    await ctx
      .http()
      .get(`/v1/public/turismo/${MUNICIPIO}/roteiro?interesses=praia`)
      .expect(400);
  });

  it('o_que_visitar: roteiro na língua, eventos dos próximos dias e link para /visitar', async () => {
    const chamada = novaChamada('tur');
    const r = await ferramenta(ctx, chamada, 'o_que_visitar', {
      minutos: 120,
      interesses: ['historia'],
      lingua: 'en',
    }).expect(200);
    expect(r.body).toMatchObject({ demonstracao: true, lingua: 'en' });
    const nomes = r.body.roteiro.map((p: { nome: string }) => p.nome);
    expect(nomes).toContain('Guimarães Castle');
    expect(r.body.minutos_total).toBeLessThanOrEqual(120);
    expect(r.body.link).toMatch(
      new RegExp(`/visitar/${MUNICIPIO}\\?lingua=en&minutos=120`),
    );
    expect(
      r.body.eventos_proximos_dias.map((e: { titulo: string }) => e.titulo),
    ).toContain('Visita guiada de teste ao castelo');
    expect(r.body.fontes.length).toBeGreaterThan(0);
    expect(typeof r.body.dizer).toBe('string');

    const id = await conversaId(ctx, chamada.conversa);
    const m = await linha<{ dados: { lingua: string } }>(
      ctx.db,
      `SELECT dados FROM conversa_momentos WHERE conversa_id = $1 AND tipo = 'idioma'`,
      [id],
    );
    expect(m?.dados).toMatchObject({ lingua: 'en', turismo: true });
  });

  it('painel: indicador de perguntas de turistas por língua', async () => {
    const r = await ctx.http().get('/v1/painel/turismo').set(chefe).expect(200);
    expect(r.body.total_fontes).toBe(36);
    expect(r.body.demonstracao).toBe(true);
    expect(r.body.com_turismo_30d).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(r.body.conversas_30d)).toBe(true);
  });
});
