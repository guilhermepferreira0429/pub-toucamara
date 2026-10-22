/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { JURI_CHAVE, JURI_EMAIL } from './ambiente';
import { arrancarApp, Contexto, linha, MUNICIPIO_ID } from './app';

/**
 * Acesso do júri ao painel: o link (/entrar?juri=CHAVE → POST auth/juri) e
 * o email especial (POST auth/link entra logo). Sessão só de leitura, até ao
 * prazo (JURI_ATE), com um utilizador próprio criado na primeira entrada.
 */
describe('Acesso do júri (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  it('chave errada: 401, sem criar ninguém', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/auth/juri')
      .send({ chave: 'chave-que-nao-e-a-certa' })
      .expect(401);
    expect(r.body.erro.codigo).toBe('juri_invalido');
    const u = await linha(
      ctx.db,
      'SELECT id FROM utilizadores WHERE email = $1',
      [JURI_EMAIL],
    );
    expect(u).toBeUndefined();
  });

  it('pelo link: sessão só de leitura, vê tudo e não altera nada', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/auth/juri')
      .send({ chave: JURI_CHAVE })
      .expect(200);
    expect(r.body.utilizador).toMatchObject({
      email: JURI_EMAIL,
      perfil: 'chefe_divisao',
      municipioId: MUNICIPIO_ID,
      soLeitura: true,
      acessoAte: '2099-12-31T23:59:59.000Z',
    });
    const h = { Authorization: `Bearer ${r.body.token}` };

    const eu = await ctx.http().get('/v1/painel/auth/eu').set(h).expect(200);
    expect(eu.body.utilizador).toMatchObject({ soLeitura: true });
    expect(eu.body.permissoes.processos).toBe(true);

    await ctx.http().get('/v1/painel/processos').set(h).expect(200);

    // Alterar: recusado, com a razão.
    const correr = await ctx
      .http()
      .post('/v1/painel/conhecimento/qualidade/correr')
      .set(h)
      .send({})
      .expect(403);
    expect(correr.body.erro.codigo).toBe('so_leitura');
    await ctx
      .http()
      .patch('/v1/painel/processos/00000000-0000-0000-0000-000000000000')
      .set(h)
      .send({})
      .expect(403);

    // Consultar por POST (Pergunte ao painel): passa o guard.
    const p = await ctx
      .http()
      .post('/v1/painel/perguntar')
      .set(h)
      .send({ pergunta: 'Quantas conversas houve esta semana?' });
    expect(p.status).not.toBe(403);

    const auditoria = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM audit_log
       WHERE acao = 'entrar_juri' AND ator_id = (SELECT id FROM utilizadores WHERE email = $1)`,
      [JURI_EMAIL],
    );
    expect(auditoria!.n).toBeGreaterThanOrEqual(1);
  });

  it('pelo email no /entrar: entra logo, com o mesmo utilizador; os outros emails continuam a receber o link', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/auth/link')
      .send({ email: JURI_EMAIL.toUpperCase() })
      .expect(200);
    expect(r.body.utilizador).toMatchObject({ soLeitura: true });
    const { rows } = await ctx.db.query(
      'SELECT id FROM utilizadores WHERE email = $1',
      [JURI_EMAIL],
    );
    expect(rows).toHaveLength(1);

    await ctx
      .http()
      .post('/v1/painel/auth/link')
      .send({ email: 'ninguem@cm-teste.pt' })
      .expect(204);
  });

  it('desativar o utilizador do júri corta o acesso, mesmo com a sessão aberta', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/auth/juri')
      .send({ chave: JURI_CHAVE })
      .expect(200);
    const h = { Authorization: `Bearer ${r.body.token}` };
    await ctx.db.query(
      'UPDATE utilizadores SET ativo = false WHERE email = $1',
      [JURI_EMAIL],
    );
    try {
      await ctx.http().get('/v1/painel/auth/eu').set(h).expect(401);
      await ctx
        .http()
        .post('/v1/painel/auth/juri')
        .send({ chave: JURI_CHAVE })
        .expect(401);
    } finally {
      await ctx.db.query(
        'UPDATE utilizadores SET ativo = true WHERE email = $1',
        [JURI_EMAIL],
      );
    }
  });
});
