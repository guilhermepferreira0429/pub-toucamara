/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { createHash } from 'crypto';
import type { JWK } from 'jose';
import { OidcService } from '../../src/modules/auth/oidc.service';
import { WEB_URL } from './ambiente';
import {
  arrancarApp,
  CHEFE_ID,
  Contexto,
  linha,
  MUNICIPIO,
  MUNICIPIO_ID,
} from './app';

const ISSUER = 'https://idp.camara.teste/realms/camara';
const CLIENTE = 'painel-toucamara';
const SEGREDO = 'segredo-oidc-e2e';

/**
 * Login com a conta da câmara (OIDC): Authorization Code + PKCE contra um
 * fornecedor falso (chaves RSA a sério, id_token assinado).
 */
describe('Login OIDC (e2e)', () => {
  let ctx: Contexto;
  let email: string;
  let chavePrivada: CryptoKey;
  let jwk: JWK;
  /** O que o fornecedor falso põe no próximo id_token. */
  let reclamacoes: Record<string, unknown>;
  let audiencia: string;
  let pedidoToken: URLSearchParams | null;

  beforeAll(async () => {
    process.env['OIDC_SEGREDO_E2E'] = SEGREDO;
    ctx = await arrancarApp();
    // jose é ESM: o jest (CommonJS) só o carrega com import().
    const { exportJWK, generateKeyPair, SignJWT } = await import('jose');
    const par = await generateKeyPair('RS256');
    chavePrivada = par.privateKey;
    jwk = { ...(await exportJWK(par.publicKey)), kid: 'k1', alg: 'RS256' };
    email = (await linha<{ email: string }>(
      ctx.db,
      'SELECT email FROM utilizadores WHERE id = $1',
      [CHEFE_ID],
    ))!.email;
    await ctx.db.query(
      `INSERT INTO oidc_fornecedores (municipio_id, issuer, client_id, segredo_env)
       VALUES ($1, $2, $3, 'OIDC_SEGREDO_E2E')`,
      [MUNICIPIO_ID, ISSUER, CLIENTE],
    );
    const oidc = ctx.app.get(OidcService);
    oidc.buscar = async (url, init) => {
      const json = (o: unknown) =>
        new Response(JSON.stringify(o), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (url.endsWith('/.well-known/openid-configuration')) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/auth`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: `${ISSUER}/certs`,
        });
      }
      if (url.endsWith('/certs')) return json({ keys: [jwk] });
      if (url.endsWith('/token')) {
        pedidoToken = new URLSearchParams(init?.body as string);
        const idToken = await new SignJWT(reclamacoes)
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
          .setIssuer(ISSUER)
          .setAudience(audiencia)
          .setSubject('pessoa-1')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(chavePrivada);
        return json({ id_token: idToken, access_token: 'x' });
      }
      return new Response('', { status: 404 });
    };
  });
  afterAll(() => ctx.fechar());

  /** Começa o login; devolve o state, o nonce e o code_challenge do pedido. */
  async function iniciar() {
    const r = await ctx
      .http()
      .get(`/v1/painel/auth/oidc/${MUNICIPIO}/iniciar`)
      .expect(302);
    const u = new URL(r.headers['location']);
    expect(`${u.origin}${u.pathname}`).toBe(`${ISSUER}/auth`);
    expect(u.searchParams.get('client_id')).toBe(CLIENTE);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    return {
      state: u.searchParams.get('state')!,
      nonce: u.searchParams.get('nonce')!,
      desafio: u.searchParams.get('code_challenge')!,
    };
  }

  const voltar = (state: string) =>
    ctx
      .http()
      .get(
        `/v1/painel/auth/oidc/retorno?code=codigo-1&state=${encodeURIComponent(state)}`,
      )
      .expect(302)
      .then((r) => new URL(r.headers['location']));

  it('lista o botão da câmara', async () => {
    const r = await ctx.http().get('/v1/painel/auth/oidc').expect(200);
    expect(r.body.itens).toEqual([
      expect.objectContaining({
        municipio: MUNICIPIO,
        nome_botao: expect.any(String),
      }),
    ]);
  });

  it('entra: PKCE e segredo no pedido do token, id_token validado, sessão como no link mágico', async () => {
    const p = await iniciar();
    reclamacoes = {
      nonce: p.nonce,
      email: email.toUpperCase(),
      email_verified: true,
    };
    audiencia = CLIENTE;
    const destino = await voltar(p.state);
    expect(`${destino.origin}${destino.pathname}`).toBe(`${WEB_URL}/entrar`);
    const token = destino.searchParams.get('token');
    expect(token).toBeTruthy();
    // PKCE: o verificador bate com o desafio; e o segredo vem do ambiente.
    const verificador = pedidoToken!.get('code_verifier')!;
    expect(createHash('sha256').update(verificador).digest('base64url')).toBe(
      p.desafio,
    );
    expect(pedidoToken!.get('client_secret')).toBe(SEGREDO);

    const s = await ctx
      .http()
      .post('/v1/painel/auth/entrar')
      .send({ token })
      .expect(200);
    expect(s.body.utilizador.id).toBe(CHEFE_ID);

    // O state só serve uma vez.
    expect((await voltar(p.state)).searchParams.get('erro')).toBe(
      'pedido_expirado',
    );
  });

  it('recusa nonce trocado, outra audiência e email sem acesso', async () => {
    let p = await iniciar();
    reclamacoes = { nonce: 'outro', email };
    audiencia = CLIENTE;
    expect((await voltar(p.state)).searchParams.get('erro')).toBe(
      'token_invalido',
    );

    p = await iniciar();
    reclamacoes = { nonce: p.nonce, email };
    audiencia = 'outra-app';
    expect((await voltar(p.state)).searchParams.get('erro')).toBe(
      'token_invalido',
    );

    p = await iniciar();
    reclamacoes = { nonce: p.nonce, email: 'ninguem@cm-teste.pt' };
    audiencia = CLIENTE;
    expect((await voltar(p.state)).searchParams.get('erro')).toBe('sem_acesso');
  });

  it('o fornecedor recusou, ou município sem OIDC', async () => {
    const r = await ctx
      .http()
      .get('/v1/painel/auth/oidc/retorno?error=access_denied&state=x')
      .expect(302);
    expect(new URL(r.headers['location']).searchParams.get('erro')).toBe(
      'recusado_pelo_fornecedor',
    );
    await ctx.http().get('/v1/painel/auth/oidc/nao-existe/iniciar').expect(404);
  });
});
