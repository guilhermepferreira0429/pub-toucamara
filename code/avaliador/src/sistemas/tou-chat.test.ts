import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { ErroAdaptador, type Sistema } from '../tipos.js';
import { AdaptadorTouChat, baseApi } from './tou-chat.js';

const FIXTURES = new URL('../../test/fixtures/', import.meta.url);
const gravado = readFileSync(new URL('chat-sse.txt', FIXTURES), 'utf8');
const comErro = readFileSync(new URL('chat-sse-erro.txt', FIXTURES), 'utf8');

/** Imitação local da API do chat: o mesmo contrato, respostas gravadas. */
let servidor: Server;
let url = '';
let limitarProximas = 0;
const pedidos: { url: string; corpo: unknown }[] = [];

before(async () => {
  servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      const json = corpo ? JSON.parse(corpo) : null;
      pedidos.push({ url: req.url ?? '', corpo: json });
      if (req.url === '/v1/chat/sessoes') {
        if (limitarProximas > 0) {
          limitarProximas--;
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              erro: {
                codigo: 'demasiados_pedidos',
                mensagem: 'Demasiadas sessões.',
              },
            }),
          );
          return;
        }
        if (json.municipio === 'nao-existe') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              erro: {
                codigo: 'nao_encontrado',
                mensagem: 'Município não existe.',
              },
            }),
          );
          return;
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sessao: 'a'.repeat(32), saudacao: 'Olá' }));
        return;
      }
      if (req.url?.endsWith('/mensagens')) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.flushHeaders();
        if (json.texto === 'pendurar') return; // nunca acaba
        const fonte = json.texto === 'erro' ? comErro : gravado;
        // Aos bocados, para o parser ter de juntar eventos cortados.
        let i = 0;
        const t = setInterval(() => {
          res.write(fonte.slice(i, i + 40));
          i += 40;
          if (i >= fonte.length) {
            clearInterval(t);
            res.end();
          }
        }, 2);
        return;
      }
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
  servidor.closeAllConnections();
  servidor.close();
});

const sistema = (extra: Partial<Sistema> = {}): Sistema => ({
  id: 's1',
  nome: 'Tou, Câmara? · teste · chat',
  municipio_id: null,
  adaptador: 'tou-chat',
  url,
  config: { slug: 'guimaraes' },
  nosso: true,
  ...extra,
});

test('baseApi: junta /v1 só quando falta', () => {
  assert.equal(baseApi({ url: 'http://x:3001/' }), 'http://x:3001/v1');
  assert.equal(baseApi({ url: 'https://api.x.pt/v1' }), 'https://api.x.pt/v1');
});

test('tou-chat: sessão nova, mensagem, SSE até fim, com texto, ferramentas e fontes', async () => {
  pedidos.length = 0;
  const a = new AdaptadorTouChat(sistema());
  assert.equal(a.paralelo, 4);
  assert.equal(a.pausa(), 0);
  const r = await a.perguntar({
    texto: 'Quero fazer obras na cozinha, preciso de licença?',
    idioma: 'pt-PT',
  });
  assert.match(r.texto, /^Obras só no interior/);
  assert.deepEqual(r.ferramentas, ['procurar_conhecimento', 'encaminhar']);
  assert.equal(r.fontes?.length, 2);
  assert.ok(r.latencia_ms >= 0);
  assert.deepEqual(pedidos[0], {
    url: '/v1/chat/sessoes',
    corpo: { municipio: 'guimaraes', idioma: 'pt-PT' },
  });
  assert.deepEqual(pedidos[1], {
    url: `/v1/chat/sessoes/${'a'.repeat(32)}/mensagens`,
    corpo: { texto: 'Quero fazer obras na cozinha, preciso de licença?' },
  });
});

test('tou-chat: espera e repete quando a API limita as sessões (429)', async () => {
  limitarProximas = 2;
  const a = new AdaptadorTouChat(sistema(), { esperaLimiteMs: 20 });
  const r = await a.perguntar({ texto: 'olá', idioma: 'pt-PT' });
  assert.match(r.texto, /Obras/);
  assert.equal(limitarProximas, 0);
});

test('tou-chat: evento erro → ErroAdaptador não fatal', async () => {
  const a = new AdaptadorTouChat(sistema());
  await assert.rejects(a.perguntar({ texto: 'erro', idioma: 'pt-PT' }), (e) => {
    assert.ok(e instanceof ErroAdaptador);
    assert.equal(e.fatal, false);
    assert.match(e.message, /ia_indisponivel/);
    return true;
  });
});

test('tou-chat: município desconhecido → fatal', async () => {
  const a = new AdaptadorTouChat(sistema({ config: { slug: 'nao-existe' } }));
  await assert.rejects(a.perguntar({ texto: 'x', idioma: 'pt-PT' }), (e) => {
    assert.ok(e instanceof ErroAdaptador);
    assert.equal(e.fatal, true);
    assert.match(e.message, /404 nao_encontrado/);
    return true;
  });
});

test('tou-chat: sem fim dentro do tempo → ErroAdaptador', async () => {
  const a = new AdaptadorTouChat(sistema(), { timeoutMs: 300 });
  await assert.rejects(
    a.perguntar({ texto: 'pendurar', idioma: 'pt-PT' }),
    /Sem resposta completa/,
  );
});

test('tou-chat: API desligada → fatal', async () => {
  const a = new AdaptadorTouChat(sistema({ url: 'http://127.0.0.1:9' }));
  await assert.rejects(a.perguntar({ texto: 'x', idioma: 'pt-PT' }), (e) => {
    assert.ok(e instanceof ErroAdaptador);
    assert.equal(e.fatal, true);
    return true;
  });
});
