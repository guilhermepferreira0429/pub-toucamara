import { createVerify, generateKeyPairSync } from 'crypto';
import {
  CANAL_ANDROID,
  ClienteFcm,
  codigoErroFcm,
  ESCOPO_FCM,
  lerChavePrivada,
  mensagemFcm,
  textoSemLink,
  URL_TOKEN_GOOGLE,
  urlEnvioFcm,
} from './fcm';
import { tipoPushDe } from './push.service';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CRED = {
  projectId: 'toucamara-teste',
  clientEmail: 'push@toucamara-teste.iam.gserviceaccount.com',
  // Como vem do .env: numa linha, com "\n" literais.
  privateKey: privateKey.replace(/\n/g, '\\n'),
};

interface Pedido {
  url: string;
  init: RequestInit;
}

function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** fetch falso: responde ao token e ao envio pela ordem das respostas dadas. */
function buscarFalso(envios: Response[] = []) {
  const pedidos: Pedido[] = [];
  let tokens = 0;
  const buscar = (url: string, init: RequestInit) => {
    pedidos.push({ url, init });
    if (url === URL_TOKEN_GOOGLE) {
      tokens++;
      return Promise.resolve(
        json(200, {
          access_token: `ya29.token-${tokens}`,
          expires_in: 3599,
          token_type: 'Bearer',
        }),
      );
    }
    return Promise.resolve(
      envios.shift() ??
        json(200, { name: 'projects/toucamara-teste/messages/0:1' }),
    );
  };
  return {
    buscar,
    pedidos,
    tokens: () => pedidos.filter((p) => p.url === URL_TOKEN_GOOGLE),
    envios: () => pedidos.filter((p) => p.url !== URL_TOKEN_GOOGLE),
  };
}

function lerJwt(jwt: string) {
  const [h, p, assinatura] = jwt.split('.');
  const dec = (x: string) =>
    JSON.parse(Buffer.from(x, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
  const valida = createVerify('RSA-SHA256')
    .update(`${h}.${p}`)
    .verify(publicKey, Buffer.from(assinatura, 'base64url'));
  return { cabecalho: dec(h), claims: dec(p), valida };
}

const PUSH = {
  tipo: 'urgente' as const,
  titulo: 'Emergência: Cheia no rio',
  corpo: 'Afaste-se das margens.',
  link: '/avisos',
  id: '11111111-1111-1111-1111-111111111111',
  origem: 'emergencia',
};

/*
 * O jose só existe em ESM: o `await import('jose')` precisa do jest com
 * --experimental-vm-modules (como os e2e). Correr estes testes com
 *   node --experimental-vm-modules node_modules/jest/bin/jest.js src/modules/app-municipe
 * Com `npx jest` simples ficam saltados (os de baixo correm sempre).
 */
const comEsm =
  process.execArgv.some((a) => a.includes('experimental-vm-modules')) ||
  (process.env.NODE_OPTIONS ?? '').includes('experimental-vm-modules');
if (!comEsm) {
  console.warn(
    'fcm.spec: ClienteFcm saltado (falta --experimental-vm-modules para o jose).',
  );
}

(comEsm ? describe : describe.skip)('ClienteFcm', () => {
  it('o JWT de troca: RS256, assinado com a chave da conta de serviço e com as claims da Google', async () => {
    const agora = Date.UTC(2026, 9, 22, 10, 0, 0);
    const c = new ClienteFcm(CRED, buscarFalso().buscar, () => agora);
    const { cabecalho, claims, valida } = lerJwt(await c.jwtDeTroca());
    expect(valida).toBe(true);
    expect(cabecalho).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims).toEqual({
      iss: CRED.clientEmail,
      sub: CRED.clientEmail,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      iat: agora / 1000,
      exp: agora / 1000 + 3600,
    });
    expect(ESCOPO_FCM).toBe(claims.scope);
  });

  it('troca o JWT pelo token OAuth e envia no formato da API HTTP v1', async () => {
    const f = buscarFalso();
    const c = new ClienteFcm(CRED, f.buscar);
    const r = await c.enviar(mensagemFcm('fcm-token-do-telemovel-0001', PUSH));
    expect(r).toEqual({
      estado: 'enviado',
      fcmId: 'projects/toucamara-teste/messages/0:1',
    });

    const [token] = f.tokens();
    expect(token.init.method).toBe('POST');
    expect((token.init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = new URLSearchParams(token.init.body as string);
    expect(form.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    expect(lerJwt(form.get('assertion')!).valida).toBe(true);

    const [envio] = f.envios();
    expect(envio.url).toBe(
      'https://fcm.googleapis.com/v1/projects/toucamara-teste/messages:send',
    );
    expect(envio.url).toBe(urlEnvioFcm(CRED.projectId));
    expect(envio.init.method).toBe('POST');
    expect((envio.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer ya29.token-1',
    );
    expect(JSON.parse(envio.init.body as string)).toEqual({
      message: {
        token: 'fcm-token-do-telemovel-0001',
        notification: {
          title: 'Emergência: Cheia no rio',
          body: 'Afaste-se das margens.',
        },
        data: {
          tipo: 'urgente',
          origem: 'emergencia',
          link: '/avisos',
          id: PUSH.id,
        },
        android: {
          priority: 'HIGH',
          ttl: '86400s',
          notification: {
            channel_id: 'toucamara_urgente',
            tag: `emergencia:${PUSH.id}`,
          },
        },
      },
    });
  });

  it('reutiliza o token OAuth até perto de expirar e depois pede outro', async () => {
    let agora = Date.UTC(2026, 9, 22, 10, 0, 0);
    const f = buscarFalso();
    const c = new ClienteFcm(CRED, f.buscar, () => agora);
    const m = mensagemFcm('fcm-token-do-telemovel-0001', PUSH);
    await c.enviar(m);
    await c.enviar(m);
    agora += 55 * 60_000; // ainda dentro da validade (59 min 59 s - 1 min)
    await c.enviar(m);
    expect(f.tokens()).toHaveLength(1);
    expect(f.envios()).toHaveLength(3);

    agora += 4 * 60_000; // a menos de 1 minuto de expirar
    await c.enviar(m);
    expect(f.tokens()).toHaveLength(2);
    expect(
      (f.envios()[3].init.headers as Record<string, string>).Authorization,
    ).toBe('Bearer ya29.token-2');
  });

  it('pedidos em paralelo pedem um só token', async () => {
    const f = buscarFalso();
    const c = new ClienteFcm(CRED, f.buscar);
    await Promise.all([c.tokenAcesso(), c.tokenAcesso(), c.tokenAcesso()]);
    expect(f.tokens()).toHaveLength(1);
  });

  it('UNREGISTERED (404) → token_invalido', async () => {
    const f = buscarFalso([
      json(404, {
        error: {
          code: 404,
          message: 'Requested entity was not found.',
          status: 'NOT_FOUND',
          details: [
            {
              '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
              errorCode: 'UNREGISTERED',
            },
          ],
        },
      }),
    ]);
    const r = await new ClienteFcm(CRED, f.buscar).enviar(
      mensagemFcm('fcm-token-antigo-000000001', PUSH),
    );
    expect(r).toMatchObject({ estado: 'token_invalido' });
    expect((r as { erro: string }).erro).toContain('UNREGISTERED');
  });

  it('outro erro (400, 500) → falhado, sem desativar', async () => {
    const f = buscarFalso([
      json(400, {
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: 'Invalid value at message.android.ttl',
        },
      }),
      json(503, { error: { code: 503, status: 'UNAVAILABLE' } }),
    ]);
    const c = new ClienteFcm(CRED, f.buscar);
    const m = mensagemFcm('fcm-token-do-telemovel-0001', PUSH);
    expect(await c.enviar(m)).toMatchObject({
      estado: 'falhado',
      erro: expect.stringContaining('INVALID_ARGUMENT') as string,
    });
    expect(await c.enviar(m)).toMatchObject({ estado: 'falhado' });
  });

  it('401: renova o token OAuth e tenta mais uma vez', async () => {
    const f = buscarFalso([
      json(401, { error: { code: 401, status: 'UNAUTHENTICATED' } }),
    ]);
    const r = await new ClienteFcm(CRED, f.buscar).enviar(
      mensagemFcm('fcm-token-do-telemovel-0001', PUSH),
    );
    expect(r.estado).toBe('enviado');
    expect(f.tokens()).toHaveLength(2);
    expect(f.envios()).toHaveLength(2);
  });

  it('a rede a falhar → falhado (não lança)', async () => {
    const c = new ClienteFcm(CRED, () =>
      Promise.reject(new Error('ECONNRESET')),
    );
    expect(
      await c.enviar(mensagemFcm('fcm-token-do-telemovel-0001', PUSH)),
    ).toEqual({ estado: 'falhado', erro: 'ECONNRESET' });
  });
});

describe('mensagemFcm', () => {
  it('um canal Android por tipo; só os urgentes com prioridade alta', () => {
    for (const tipo of ['urgente', 'avisos', 'processos'] as const) {
      const m = mensagemFcm('t'.repeat(30), { ...PUSH, tipo });
      expect(m.android.notification.channel_id).toBe(CANAL_ANDROID[tipo]);
      expect(m.android.priority).toBe(tipo === 'urgente' ? 'HIGH' : 'NORMAL');
      expect(m.data.tipo).toBe(tipo);
    }
    expect(CANAL_ANDROID).toEqual({
      urgente: 'toucamara_urgente',
      avisos: 'toucamara_avisos',
      processos: 'toucamara_processos',
    });
  });

  it('dados só com strings; sem link nem id não vão vazios; textos longos cortados', () => {
    const m = mensagemFcm('t'.repeat(30), {
      tipo: 'avisos',
      titulo: 'x'.repeat(200),
      corpo: `  ${'y'.repeat(1000)}  `,
      origem: 'aviso_zona',
    });
    expect(m.data).toEqual({ tipo: 'avisos', origem: 'aviso_zona' });
    expect(Object.values(m.data).every((v) => typeof v === 'string')).toBe(
      true,
    );
    expect(m.notification.title).toHaveLength(120);
    expect(m.notification.title.endsWith('…')).toBe(true);
    expect(m.notification.body).toHaveLength(600);
    expect(m.android.notification.tag).toBeUndefined();
    expect(m.android.ttl).toBe('345600s');
  });
});

describe('auxiliares', () => {
  it('lerChavePrivada: "\\n" literais → PEM', () => {
    expect(lerChavePrivada(CRED.privateKey)).toBe(privateKey.trim());
  });

  it('codigoErroFcm: o errorCode do FcmError, senão o status', () => {
    expect(
      codigoErroFcm({
        error: {
          status: 'NOT_FOUND',
          details: [{ errorCode: 'UNREGISTERED' }],
        },
      }),
    ).toBe('UNREGISTERED');
    expect(codigoErroFcm({ error: { status: 'UNAVAILABLE' } })).toBe(
      'UNAVAILABLE',
    );
    expect(codigoErroFcm(null)).toBeNull();
  });

  it('textoSemLink: o SMS sem o link do fim', () => {
    expect(
      textoSemLink(
        'CM Teste: o processo CP 1/2026 aguarda documentos seus: planta. Envie aqui: https://x.pt/r/8K2F9Q',
      ),
    ).toBe('CM Teste: o processo CP 1/2026 aguarda documentos seus: planta.');
    expect(
      textoSemLink('CM Teste: o processo está em análise. https://x.pt/r/AB'),
    ).toBe('CM Teste: o processo está em análise.');
    expect(textoSemLink('Sem link.')).toBe('Sem link.');
  });

  it('tipoPushDe: o tipo da notificação → canal', () => {
    expect(tipoPushDe('urgente')).toBe('urgente');
    expect(tipoPushDe('emergencia')).toBe('urgente');
    expect(tipoPushDe('aviso_zona')).toBe('avisos');
    expect(tipoPushDe('agora')).toBe('avisos');
    expect(tipoPushDe('processo')).toBe('processos');
    expect(tipoPushDe('pagamento')).toBe('processos');
  });
});
