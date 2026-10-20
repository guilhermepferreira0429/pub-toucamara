/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import { SEGREDO_AGENTE } from './ambiente';
import {
  arrancarApp,
  CHEFE_ID,
  Contexto,
  criarUtilizador,
  entrarPainel,
  esperarSmsEnviado,
  linha,
  MUNICIPIO,
  MUNICIPIO_ID,
  novoTelefone,
} from './app';

/**
 * IP de documentação (TEST-NET) único por teste: o `trust proxy`
 * ('loopback, uniquelocal') aceita o X-Forwarded-For do supertest, que liga
 * por 127.0.0.1, e o limite de sessões conta por esse IP.
 */
function novoIp(): string {
  return `203.0.113.${randomInt(1, 255)}`;
}

/**
 * Chat no site (sessões anónimas, retomar, identificação por SMS, limite por
 * IP) e email geral (webhook de entrada e painel).
 */
describe('Chat (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  const criarSessao = (corpo: object = {}, ip = novoIp()) =>
    ctx
      .http()
      .post('/v1/chat/sessoes')
      .set('X-Forwarded-For', ip)
      .send({ municipio: MUNICIPIO, ...corpo });

  describe('sessões', () => {
    it('POST /v1/chat/sessoes cria a sessão com a saudação do agente', async () => {
      const r = await criarSessao({ idioma: 'pt-PT' }).expect(201);
      expect(r.body).toEqual({
        sessao: expect.stringMatching(/^[A-Za-z0-9_-]{20,64}$/),
        saudacao: 'Olá, fala com o Tou, Câmara?',
        agente: expect.any(String),
        retomada: false,
        municipio: { slug: MUNICIPIO, nome: expect.any(String) },
      });
      const c = await linha(
        ctx.db,
        `SELECT c.id, c.canal::text AS canal, c.municipio_id, c.municipe_id, c.idioma,
                (SELECT texto FROM conversa_turnos t WHERE t.conversa_id = c.id AND t.ordem = 0) AS saudacao
         FROM conversas c WHERE c.provider_id = $1`,
        [r.body.sessao],
      );
      expect(c).toMatchObject({
        canal: 'chat',
        municipio_id: MUNICIPIO_ID,
        municipe_id: null,
        idioma: 'pt-PT',
        saudacao: 'Olá, fala com o Tou, Câmara?',
      });
    });

    it('município desconhecido → 404; corpo inválido → 400', async () => {
      const r = await criarSessao({ municipio: 'nao-existe' }).expect(404);
      expect(r.body.erro.codigo).toBe('municipio_desconhecido');

      const invalido = await criarSessao({ idioma: 'português' }).expect(400);
      expect(invalido.body.erro).toMatchObject({
        codigo: 'pedido_invalido',
        detalhes: {
          campos: [expect.objectContaining({ campo: 'idioma' })],
        },
      });
    });

    it('retomar com sessao_anterior liga a nova conversa à anterior', async () => {
      const a = await criarSessao().expect(201);
      const b = await criarSessao({ sessao_anterior: a.body.sessao }).expect(
        201,
      );
      expect(b.body.retomada).toBe(true);
      expect(b.body.sessao).not.toBe(a.body.sessao);
      const c = await linha(
        ctx.db,
        `SELECT c.continuacao_de, a.id AS anterior
         FROM conversas c, conversas a
         WHERE c.provider_id = $1 AND a.provider_id = $2`,
        [b.body.sessao, a.body.sessao],
      );
      expect(c.continuacao_de).toBe(c.anterior);

      // Um token que não existe não retoma nada (e não dá erro).
      const nenhuma = await criarSessao({
        sessao_anterior: 'x'.repeat(32),
      }).expect(201);
      expect(nenhuma.body.retomada).toBe(false);
    });

    it('mensagem sem IA → 503 ia_indisponivel em JSON (antes do SSE)', async () => {
      const { body } = await criarSessao().expect(201);
      const r = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/mensagens`)
        .send({ texto: 'Preciso de licença para abrir uma janela?' })
        .expect(503);
      expect(r.headers['content-type']).toMatch(/application\/json/);
      // `detalhes` é opcional: sem detalhes não vem no JSON.
      expect(r.body).toEqual({
        erro: { codigo: 'ia_indisponivel', mensagem: expect.any(String) },
      });
    });

    it('mensagem para uma sessão que não existe → 404; token mal formado → 400', async () => {
      const r = await ctx
        .http()
        .post(`/v1/chat/sessoes/${'a'.repeat(32)}/mensagens`)
        .send({ texto: 'Olá' })
        .expect(404);
      expect(r.body.erro.codigo).toBe('sessao_desconhecida');

      const mal = await ctx
        .http()
        .post('/v1/chat/sessoes/curto/mensagens')
        .send({ texto: 'Olá' })
        .expect(400);
      expect(mal.body.erro.codigo).toBe('pedido_invalido');
    });

    it('sessão com mais de 24 h → 410 sessao_expirada', async () => {
      const { body } = await criarSessao().expect(201);
      await ctx.db.query(
        `UPDATE conversas SET iniciada_em = now() - interval '25 hours' WHERE provider_id = $1`,
        [body.sessao],
      );
      const r = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/identificar`)
        .send({ telefone: novoTelefone() })
        .expect(410);
      expect(r.body.erro.codigo).toBe('sessao_expirada');
    });
  });

  describe('identificação por SMS', () => {
    it('código por SMS: errado → 400 codigo_errado; certo → identificada; repetido → codigo_expirado', async () => {
      const { body } = await criarSessao().expect(201);
      const telefone = novoTelefone();
      const pedido = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/identificar`)
        .send({ telefone: telefone.replace('+351', '') })
        .expect(202);
      expect(pedido.body).toEqual({
        enviado: true,
        telefone: expect.any(String),
        expira_em: expect.any(String),
      });
      expect(pedido.body.telefone).not.toBe(telefone);
      expect(pedido.body.telefone.slice(-3)).toBe(telefone.slice(-3));

      const sms = await esperarSmsEnviado(ctx, telefone, 'identificacao');
      const codigo = /\b(\d{6})\b/.exec(sms.corpo)?.[1];
      expect(codigo).toBeDefined();

      const errado = String((Number(codigo) + 1) % 1_000_000).padStart(6, '0');
      const e = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/confirmar`)
        .send({ codigo: errado })
        .expect(400);
      expect(e.body.erro).toMatchObject({
        codigo: 'codigo_errado',
        detalhes: { tentativas_restantes: 4 },
      });

      const ok = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/confirmar`)
        .send({ codigo })
        .expect(200);
      expect(ok.body).toEqual({
        identificado: true,
        telefone: pedido.body.telefone,
      });
      const c = await linha(
        ctx.db,
        `SELECT m.telefone_e164 FROM conversas c JOIN municipes m ON m.id = c.municipe_id
         WHERE c.provider_id = $1`,
        [body.sessao],
      );
      expect(c?.telefone_e164).toBe(telefone);

      const repetido = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/confirmar`)
        .send({ codigo })
        .expect(400);
      expect(repetido.body.erro.codigo).toBe('codigo_expirado');
    });

    it('5 códigos errados esgotam as tentativas → 429', async () => {
      const { body } = await criarSessao().expect(201);
      const telefone = novoTelefone();
      await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/identificar`)
        .send({ telefone })
        .expect(202);
      const sms = await esperarSmsEnviado(ctx, telefone, 'identificacao');
      const codigo = /\b(\d{6})\b/.exec(sms.corpo)![1];
      const errado = codigo === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await ctx
          .http()
          .post(`/v1/chat/sessoes/${body.sessao}/confirmar`)
          .send({ codigo: errado })
          .expect(400);
      }
      // Nem o certo passa depois disto.
      const r = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/confirmar`)
        .send({ codigo })
        .expect(429);
      expect(r.body.erro.codigo).toBe('demasiadas_tentativas');
    });

    it('telefone inválido → 400; confirmar sem pedir código → 400 codigo_expirado', async () => {
      const { body } = await criarSessao().expect(201);
      const r = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/identificar`)
        .send({ telefone: 'abcdefgh' })
        .expect(400);
      expect(r.body.erro.codigo).toBe('telefone_invalido');

      const semCodigo = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/confirmar`)
        .send({ codigo: '123456' })
        .expect(400);
      expect(semCodigo.body.erro.codigo).toBe('codigo_expirado');

      const formato = await ctx
        .http()
        .post(`/v1/chat/sessoes/${body.sessao}/confirmar`)
        .send({ codigo: '12a' })
        .expect(400);
      expect(formato.body.erro.codigo).toBe('pedido_invalido');
    });
  });

  describe('limite de sessões por IP', () => {
    // ChatService: 20 sessões novas / 10 min por IP.
    const LIMITE = 20;

    it(`a ${LIMITE + 1}.ª sessão do mesmo IP → 429; outro IP e o avaliador passam`, async () => {
      const ip = '198.51.100.7';
      for (let i = 0; i < LIMITE; i++) {
        await criarSessao({}, ip).expect(201);
      }
      const r = await criarSessao({}, ip).expect(429);
      expect(r.body.erro.codigo).toBe('demasiados_pedidos');

      await criarSessao({}, '198.51.100.8').expect(201);

      // O avaliador (segredo do agente) não conta para o limite.
      const avaliador = await criarSessao({}, ip)
        .set('X-Agente-Segredo', SEGREDO_AGENTE)
        .expect(201);
      expect(avaliador.body.sessao).toEqual(expect.any(String));

      // Segredo errado não isenta.
      await criarSessao({}, ip).set('X-Agente-Segredo', 'errado').expect(429);
    });
  });

  describe('email geral', () => {
    const entrada = () => ctx.http().post('/v1/webhooks/email/entrada');
    const email = (extra: object = {}) => ({
      de: 'Ana Silva <Ana.Silva@Exemplo.pt>',
      para: ['geral@cm-teste.pt'],
      assunto: `Licença de obras ${randomUUID().slice(0, 8)}`,
      texto: 'Bom dia, preciso de licença para abrir uma janela na fachada?',
      anexos: [{ nome: 'planta.pdf', mime: 'application/pdf', tamanho: 1234 }],
      mensagem_id: `<${randomUUID()}@exemplo.pt>`,
      ...extra,
    });

    it('sem segredo ou com segredo errado → 401 e nada fica gravado', async () => {
      const corpo = email();
      const sem = await entrada().send(corpo).expect(401);
      expect(sem.body.erro.codigo).toBe('nao_autenticado');
      const errado = await entrada()
        .set('X-Webhook-Segredo', 'errado')
        .send(corpo)
        .expect(401);
      expect(errado.body.erro.codigo).toBe('nao_autenticado');
      const n = await linha(
        ctx.db,
        'SELECT count(*)::int AS n FROM emails_entrada WHERE mensagem_id = $1',
        [corpo.mensagem_id],
      );
      expect(n?.n).toBe(0);
    });

    it('remetente inválido → 400; destino de outro município sem X-Municipio → 404', async () => {
      const r = await entrada()
        .set('X-Webhook-Segredo', SEGREDO_AGENTE)
        .send(email({ de: 'sem arroba' }))
        .expect(400);
      expect(r.body.erro.codigo).toBe('remetente_invalido');

      const m = await entrada()
        .set('X-Webhook-Segredo', SEGREDO_AGENTE)
        .send(email({ para: 'geral@outra-camara.pt' }))
        .expect(404);
      expect(m.body.erro.codigo).toBe('municipio_desconhecido');

      const semTexto = await entrada()
        .set('X-Webhook-Segredo', SEGREDO_AGENTE)
        .send(email({ texto: undefined }))
        .expect(400);
      expect(semTexto.body.erro.codigo).toBe('pedido_invalido');
    });

    it('entrada → painel (lista, detalhe) → responder; mensagem_id repetido é o mesmo email', async () => {
      const corpo = email();
      const r = await entrada()
        .set('X-Webhook-Segredo', SEGREDO_AGENTE)
        .send(corpo)
        .expect(202);
      expect(r.body).toEqual({ id: expect.any(String), duplicado: false });
      const id = r.body.id as string;

      const repetido = await entrada()
        .set('X-Webhook-Segredo', SEGREDO_AGENTE)
        .send(corpo)
        .expect(202);
      expect(repetido.body).toEqual({ id, duplicado: true });

      const painel = await entrarPainel(ctx);
      const lista = await ctx
        .http()
        .get('/v1/painel/emails')
        .query({ estado: 'nova', limite: 200 })
        .set(painel)
        .expect(200);
      expect(lista.body).toEqual({
        itens: expect.any(Array),
        proximo_cursor: null,
      });
      const item = lista.body.itens.find((i: { id: string }) => i.id === id);
      expect(item).toMatchObject({
        de: 'ana.silva@exemplo.pt',
        assunto: corpo.assunto,
        estado: 'nova',
        num_anexos: 1,
        // Sem IA fica por classificar (o painel trata-o à mão).
        tem_rascunho: false,
      });

      const detalhe = await ctx
        .http()
        .get(`/v1/painel/emails/${id}`)
        .set(painel)
        .expect(200);
      expect(detalhe.body).toMatchObject({
        id,
        de: 'ana.silva@exemplo.pt',
        para: 'geral@cm-teste.pt',
        assunto: corpo.assunto,
        texto: corpo.texto,
        anexos: corpo.anexos,
        estado: 'nova',
        resposta: null,
        fontes: [],
      });

      const resposta =
        'Bom dia. Abrir uma janela na fachada está sujeito a comunicação prévia.';
      const resp = await ctx
        .http()
        .post(`/v1/painel/emails/${id}/responder`)
        .set(painel)
        .send({ texto: resposta })
        .expect(200);
      expect(resp.body).toEqual({
        id,
        estado: 'respondida',
        respondido_em: expect.any(String),
      });
      const bd = await linha(
        ctx.db,
        'SELECT estado, resposta, respondido_por FROM emails_entrada WHERE id = $1',
        [id],
      );
      expect(bd).toEqual({
        estado: 'respondida',
        resposta,
        respondido_por: CHEFE_ID,
      });

      const outra = await ctx
        .http()
        .post(`/v1/painel/emails/${id}/responder`)
        .set(painel)
        .send({ texto: 'Outra vez.' })
        .expect(409);
      expect(outra.body.erro.codigo).toBe('ja_respondida');
    });

    it('X-Municipio escolhe o município; painel: 404, id inválido e perfil sem "entrada"', async () => {
      const r = await entrada()
        .set({ 'X-Webhook-Segredo': SEGREDO_AGENTE, 'X-Municipio': MUNICIPIO })
        .send(email({ para: undefined, mensagem_id: undefined }))
        .expect(202);
      const e = await linha(
        ctx.db,
        'SELECT municipio_id, para FROM emails_entrada WHERE id = $1',
        [r.body.id],
      );
      expect(e).toEqual({ municipio_id: MUNICIPIO_ID, para: null });

      const painel = await entrarPainel(ctx);
      const naoExiste = await ctx
        .http()
        .get(`/v1/painel/emails/${randomUUID()}`)
        .set(painel)
        .expect(404);
      expect(naoExiste.body.erro.codigo).toBe('nao_encontrado');

      const invalido = await ctx
        .http()
        .get('/v1/painel/emails/nao-e-uuid')
        .set(painel)
        .expect(400);
      expect(invalido.body.erro.codigo).toBe('pedido_invalido');

      const vereador = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'vereador'),
      );
      const proibido = await ctx
        .http()
        .get('/v1/painel/emails')
        .set(vereador)
        .expect(403);
      expect(proibido.body.erro).toMatchObject({
        codigo: 'sem_permissao',
        detalhes: { recurso: 'entrada' },
      });

      await ctx.http().get('/v1/painel/emails').expect(401);
    });
  });
});
