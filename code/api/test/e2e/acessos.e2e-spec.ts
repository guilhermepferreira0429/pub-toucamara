/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  novoTelefone,
} from './app';

/** V2 · Equipa e acessos: o registo de quem viu e alterou o quê. */
describe('Registo de acessos (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  it('mostra as ações em frases, filtra as de dados pessoais e pagina', async () => {
    await ctx
      .http()
      .post('/v1/painel/campanhas/contactos')
      .set(chefe)
      .send({ nome: 'Pessoa Registo', telefone: novoTelefone() })
      .expect(201);
    await ctx
      .http()
      .post('/v1/painel/campanhas/contactos')
      .set(chefe)
      .send({ nome: 'Outra Pessoa', telefone: novoTelefone() })
      .expect(201);

    const todos = await ctx
      .http()
      .get('/v1/painel/equipa/acessos?limite=2')
      .set(chefe)
      .expect(200);
    expect(todos.body.itens).toHaveLength(2);
    expect(todos.body.proximo_cursor).toEqual(expect.any(String));
    const seguinte = await ctx
      .http()
      .get(
        `/v1/painel/equipa/acessos?limite=2&cursor=${todos.body.proximo_cursor}`,
      )
      .set(chefe)
      .expect(200);
    const ids = [...todos.body.itens, ...seguinte.body.itens].map(
      (x: { id: string }) => x.id,
    );
    expect(new Set(ids).size).toBe(ids.length);

    const pessoais = await ctx
      .http()
      .get('/v1/painel/equipa/acessos?so_dados_pessoais=true')
      .set(chefe)
      .expect(200);
    expect(pessoais.body.itens[0]).toMatchObject({
      quem: expect.any(String),
      acao: 'inscrever_contacto_cuidado',
      frase: expect.stringContaining('ação social'),
      dados_pessoais: true,
    });
    expect(
      pessoais.body.itens.every(
        (x: { dados_pessoais: boolean }) => x.dados_pessoais,
      ),
    ).toBe(true);
  });

  it('só quem gere a equipa vê o registo', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .get('/v1/painel/equipa/acessos')
      .set(atendimento)
      .expect(403);
  });
});
