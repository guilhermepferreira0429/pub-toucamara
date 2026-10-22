/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'crypto';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  linha,
  MUNICIPIO,
  novoTelefone,
  smsPara,
} from './app';

function novoIp(): string {
  return `198.51.100.${randomInt(1, 255)}`;
}

/**
 * Porta para as IAs: o servidor MCP (público e pessoal), a autorização por
 * SMS na página /ia e o painel com o que os assistentes pediram.
 */
describe('Porta para as IAs (e2e)', () => {
  let ctx: Contexto;
  let painel: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    painel = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  const rpc = (caminho: string, corpo: unknown, sessao?: string) => {
    const r = ctx
      .http()
      .post(caminho)
      .set('Accept', 'application/json, text/event-stream')
      .set('X-Forwarded-For', novoIp());
    if (sessao) r.set('Mcp-Session-Id', sessao);
    return r.send(corpo as object);
  };

  /** Liga um assistente: pede o código, lê-o do SMS e confirma. */
  async function ligar(telefone = novoTelefone(), assistente = 'Claude') {
    const p = await ctx
      .http()
      .post('/v1/public/ias/pedir-codigo')
      .set('X-Forwarded-For', novoIp())
      .send({ municipio: MUNICIPIO, telefone, assistente })
      .expect(202);
    const [sms] = await smsPara(ctx, telefone, 'identificacao');
    const codigo = /\b(\d{6})\b/.exec(sms.corpo)?.[1];
    expect(codigo).toBeDefined();
    const c = await ctx
      .http()
      .post('/v1/public/ias/confirmar')
      .send({ pedido: p.body.pedido, codigo })
      .expect(201);
    return { telefone, ...c.body } as {
      telefone: string;
      ligacao_id: string;
      chave: string;
      caminho_mcp: string;
    };
  }

  describe('MCP público', () => {
    const caminho = `/v1/mcp/${MUNICIPIO}`;

    it('initialize: versão acordada, ferramentas, instruções e Mcp-Session-Id', async () => {
      const r = await rpc(caminho, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'claude-ai', version: '1.0' },
        },
      }).expect(200);
      expect(r.headers['mcp-session-id']).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(r.body).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: expect.objectContaining({
            name: `toucamara-${MUNICIPIO}`,
          }),
          instructions: expect.stringContaining('112'),
        },
      });
    });

    it('versão desconhecida → a mais recente; notificação → 202 sem corpo', async () => {
      const r = await rpc(caminho, {
        jsonrpc: '2.0',
        id: 'a',
        method: 'initialize',
        params: { protocolVersion: '1999-01-01' },
      }).expect(200);
      expect(r.body.result.protocolVersion).toBe('2025-11-25');
      const n = await rpc(caminho, {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }).expect(202);
      expect(n.text).toBe('');
    });

    it('tools/list só tem as públicas, com anotações', async () => {
      const r = await rpc(caminho, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      }).expect(200);
      const nomes = r.body.result.tools.map((t: { name: string }) => t.name);
      expect(nomes).toEqual(
        expect.arrayContaining([
          'procurar_conhecimento',
          'encaminhar',
          'simular_taxa',
        ]),
      );
      expect(nomes).not.toContain('registar_ocorrencia');
      expect(nomes).not.toContain('identificar_municipe');
      const procurar = r.body.result.tools.find(
        (t: { name: string }) => t.name === 'procurar_conhecimento',
      );
      expect(procurar).toMatchObject({
        inputSchema: {
          type: 'object',
          properties: { pergunta: expect.any(Object) },
        },
        annotations: { readOnlyHint: true },
      });
      expect(procurar.inputSchema.$schema).toBeUndefined();
    });

    it('tools/call corre a ferramenta e fica no feed do painel', async () => {
      const ini = await rpc(caminho, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientInfo: { name: 'chatgpt' } },
      });
      const sessao = String(ini.headers['mcp-session-id']);
      const r = await rpc(
        caminho,
        {
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'procurar_conhecimento',
            arguments: { pergunta: 'Preciso de licença para fazer obras?' },
          },
        },
        sessao,
      ).expect(200);
      expect(r.body.result.isError).toBeUndefined();
      expect(r.body.result.content[0]).toMatchObject({ type: 'text' });
      expect(JSON.parse(r.body.result.content[0].text)).toEqual(
        r.body.result.structuredContent,
      );

      const c = await linha(
        ctx.db,
        `SELECT canal::text AS canal, municipe_id FROM conversas WHERE provider_id = $1`,
        [`mcp:${sessao}`],
      );
      expect(c).toEqual({ canal: 'ia', municipe_id: null });

      const feed = await ctx
        .http()
        .get('/v1/painel/ias/atividade')
        .set(painel)
        .expect(200);
      expect(feed.body.pedidos[0]).toMatchObject({
        ferramenta: 'procurar_conhecimento',
        ok: true,
        cliente: 'chatgpt',
        ligacao: null,
        resumo: expect.stringContaining('Preciso de licença'),
      });
    });

    it('ferramenta pessoal sem chave → erro JSON-RPC que manda ligar em /ia', async () => {
      const r = await rpc(caminho, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'registar_ocorrencia', arguments: {} },
      }).expect(200);
      expect(r.body.error).toMatchObject({
        code: -32602,
        message: expect.stringContaining('/ia'),
      });
    });

    it('entrada inválida → resultado com isError (não erro de protocolo)', async () => {
      const r = await rpc(caminho, {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'procurar_conhecimento', arguments: {} },
      }).expect(200);
      expect(r.body.result.isError).toBe(true);
      expect(JSON.parse(r.body.result.content[0].text).erro.codigo).toBe(
        'pedido_invalido',
      );
    });

    it('lote, método desconhecido, pedido mal formado e GET → 405', async () => {
      const r = await rpc(caminho, [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', id: 2, method: 'sampling/createMessage' },
        { id: 3 },
      ]).expect(200);
      expect(r.body).toEqual([
        { jsonrpc: '2.0', id: 1, result: {} },
        {
          jsonrpc: '2.0',
          id: 2,
          error: expect.objectContaining({ code: -32601 }),
        },
        {
          jsonrpc: '2.0',
          id: 3,
          error: expect.objectContaining({ code: -32600 }),
        },
      ]);
      await ctx.http().get(caminho).expect(405);
    });

    it('município desconhecido → 404', async () => {
      await rpc('/v1/mcp/nao-existe', {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      }).expect(404);
    });
  });

  describe('ligação pessoal', () => {
    it('código por SMS → chave; a chave só fica em hash; SMS de confirmação', async () => {
      const l = await ligar();
      expect(l.chave).toMatch(/^tc_[A-Za-z0-9_-]{32}$/);
      expect(l.caminho_mcp).toBe(`/v1/mcp/${MUNICIPIO}/${l.chave}`);
      const bd = await linha(
        ctx.db,
        `SELECT assistente, chave_fim, encode(chave_hash, 'hex') AS hash FROM ligacoes_ia WHERE id = $1`,
        [l.ligacao_id],
      );
      expect(bd.assistente).toBe('Claude');
      expect(bd.chave_fim).toBe(l.chave.slice(-4));
      expect(bd.hash).not.toContain(l.chave);
      const sms = await smsPara(ctx, l.telefone, 'identificacao');
      expect(sms.map((s) => s.corpo).join(' ')).toContain('ficou ligado');
    });

    it('código errado conta tentativas; reutilizar o pedido → codigo_expirado', async () => {
      const telefone = novoTelefone();
      const p = await ctx
        .http()
        .post('/v1/public/ias/pedir-codigo')
        .set('X-Forwarded-For', novoIp())
        .send({ municipio: MUNICIPIO, telefone })
        .expect(202);
      const [sms] = await smsPara(ctx, telefone, 'identificacao');
      const codigo = /\b(\d{6})\b/.exec(sms.corpo)![1];
      const errado = String((Number(codigo) + 1) % 1_000_000).padStart(6, '0');
      const e = await ctx
        .http()
        .post('/v1/public/ias/confirmar')
        .send({ pedido: p.body.pedido, codigo: errado })
        .expect(400);
      expect(e.body.erro).toMatchObject({
        codigo: 'codigo_errado',
        detalhes: { tentativas_restantes: 4 },
      });
      await ctx
        .http()
        .post('/v1/public/ias/confirmar')
        .send({ pedido: p.body.pedido, codigo })
        .expect(201);
      const de_novo = await ctx
        .http()
        .post('/v1/public/ias/confirmar')
        .send({ pedido: p.body.pedido, codigo })
        .expect(400);
      expect(de_novo.body.erro.codigo).toBe('codigo_expirado');
    });

    it('com a chave: ferramentas pessoais, ocorrência em nome da pessoa e no painel', async () => {
      const l = await ligar(novoTelefone(), 'Claude');
      const lista = await rpc(l.caminho_mcp, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      }).expect(200);
      const nomes = lista.body.result.tools.map(
        (t: { name: string }) => t.name,
      );
      expect(nomes).toEqual(
        expect.arrayContaining([
          'registar_ocorrencia',
          'estado_processo',
          'marcar',
        ]),
      );
      expect(nomes).not.toContain('motivo_da_chamada');

      const morada = 'Rua da Porta das IAs 12, Guimarães';
      // Um ponto só deste teste: perto de outra ocorrência da BD partilhada
      // (ex.: o buraco da demo) ficava como duplicado dessa.
      ctx.geo.moradas.set(morada, {
        lat: 41.47 + Math.random() * 0.01,
        lng: -8.34 + Math.random() * 0.01,
      });
      const r = await rpc(l.caminho_mcp, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'registar_ocorrencia',
          arguments: {
            categoria: 'Buraco na via',
            descricao:
              'O caixote da rua não foi recolhido e há um buraco ao lado.',
            morada,
          },
        },
      }).expect(200);
      const saida = r.body.result.structuredContent;
      expect(saida).toMatchObject({
        registada: true,
        numero: expect.stringMatching(/^OC-/),
        sms_enviado: true,
      });

      const o = await linha(
        ctx.db,
        `SELECT o.municipe_id, c.canal::text AS canal
         FROM ocorrencias o JOIN conversas c ON c.id = o.conversa_id
         WHERE o.numero = $1
           AND o.municipio_id = (SELECT municipio_id FROM ligacoes_ia WHERE id = $2)`,
        [saida.numero, l.ligacao_id],
      );
      const municipe = await linha(
        ctx.db,
        'SELECT municipe_id FROM ligacoes_ia WHERE id = $1',
        [l.ligacao_id],
      );
      expect(o).toEqual({ municipe_id: municipe.municipe_id, canal: 'ia' });

      const feed = await ctx
        .http()
        .get('/v1/painel/ias/atividade')
        .set(painel)
        .expect(200);
      expect(feed.body.pedidos[0]).toMatchObject({
        ferramenta: 'registar_ocorrencia',
        acao: true,
        ok: true,
        resumo: expect.stringContaining(saida.numero),
        ligacao: { id: l.ligacao_id, assistente: 'Claude' },
      });
      const resumo = await ctx
        .http()
        .get('/v1/painel/ias/resumo')
        .set(painel)
        .expect(200);
      expect(resumo.body.ligacoes_ativas).toBeGreaterThanOrEqual(1);
      expect(resumo.body.acoes_7d).toBeGreaterThanOrEqual(1);
      const ligs = await ctx
        .http()
        .get('/v1/painel/ias/ligacoes')
        .set(painel)
        .expect(200);
      expect(
        ligs.body.ligacoes.find((x: { id: string }) => x.id === l.ligacao_id),
      ).toMatchObject({ ativa: true, pedidos: 1 });
    });

    it('desligar pela câmara ou pelo munícipe → a chave deixa de abrir (404)', async () => {
      const a = await ligar();
      await ctx
        .http()
        .post(`/v1/painel/ias/ligacoes/${a.ligacao_id}/revogar`)
        .set(painel)
        .expect(200);
      await rpc(a.caminho_mcp, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      }).expect(404);

      const b = await ligar();
      await ctx
        .http()
        .post('/v1/public/ias/desligar')
        .send({ chave: b.chave })
        .expect(200);
      const r = await rpc(b.caminho_mcp, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      }).expect(404);
      expect(r.body.erro.codigo).toBe('ligacao_desconhecida');
      const bd = await linha(
        ctx.db,
        'SELECT revogada_por FROM ligacoes_ia WHERE id = $1',
        [b.ligacao_id],
      );
      expect(bd.revogada_por).toBe('municipe');
    });

    it('chave de outro formato → 404 sem tocar na BD', async () => {
      await rpc(`/v1/mcp/${MUNICIPIO}/nao-e-uma-chave`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
      }).expect(404);
    });
  });
});
