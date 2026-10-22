/*
 * Firebase Cloud Messaging, API HTTP v1 (documentação da Google, out. 2026):
 *
 * - Envio: POST https://fcm.googleapis.com/v1/projects/{projectId}/messages:send
 *   com `Authorization: Bearer <token OAuth2>` e corpo { message: {...} }.
 *   Resposta 200: { name: "projects/{projectId}/messages/{id}" }.
 *   https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages/send
 * - Token OAuth2 de uma conta de serviço: JWT RS256 assinado com a chave
 *   privada da conta (iss = email da conta, scope, aud = endpoint do token,
 *   iat, exp até 1 h) trocado em POST https://oauth2.googleapis.com/token
 *   (grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>).
 *   Resposta: { access_token, expires_in, token_type: "Bearer" }.
 *   https://developers.google.com/identity/protocols/oauth2/service-account#httprest
 * - Erros: 404 NOT_FOUND / errorCode UNREGISTERED = o token do telemóvel já
 *   não vale (app desinstalada ou token renovado): desativa-se o dispositivo.
 *   401 = token OAuth expirado ou revogado: pede-se outro e tenta-se uma vez.
 */

export const URL_TOKEN_GOOGLE = 'https://oauth2.googleapis.com/token';
export const ESCOPO_FCM = 'https://www.googleapis.com/auth/firebase.messaging';
export const urlEnvioFcm = (projectId: string) =>
  `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

/** Validade pedida ao JWT de troca (o máximo que a Google aceita é 1 h). */
const VALIDADE_JWT_S = 3600;
/** Renova o token OAuth um pouco antes de expirar. */
const MARGEM_RENOVACAO_MS = 60_000;

export type Buscar = (url: string, init: RequestInit) => Promise<Response>;

export interface CredenciaisFcm {
  projectId: string;
  clientEmail: string;
  /** PEM PKCS#8 ("-----BEGIN PRIVATE KEY-----"). */
  privateKey: string;
}

/** Os três canais Android da app (criados pela app no arranque). */
export type TipoPush = 'urgente' | 'avisos' | 'processos';
export const TIPOS_PUSH: readonly TipoPush[] = [
  'urgente',
  'avisos',
  'processos',
];

/** channel_id do canal Android de cada tipo (a app cria-os com estes ids). */
export const CANAL_ANDROID: Record<TipoPush, string> = {
  urgente: 'toucamara_urgente',
  avisos: 'toucamara_avisos',
  processos: 'toucamara_processos',
};

export interface Push {
  tipo: TipoPush;
  titulo: string;
  corpo: string;
  /** Rota da app ("/processos/<id>") ou URL da página pública. */
  link?: string | null;
  /** O id do objeto (processo, aviso, emergência...). */
  id?: string | null;
  /** De onde vem: 'emergencia', 'aviso_zona', 'processo_fase'... */
  origem: string;
}

export interface MensagemFcm {
  token: string;
  notification: { title: string; body: string };
  data: Record<string, string>;
  android: {
    priority: 'HIGH' | 'NORMAL';
    ttl: string;
    notification: {
      channel_id: string;
      tag?: string;
    };
  };
}

const MAX_TITULO = 120;
const MAX_CORPO = 600;

function cortar(texto: string, max: number): string {
  const t = texto.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

/**
 * A mensagem FCM v1 de um push: notificação (título, corpo), dados para a
 * app abrir o ecrã certo (só strings, como o FCM exige) e o canal Android
 * do tipo. Os urgentes vão com prioridade alta e validade curta.
 */
export function mensagemFcm(token: string, p: Push): MensagemFcm {
  const data: Record<string, string> = { tipo: p.tipo, origem: p.origem };
  if (p.link) data.link = p.link;
  if (p.id) data.id = p.id;
  return {
    token,
    notification: {
      title: cortar(p.titulo, MAX_TITULO),
      body: cortar(p.corpo, MAX_CORPO),
    },
    data,
    android: {
      priority: p.tipo === 'urgente' ? 'HIGH' : 'NORMAL',
      // Um aviso urgente com 1 dia já não serve; o resto pode esperar 4 dias.
      ttl: p.tipo === 'urgente' ? '86400s' : '345600s',
      notification: {
        channel_id: CANAL_ANDROID[p.tipo],
        // O mesmo objeto substitui a notificação anterior em vez de empilhar.
        ...(p.id ? { tag: `${p.origem}:${p.id}`.slice(0, 64) } : {}),
      },
    },
  };
}

export type ResultadoFcm =
  | { estado: 'enviado'; fcmId: string | null }
  | { estado: 'token_invalido'; erro: string }
  | { estado: 'falhado'; erro: string };

/**
 * O texto de um SMS sem o link do fim (no push a app abre o ecrã certo):
 * '… Envie aqui: https://…/r/8K2F9Q' → '…'.
 */
export function textoSemLink(texto: string): string {
  return texto
    .replace(
      /\s*(?:Envie aqui:|Veja o que falta:|Acompanhe aqui:|Mais info[^:]*:)?\s*https?:\/\/\S+\s*$/i,
      '',
    )
    .trim();
}

/** A chave das variáveis de ambiente vem com "\n" literais: volta a PEM. */
export function lerChavePrivada(bruta: string): string {
  return bruta.replace(/\\n/g, '\n').trim();
}

interface ErroGoogle {
  error?: {
    code?: number;
    status?: string;
    message?: string;
    details?: { '@type'?: string; errorCode?: string }[];
  };
}

/** O errorCode do FcmError (UNREGISTERED, INVALID_ARGUMENT...), se vier. */
export function codigoErroFcm(corpo: unknown): string | null {
  const e = (corpo as ErroGoogle | null)?.error;
  const detalhe = e?.details?.find((d) => typeof d?.errorCode === 'string');
  return detalhe?.errorCode ?? e?.status ?? null;
}

/**
 * Cliente FCM HTTP v1 com o token OAuth2 em cache até perto de expirar.
 * `buscar` é o fetch (os testes passam um falso). Nunca lança no envio: o
 * erro volta no resultado.
 */
export class ClienteFcm {
  private token: { valor: string; expiraEm: number } | null = null;
  private aPedir: Promise<string> | null = null;
  private chave: CryptoKey | null = null;

  constructor(
    private readonly cred: CredenciaisFcm,
    private readonly buscar: Buscar = fetch,
    private readonly agora: () => number = Date.now,
  ) {}

  /** O JWT assinado que se troca pelo token OAuth2. */
  async jwtDeTroca(): Promise<string> {
    const { SignJWT, importPKCS8 } = await import('jose');
    this.chave ??= await importPKCS8(
      lerChavePrivada(this.cred.privateKey),
      'RS256',
    );
    const iat = Math.floor(this.agora() / 1000);
    return new SignJWT({ scope: ESCOPO_FCM })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.cred.clientEmail)
      .setSubject(this.cred.clientEmail)
      .setAudience(URL_TOKEN_GOOGLE)
      .setIssuedAt(iat)
      .setExpirationTime(iat + VALIDADE_JWT_S)
      .sign(this.chave);
  }

  /** O token OAuth2: o da cache se ainda valer, senão pede outro (um de cada vez). */
  async tokenAcesso(): Promise<string> {
    if (this.token && this.token.expiraEm - MARGEM_RENOVACAO_MS > this.agora())
      return this.token.valor;
    this.aPedir ??= this.pedirToken().finally(() => (this.aPedir = null));
    return this.aPedir;
  }

  private async pedirToken(): Promise<string> {
    const corpo = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await this.jwtDeTroca(),
    });
    const r = await this.buscar(URL_TOKEN_GOOGLE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await r.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    } | null;
    if (!r.ok || !json?.access_token) {
      throw new Error(
        `OAuth Google ${r.status}: ${json?.error_description ?? json?.error ?? 'sem token'}`,
      );
    }
    this.token = {
      valor: json.access_token,
      expiraEm: this.agora() + (json.expires_in ?? 3600) * 1000,
    };
    return json.access_token;
  }

  /** Envia uma mensagem. Com 401 renova o token e tenta mais uma vez. */
  async enviar(m: MensagemFcm): Promise<ResultadoFcm> {
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      let r: Response;
      try {
        const token = await this.tokenAcesso();
        r = await this.buscar(urlEnvioFcm(this.cred.projectId), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ message: m }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        return { estado: 'falhado', erro: (e as Error).message.slice(0, 300) };
      }
      const json = (await r.json().catch(() => null)) as
        ({ name?: string } & ErroGoogle) | null;
      if (r.ok) return { estado: 'enviado', fcmId: json?.name ?? null };
      if (r.status === 401 && tentativa === 0) {
        this.token = null;
        continue;
      }
      const codigo = codigoErroFcm(json);
      const erro =
        `${r.status} ${codigo ?? ''} ${json?.error?.message ?? ''}`.trim();
      if (r.status === 404 || codigo === 'UNREGISTERED') {
        return { estado: 'token_invalido', erro: erro.slice(0, 300) };
      }
      return { estado: 'falhado', erro: erro.slice(0, 300) };
    }
    return { estado: 'falhado', erro: '401 token OAuth recusado' };
  }
}
