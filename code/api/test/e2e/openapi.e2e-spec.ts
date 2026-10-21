/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { arrancarApp, Contexto } from './app';

/** GET /v1/docs: OpenAPI com as ferramentas do agente (corpo em JSON Schema) e as rotas. */
describe('OpenAPI (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  it('descreve as ferramentas com o esquema da entrada e as rotas com quem pode chamar', async () => {
    const r = await ctx.http().get('/v1/docs').expect(200);
    const d = r.body;
    expect(d.openapi).toBe('3.1.0');

    const licenca = d.paths['/v1/agent/tools/pedir_licenca_ruido'].post;
    expect(licenca.security).toEqual([{ agente: [] }]);
    expect(licenca.description).toEqual(expect.any(String));
    const esquema = licenca.requestBody.content['application/json'].schema;
    expect(esquema.type).toBe('object');
    expect(esquema.$schema).toBeUndefined();
    expect(d.paths['/v1/agent/tools/{nome}']).toBeUndefined();

    const familiar = d.paths['/v1/agent/tools/juntar_familiar'].post;
    expect(
      familiar.requestBody.content['application/json'].schema.required,
    ).toEqual(expect.arrayContaining(['telefone', 'resumo']));

    // Rotas do painel com a permissão; públicas sem segurança; parâmetros do caminho.
    const pergunta = d.paths['/v1/painel/agente/perguntas/{id}'].delete;
    expect(pergunta.security).toEqual([{ painel: [] }]);
    expect(pergunta.description).toBe('Permissão: agente.');
    expect(pergunta.parameters).toEqual([
      expect.objectContaining({ name: 'id', in: 'path' }),
    ]);
    expect(d.paths['/v1/webhooks/sms/estado'].post.security).toEqual([]);
    expect(d.paths['/r/{codigo}']).toBeDefined();
    // Rotas com dois caminhos no mesmo método (MCP).
    expect(d.paths['/v1/mcp/{municipio}/{chave}']).toBeDefined();
  });
});
