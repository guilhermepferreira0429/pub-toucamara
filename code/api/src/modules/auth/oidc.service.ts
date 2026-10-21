import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { DatabaseService } from '../../database/database.service.js';
import { AuthService } from './auth.service.js';

const PEDIDO_MINUTOS = 10;
/** A configuração do fornecedor (/.well-known) muda pouco. */
const DESCOBERTA_MS = 60 * 60_000;

const esquemaDescoberta = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
});
type Descoberta = z.infer<typeof esquemaDescoberta>;

interface Fornecedor {
  municipio_id: string;
  slug: string;
  nome_botao: string;
  issuer: string;
  client_id: string;
  segredo_env: string | null;
  escopos: string;
}

/** Erro do login: volta para /entrar?erro=codigo. */
export class ErroOidc extends Error {
  constructor(readonly codigo: string) {
    super(codigo);
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const aleatorio = () => randomBytes(32).toString('base64url');

/**
 * Login do painel com o fornecedor de identidade da câmara (OIDC,
 * Authorization Code + PKCE). O id_token é validado (assinatura pelo JWKS,
 * issuer, audience, nonce, validade); o email tem de ser de um utilizador
 * ativo desse município. No fim cria um link de entrada de uso único e a web
 * entra como no link mágico (/entrar?token=…).
 */
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private readonly descobertas = new Map<
    string,
    { d: Descoberta; ate: number }
  >();
  /** Trocável nos testes. */
  buscar: (url: string, init?: RequestInit) => Promise<Response> = (u, i) =>
    fetch(u, i);

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  private get urlRetorno(): string {
    return `${this.config.get<string>('app.apiUrl') ?? ''}/v1/painel/auth/oidc/retorno`;
  }

  get webUrl(): string {
    return this.config.get<string>('app.webUrl') ?? '';
  }

  /** Os botões da página de entrada. */
  async fornecedores() {
    const r = await this.db.query<{
      municipio: string;
      nome: string;
      nome_botao: string;
    }>(
      `SELECT m.slug AS municipio, m.nome, f.nome_botao
       FROM oidc_fornecedores f JOIN municipios m ON m.id = f.municipio_id
       WHERE f.ativo ORDER BY m.nome`,
    );
    return { itens: r };
  }

  private async fornecedor(campo: 'slug' | 'id', valor: string) {
    const [f] = await this.db.query<Fornecedor>(
      `SELECT f.municipio_id, m.slug, f.nome_botao, f.issuer, f.client_id, f.segredo_env, f.escopos
       FROM oidc_fornecedores f JOIN municipios m ON m.id = f.municipio_id
       WHERE f.ativo AND ${campo === 'slug' ? 'm.slug' : 'm.id'} = $1`,
      [valor],
    );
    return f ?? null;
  }

  private async descoberta(issuer: string): Promise<Descoberta> {
    const c = this.descobertas.get(issuer);
    if (c && c.ate > Date.now()) return c.d;
    const r = await this.buscar(
      `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(10_000) },
    ).catch(() => null);
    const json: unknown = r?.ok ? await r.json().catch(() => null) : null;
    const v = esquemaDescoberta.safeParse(json);
    if (
      !v.success ||
      v.data.issuer.replace(/\/$/, '') !== issuer.replace(/\/$/, '')
    ) {
      this.logger.warn(`Descoberta OIDC falhou para ${issuer}`);
      throw new ErroOidc('fornecedor_indisponivel');
    }
    this.descobertas.set(issuer, {
      d: v.data,
      ate: Date.now() + DESCOBERTA_MS,
    });
    return v.data;
  }

  /** O endereço do fornecedor para onde o browser vai (302). */
  async iniciar(slug: string): Promise<string> {
    const f = await this.fornecedor('slug', slug);
    if (!f) {
      throw new ErroApi(
        HttpStatus.NOT_FOUND,
        'sem_oidc',
        'Este município não tem login com a conta da câmara.',
      );
    }
    const d = await this.descoberta(f.issuer);
    const state = aleatorio();
    const nonce = aleatorio();
    const verificador = aleatorio();
    await this.db.query(`DELETE FROM oidc_pedidos WHERE expira_em < now()`);
    await this.db.query(
      `INSERT INTO oidc_pedidos (state_hash, municipio_id, nonce, verificador, expira_em)
       VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
      [sha256(state), f.municipio_id, nonce, verificador, PEDIDO_MINUTOS],
    );
    const u = new URL(d.authorization_endpoint);
    u.search = new URLSearchParams({
      response_type: 'code',
      client_id: f.client_id,
      redirect_uri: this.urlRetorno,
      scope: f.escopos,
      state,
      nonce,
      code_challenge: sha256(verificador).toString('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return u.toString();
  }

  /**
   * O fornecedor devolveu o browser com ?code&state. Devolve o endereço da
   * web para onde seguir (com o token de entrada, ou com o erro).
   */
  async retorno(q: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    try {
      const token = await this.trocar(q);
      return `${this.webUrl}/entrar?token=${encodeURIComponent(token)}`;
    } catch (e) {
      const codigo = e instanceof ErroOidc ? e.codigo : 'erro_oidc';
      if (!(e instanceof ErroOidc)) {
        this.logger.error(`Login OIDC falhou: ${(e as Error).message}`);
      }
      return `${this.webUrl}/entrar?erro=${codigo}`;
    }
  }

  private async trocar(q: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<string> {
    if (q.error) throw new ErroOidc('recusado_pelo_fornecedor');
    if (!q.code || !q.state) throw new ErroOidc('pedido_invalido');
    // O state só serve uma vez.
    const [p] = await this.db.query<{
      municipio_id: string;
      nonce: string;
      verificador: string;
    }>(
      `DELETE FROM oidc_pedidos WHERE state_hash = $1 AND expira_em > now()
       RETURNING municipio_id, nonce, verificador`,
      [sha256(q.state)],
    );
    if (!p) throw new ErroOidc('pedido_expirado');
    const f = await this.fornecedor('id', p.municipio_id);
    if (!f) throw new ErroOidc('sem_oidc');
    const d = await this.descoberta(f.issuer);

    const segredo = f.segredo_env ? process.env[f.segredo_env] : undefined;
    if (f.segredo_env && !segredo) {
      this.logger.error(`${f.segredo_env} por configurar (OIDC de ${f.slug}).`);
      throw new ErroOidc('fornecedor_indisponivel');
    }
    const corpo = new URLSearchParams({
      grant_type: 'authorization_code',
      code: q.code,
      redirect_uri: this.urlRetorno,
      client_id: f.client_id,
      code_verifier: p.verificador,
      ...(segredo ? { client_secret: segredo } : {}),
    });
    const r = await this.buscar(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const tokens = r?.ok
      ? ((await r.json().catch(() => null)) as { id_token?: unknown } | null)
      : null;
    if (typeof tokens?.id_token !== 'string') {
      throw new ErroOidc('troca_falhou');
    }

    const { createRemoteJWKSet, jwtVerify, customFetch } = await import('jose');
    let email: string;
    try {
      const jwks = createRemoteJWKSet(new URL(d.jwks_uri), {
        [customFetch]: (url: string, init: RequestInit) =>
          this.buscar(url, init),
      });
      const { payload } = await jwtVerify(tokens.id_token, jwks, {
        issuer: d.issuer,
        audience: f.client_id,
      });
      if (payload['nonce'] !== p.nonce) throw new Error('nonce');
      if (payload['email_verified'] === false) throw new Error('email');
      const e = payload['email'];
      email = typeof e === 'string' ? e.trim().toLowerCase() : '';
      if (!email) throw new Error('sem email');
    } catch {
      throw new ErroOidc('token_invalido');
    }

    const token = await this.auth.linkDeEntrada(email, p.municipio_id);
    if (!token) throw new ErroOidc('sem_acesso');
    return token;
  }
}
