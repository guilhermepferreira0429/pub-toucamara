import { arrancarApp, Contexto } from './e2e/app';

describe('App (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  it('GET /v1/saude responde ok com a BD ligada', async () => {
    const r = await ctx.http().get('/v1/saude').expect(200);
    expect(r.body).toHaveProperty('ok', true);
  });
});
