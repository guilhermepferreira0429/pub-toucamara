/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linhas,
  MUNICIPIO_ID,
} from './app';

/** "Correr teste agora" e os pedidos automáticos ao avaliador. */
describe('Pedidos de avaliação (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  it('pede uma vez; o segundo pedido devolve o pendente; aparece em Qualidade', async () => {
    const a = await ctx
      .http()
      .post('/v1/painel/conhecimento/qualidade/correr')
      .set(chefe)
      .send({})
      .expect(202);
    expect(a.body).toMatchObject({
      estado: 'pendente',
      motivo: 'manual',
      conjunto: 'Perguntas base',
      ja_havia: false,
    });
    const b = await ctx
      .http()
      .post('/v1/painel/conhecimento/qualidade/correr')
      .set(chefe)
      .send({ amostra: true })
      .expect(202);
    expect(b.body).toMatchObject({ id: a.body.id, ja_havia: true });

    const q = await ctx
      .http()
      .get('/v1/painel/conhecimento/qualidade')
      .set(chefe)
      .expect(200);
    expect(q.body.pedidos[0]).toMatchObject({
      id: a.body.id,
      estado: 'pendente',
    });

    // Depois de o avaliador o pegar, um pedido novo pode ficar pendente.
    await ctx.db.query(
      `UPDATE avaliacao.pedidos SET estado = 'a_correr' WHERE id = $1`,
      [a.body.id],
    );
    const c = await ctx
      .http()
      .post('/v1/painel/conhecimento/qualidade/correr')
      .set(chefe)
      .send({})
      .expect(202);
    expect(c.body.id).not.toBe(a.body.id);
  });

  it('só quem edita o conhecimento pede', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .post('/v1/painel/conhecimento/qualidade/correr')
      .set(atendimento)
      .send({})
      .expect(403);
  });

  it('mudar o agente pede uma avaliação da versão nova', async () => {
    await ctx.db.query(
      `DELETE FROM avaliacao.pedidos WHERE municipio_id = $1`,
      [MUNICIPIO_ID],
    );
    const interno = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'equipa_toucamara'),
    );
    await ctx
      .http()
      .put('/v1/painel/agente')
      .set(interno)
      .send({
        nome: 'Tou',
        saudacao: 'Olá, esta chamada é gravada.',
        trata_por: 'você',
        idiomas: ['pt-PT'],
      })
      .expect(200);
    const p = await linhas<{ motivo: string }>(
      ctx.db,
      `SELECT motivo FROM avaliacao.pedidos WHERE municipio_id = $1 AND estado = 'pendente'`,
      [MUNICIPIO_ID],
    );
    expect(p.map((x) => x.motivo)).toEqual(['mudanca_agente']);
  });
});
