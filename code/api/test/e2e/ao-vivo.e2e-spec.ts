/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { z } from 'zod';
import { ClaudeService } from '../../src/ia/claude.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO,
  novoTelefone,
  smsPara,
} from './app';

/** IA falsa: liga-se e desliga-se por teste. */
class IaFalsa {
  ligada = false;
  pedidos: { sistema: string; conteudo: string }[] = [];
  resposta: unknown = null;
  get disponivel() {
    return this.ligada;
  }
  extrair(_e: z.ZodType, p: { sistema: string; conteudo: string }) {
    this.pedidos.push(p);
    return Promise.resolve(this.resposta);
  }
}

interface EventoLido {
  evento: string;
  dados: any;
}

/**
 * "A câmara a ouvir em direto": a transcrição da chamada web (com token de
 * sessão e limite), o painel "Chamadas a decorrer" (SSE, sugestões com IA
 * falsa, assumir a conversa), o link do familiar (consentimento, expiração,
 * revogação, só a sua conversa) e os eventos públicos anonimizados do pitch.
 */
describe('Ao vivo (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let base: string;
  const ia = new IaFalsa();

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) => b.overrideProvider(ClaudeService).useValue(ia),
    });
    chefe = await entrarPainel(ctx);
    const server = ctx.app.getHttpServer() as unknown as Server;
    if (!server.listening)
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => ctx.fechar());

  let ipN = 0;
  const novoIp = () => `10.77.${Math.floor(++ipN / 250)}.${(ipN % 250) + 1}`;

  async function novaSessao(ref = `conv-${randomUUID()}`, telefone?: string) {
    const r = await ctx
      .http()
      .post('/v1/public/chamadas-ao-vivo')
      .set('X-Forwarded-For', novoIp())
      .send({ municipio: MUNICIPIO, conversa_ref: ref, telefone })
      .expect(201);
    return { ref, ...r.body } as {
      ref: string;
      sessao_id: string;
      token: string;
      conversa_id: string;
    };
  }

  const escrever = (
    s: { sessao_id: string; token?: string },
    itens: object[],
    token: string | null = s.token ?? null,
  ) => {
    const r = ctx
      .http()
      .post(`/v1/public/chamadas-ao-vivo/${s.sessao_id}/falas`);
    if (token) r.set('Authorization', `Bearer ${token}`);
    return r.send({ itens });
  };

  /** Lê um SSE até `n` eventos (sem pings) ou até ao tempo limite. */
  async function lerSse(
    caminho: string,
    headers: Record<string, string>,
    n: number,
    depois?: () => Promise<unknown>,
    ms = 8000,
  ): Promise<EventoLido[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const eventos: EventoLido[] = [];
    try {
      const res = await fetch(`${base}${caminho}`, {
        headers: { Accept: 'text/event-stream', ...headers },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        return [
          {
            evento: 'http',
            dados: { estado: res.status, corpo: await res.text() },
          },
        ];
      }
      // O supertest só envia quando alguém espera pelo pedido (then).
      if (depois) void Promise.resolve(depois()).catch(() => undefined);
      const leitor = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let resto = '';
      while (eventos.length < n) {
        const { value, done } = await leitor.read();
        if (done) break;
        resto += value;
        let fim: number;
        while ((fim = resto.indexOf('\n\n')) >= 0) {
          const bloco = resto.slice(0, fim);
          resto = resto.slice(fim + 2);
          let evento = 'message';
          const dados: string[] = [];
          for (const l of bloco.split('\n')) {
            if (l.startsWith('event:')) evento = l.slice(6).trim();
            else if (l.startsWith('data:')) dados.push(l.slice(5).trim());
          }
          if (!dados.length || evento === 'ping') continue;
          eventos.push({ evento, dados: JSON.parse(dados.join('\n')) });
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e;
    } finally {
      clearTimeout(t);
      ctrl.abort();
    }
    return eventos;
  }

  // ---------------------------------------------------------------- sessão e falas

  it('abre a sessão ligada à conversa (o mesmo provider_id das ferramentas), uma só vez', async () => {
    const s = await novaSessao();
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const c = await linha(
      ctx.db,
      'SELECT id, canal FROM conversas WHERE provider_id = $1',
      [s.ref],
    );
    expect(c).toMatchObject({ id: s.conversa_id, canal: 'telefone' });
    // O token não fica em claro na BD.
    const sessao = await linha(
      ctx.db,
      'SELECT token_hash FROM chamadas_ao_vivo WHERE id = $1',
      [s.sessao_id],
    );
    expect(sessao.token_hash).not.toContain(s.token);
    await ctx
      .http()
      .post('/v1/public/chamadas-ao-vivo')
      .set('X-Forwarded-For', novoIp())
      .send({ municipio: MUNICIPIO, conversa_ref: s.ref })
      .expect(409);
  });

  it('escrever falas: sem token 401, token errado 401, com token grava falas e ferramentas', async () => {
    const s = await novaSessao();
    const fala = [
      { tipo: 'fala', quem: 'municipe', texto: 'Quero fazer obras na fachada' },
    ];
    expect((await escrever(s, fala, null).expect(401)).body.erro.codigo).toBe(
      'sem_token',
    );
    expect(
      (await escrever(s, fala, 'x'.repeat(32)).expect(401)).body.erro.codigo,
    ).toBe('token_invalido');
    // O token de outra sessão também não serve.
    const outra = await novaSessao();
    await escrever(s, fala, outra.token).expect(401);

    await escrever(s, [
      ...fala,
      { tipo: 'fala', quem: 'agente', texto: 'Vou ver as regras.' },
      { tipo: 'ferramenta', ferramenta: 'pedir_licenca', fase: 'pedido' },
      {
        tipo: 'ferramenta',
        ferramenta: 'pedir_licenca',
        fase: 'resposta',
        resultado: JSON.stringify({
          pedida: true,
          tipo: 'ruido',
          emitida: true,
          numero: 'LR-9',
        }),
      },
    ]).expect(200);
    const f = await linhas(
      ctx.db,
      'SELECT quem, texto, ferramenta FROM conversa_falas_ao_vivo WHERE conversa_id = $1 ORDER BY seq',
      [s.conversa_id],
    );
    expect(f).toEqual([
      {
        quem: 'municipe',
        texto: 'Quero fazer obras na fachada',
        ferramenta: null,
      },
      { quem: 'agente', texto: 'Vou ver as regras.', ferramenta: null },
      {
        quem: 'ferramenta',
        texto: 'A chamar: Pedido de licença…',
        ferramenta: 'pedir_licenca',
      },
      {
        quem: 'ferramenta',
        texto: 'Licença de ruído emitida (LR-9)',
        ferramenta: 'pedir_licenca',
      },
    ]);
    // O munícipe não escreve como funcionário nem como familiar.
    await escrever(s, [
      { tipo: 'fala', quem: 'funcionario', texto: 'olá' },
    ]).expect(400);
  });

  it('limite: 10 sessões por minuto por IP', async () => {
    const ip = novoIp();
    for (let i = 0; i < 10; i++) {
      await ctx
        .http()
        .post('/v1/public/chamadas-ao-vivo')
        .set('X-Forwarded-For', ip)
        .send({ municipio: MUNICIPIO, conversa_ref: `conv-${randomUUID()}` })
        .expect(201);
    }
    const r = await ctx
      .http()
      .post('/v1/public/chamadas-ao-vivo')
      .set('X-Forwarded-For', ip)
      .send({ municipio: MUNICIPIO, conversa_ref: `conv-${randomUUID()}` })
      .expect(429);
    expect(r.body.erro.codigo).toBe('limite');
  });

  it('terminar: deixa de aceitar falas', async () => {
    const s = await novaSessao();
    await ctx
      .http()
      .post(`/v1/public/chamadas-ao-vivo/${s.sessao_id}/terminar`)
      .set('Authorization', `Bearer ${s.token}`)
      .expect(200);
    const r = await escrever(s, [
      { tipo: 'fala', quem: 'municipe', texto: 'ainda aqui?' },
    ]).expect(410);
    expect(r.body.erro.codigo).toBe('chamada_terminada');
  });

  // ---------------------------------------------------------------- painel

  it('painel: lista a chamada a decorrer e o SSE recebe as falas em direto', async () => {
    const telefone = novoTelefone();
    await ctx.db.query(
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ('00000000-0000-0000-0000-000000000001', $1, 'Rosa Ferreira')`,
      [telefone],
    );
    const s = await novaSessao(undefined, telefone);
    await escrever(s, [
      { tipo: 'fala', quem: 'municipe', texto: 'Boa tarde' },
    ]).expect(200);

    const l = await ctx.http().get('/v1/painel/ao-vivo').set(chefe).expect(200);
    const item = l.body.conversas.find(
      (c: any) => c.conversa_id === s.conversa_id,
    );
    expect(item).toMatchObject({
      tipo: 'chamada_web',
      pessoa: 'Rosa',
      ultima_fala: { quem: 'municipe', texto: 'Boa tarde' },
    });

    const d = await ctx
      .http()
      .get(`/v1/painel/ao-vivo/conversas/${s.conversa_id}`)
      .set(chefe)
      .expect(200);
    expect(d.body).toMatchObject({
      conversa: { tipo: 'chamada_web', a_decorrer: true },
      pessoa: {
        nome: 'Rosa Ferreira',
        telefone: expect.stringMatching(/^\*\*\* \*\*\* \d{3}$/),
      },
      pode_assumir: true,
    });
    const desde = d.body.falas.at(-1).seq;

    const eventos = await lerSse(
      `/v1/painel/ao-vivo/conversas/${s.conversa_id}/eventos?desde=${desde}`,
      chefe,
      3, // o estado do familiar (no início) e as duas falas
      () =>
        escrever(s, [
          { tipo: 'fala', quem: 'municipe', texto: 'Tenho um buraco na rua' },
          { tipo: 'fala', quem: 'agente', texto: 'Diga-me a morada.' },
        ]),
    );
    expect(eventos[0]).toMatchObject({
      evento: 'familiar',
      dados: { ativo: false },
    });
    expect(
      eventos.slice(1).map((e) => [e.evento, e.dados.quem, e.dados.texto]),
    ).toEqual([
      ['fala', 'municipe', 'Tenho um buraco na rua'],
      ['fala', 'agente', 'Diga-me a morada.'],
    ]);
  });

  it('permissões: quem não vê conversas não abre o painel ao vivo', async () => {
    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    await ctx.http().get('/v1/painel/ao-vivo').set(vereador).expect(403);
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx.http().get('/v1/painel/ao-vivo').set(atendimento).expect(200);
  });

  it('sugestões: sem IA só a procura e as regras fixas; com IA (falsa) a sugestão e os alertas juntos', async () => {
    const s = await novaSessao();
    await escrever(s, [
      {
        tipo: 'fala',
        quem: 'municipe',
        texto: 'Quero abrir uma porta na fachada da casa. Vivo sozinha.',
      },
    ]).expect(200);
    ia.ligada = false;
    const sem = await ctx
      .http()
      .post(`/v1/painel/ao-vivo/conversas/${s.conversa_id}/sugestao`)
      .set(chefe)
      .expect(200);
    expect(sem.body).toMatchObject({
      ia: false,
      sugestao: null,
      tema: 'obras',
      motivo_sem_ia: expect.stringContaining('não está configurado'),
      falta_perguntar_demonstracao: true,
    });
    expect(sem.body.falta_perguntar.length).toBeGreaterThan(0);
    expect(sem.body.alertas.map((a: any) => a.tipo)).toEqual(['vulneravel']);
    expect(sem.body.regras.length).toBeGreaterThan(0);

    // Nova fala → com IA. A mesma fala outra vez não chama a IA de novo.
    await escrever(s, [
      { tipo: 'fala', quem: 'municipe', texto: 'Preciso de licença?' },
    ]).expect(200);
    ia.ligada = true;
    ia.pedidos = [];
    ia.resposta = {
      dizer: 'Para abrir uma porta na fachada precisa de comunicação prévia.',
      regra: 'RJUE, art. 6.º',
      falta_perguntar: ['Se a casa está em zona histórica'],
      alertas: [{ tipo: 'irritacao', texto: 'Parece impaciente.' }],
      confianca: 'media',
    };
    const com = await ctx
      .http()
      .post(`/v1/painel/ao-vivo/conversas/${s.conversa_id}/sugestao`)
      .set(chefe)
      .expect(200);
    expect(com.body).toMatchObject({
      ia: true,
      sugestao: {
        dizer: expect.stringContaining('comunicação prévia'),
        regra: 'RJUE, art. 6.º',
      },
      falta_perguntar: ['Se a casa está em zona histórica'],
      falta_perguntar_demonstracao: false,
    });
    expect(com.body.alertas.map((a: any) => a.tipo)).toEqual([
      'vulneravel',
      'irritacao',
    ]);
    expect(ia.pedidos).toHaveLength(1);
    expect(ia.pedidos[0].conteudo).toContain('Munícipe: Preciso de licença?');
    await ctx
      .http()
      .post(`/v1/painel/ao-vivo/conversas/${s.conversa_id}/sugestao`)
      .set(chefe)
      .expect(200);
    expect(ia.pedidos).toHaveLength(1);
    ia.ligada = false;
  });

  it('assumir a conversa: fica registado e o browser recebe a mensagem para injetar no agente', async () => {
    const s = await novaSessao();
    await escrever(s, [
      { tipo: 'fala', quem: 'municipe', texto: 'Olá' },
    ]).expect(200);
    const eventos = await lerSse(
      `/v1/public/chamadas-ao-vivo/${s.sessao_id}/instrucoes`,
      { Authorization: `Bearer ${s.token}` },
      2,
      () =>
        ctx
          .http()
          .post(`/v1/painel/ao-vivo/conversas/${s.conversa_id}/assumir`)
          .set(chefe)
          .send({ texto: 'O balcão de obras abre às 9h.' })
          .expect(201),
    );
    expect(eventos[0]).toMatchObject({
      evento: 'familiar',
      dados: { ativo: false },
    });
    expect(eventos[1]).toMatchObject({
      evento: 'injetar',
      dados: {
        quem: 'funcionario',
        texto: 'O balcão de obras abre às 9h.',
        contexto: expect.stringContaining('funcionário da câmara'),
        gatilho: expect.stringMatching(/^\(nota do sistema:/),
      },
    });
    const a = await linha(
      ctx.db,
      `SELECT acao, objeto_tipo, ator_tipo FROM audit_log WHERE objeto_id = $1 AND acao = 'assumir_conversa'`,
      [s.conversa_id],
    );
    expect(a).toMatchObject({
      objeto_tipo: 'conversa',
      ator_tipo: 'utilizador',
    });
    // O painel vê a fala do funcionário, sem o texto injetado.
    const d = await ctx
      .http()
      .get(`/v1/painel/ao-vivo/conversas/${s.conversa_id}`)
      .set(chefe)
      .expect(200);
    const fala = d.body.falas.find((f: any) => f.quem === 'funcionario');
    expect(fala.texto).toBe('O balcão de obras abre às 9h.');
    expect(fala.dados.injecao).toBeUndefined();
    // O instruções exige o token.
    const semToken = await lerSse(
      `/v1/public/chamadas-ao-vivo/${s.sessao_id}/instrucoes`,
      {},
      1,
    );
    expect(semToken[0].dados.estado).toBe(401);
    // Depois de terminar, já não se assume.
    await ctx
      .http()
      .post(`/v1/public/chamadas-ao-vivo/${s.sessao_id}/terminar`)
      .set('Authorization', `Bearer ${s.token}`)
      .expect(200);
    await ctx
      .http()
      .post(`/v1/painel/ao-vivo/conversas/${s.conversa_id}/assumir`)
      .set(chefe)
      .send({ texto: 'tarde demais' })
      .expect(409);
  });

  // ---------------------------------------------------------------- familiar

  async function juntar(s: { ref: string }, corpo: object) {
    return ferramenta(
      ctx,
      { conversa: s.ref, telefone: '' },
      'juntar_familiar',
      {
        resumo: 'A mãe quer saber do processo de obras e da licença.',
        nome: 'Ana',
        relacao: 'a sua filha',
        ...corpo,
      },
    ).expect(200);
  }

  const tokenDoSms = (corpo: string) =>
    /\/acompanhar\/([A-Za-z0-9_-]{32})/.exec(corpo)?.[1];

  it('familiar na chamada web: pede autorização, SMS com link, transcrição, escreve ao agente, retira', async () => {
    const s = await novaSessao();
    const familiar = novoTelefone();
    await escrever(s, [
      {
        tipo: 'fala',
        quem: 'municipe',
        texto: 'Pode falar com a minha filha?',
      },
    ]).expect(200);

    const pedir = await juntar(s, { telefone: familiar });
    expect(pedir.body).toMatchObject({
      juntado: false,
      precisa_autorizacao: true,
    });
    expect(pedir.body.dizer).toContain('Concorda?');
    expect(await smsPara(ctx, familiar)).toHaveLength(0);

    const ok = await juntar(s, { telefone: familiar, autorizou: true });
    expect(ok.body).toMatchObject({
      juntado: true,
      modo: 'web',
      sms_enviado: true,
    });
    expect(ok.body.link_simulacao).toBeUndefined();
    const [sms] = await smsPara(ctx, familiar, 'familiar');
    expect(sms.corpo).toContain('Câmara Municipal');
    const token = tokenDoSms(sms.corpo)!;
    expect(token).toBeDefined();
    const j = await linha(
      ctx.db,
      `SELECT modo, estado FROM juncoes_familiar WHERE conversa_id = $1`,
      [s.conversa_id],
    );
    expect(j).toEqual({ modo: 'web', estado: 'a_acompanhar' });

    const p = await ctx
      .http()
      .get(`/v1/public/acompanhar/${token}`)
      .expect(200);
    expect(p.body).toMatchObject({
      quem: 'a sua filha Ana',
      aviso: expect.stringContaining('autorizou'),
      mensagens_restantes: 10,
    });
    expect(p.body.falas.map((f: any) => f.texto)).toContain(
      'Pode falar com a minha filha?',
    );

    // O familiar escreve: aparece na transcrição e o browser recebe para injetar.
    const eventos = await lerSse(
      `/v1/public/chamadas-ao-vivo/${s.sessao_id}/instrucoes`,
      { Authorization: `Bearer ${s.token}` },
      2,
      () =>
        ctx
          .http()
          .post(`/v1/public/acompanhar/${token}/mensagens`)
          .send({
            texto: 'Sou a filha, a minha mãe tem o processo CP-2026-12.',
          })
          .expect(201),
    );
    expect(eventos[0]).toMatchObject({
      evento: 'familiar',
      dados: { ativo: true, quem: 'a sua filha Ana' },
    });
    expect(eventos[1]).toMatchObject({
      evento: 'injetar',
      dados: {
        quem: 'familiar',
        contexto: expect.stringContaining('A sua filha Ana, que acompanha'),
      },
    });

    // "Já não preciso" → o link deixa de funcionar.
    const r = await ferramenta(
      ctx,
      { conversa: s.ref, telefone: '' },
      'retirar_familiar',
      {},
    ).expect(200);
    expect(r.body.retirado).toBe(true);
    const fim = await ctx
      .http()
      .get(`/v1/public/acompanhar/${token}`)
      .expect(410);
    expect(fim.body.erro).toMatchObject({
      codigo: 'link_terminado',
      mensagem: expect.stringContaining('deixou de partilhar'),
    });
    await ctx
      .http()
      .post(`/v1/public/acompanhar/${token}/mensagens`)
      .send({ texto: 'olá?' })
      .expect(410);
    const j2 = await linha(
      ctx.db,
      `SELECT estado FROM juncoes_familiar WHERE conversa_id = $1`,
      [s.conversa_id],
    );
    expect(j2.estado).toBe('retirada');
  });

  it('link do familiar: só a sua conversa, expira, uso limitado, cai quando a chamada termina', async () => {
    const a = await novaSessao();
    const b = await novaSessao();
    await escrever(a, [
      { tipo: 'fala', quem: 'municipe', texto: 'Conversa A' },
    ]).expect(200);
    await escrever(b, [
      { tipo: 'fala', quem: 'municipe', texto: 'Conversa B, segredo' },
    ]).expect(200);
    const tel = novoTelefone();
    await juntar(a, { telefone: tel, autorizou: true });
    const token = tokenDoSms((await smsPara(ctx, tel, 'familiar'))[0].corpo)!;
    const p = await ctx
      .http()
      .get(`/v1/public/acompanhar/${token}`)
      .expect(200);
    expect(p.body.falas.map((f: any) => f.texto)).toEqual(['Conversa A']);
    await ctx
      .http()
      .get(`/v1/public/acompanhar/${'z'.repeat(32)}`)
      .expect(404);

    // Uso limitado.
    await ctx.db.query(
      `UPDATE acompanhamentos_familiar SET max_aberturas = aberturas WHERE conversa_id = $1`,
      [a.conversa_id],
    );
    expect(
      (await ctx.http().get(`/v1/public/acompanhar/${token}`).expect(410)).body
        .erro.mensagem,
    ).toContain('demasiadas vezes');
    // Expirado.
    await ctx.db.query(
      `UPDATE acompanhamentos_familiar SET max_aberturas = 20, expira_em = now() - interval '1 minute' WHERE conversa_id = $1`,
      [a.conversa_id],
    );
    expect(
      (await ctx.http().get(`/v1/public/acompanhar/${token}`).expect(410)).body
        .erro.mensagem,
    ).toContain('expirou');

    // A chamada termina → o link de outra conversa ativa também cai.
    const tel2 = novoTelefone();
    await juntar(b, { telefone: tel2, autorizou: true });
    const token2 = tokenDoSms((await smsPara(ctx, tel2, 'familiar'))[0].corpo)!;
    await ctx.http().get(`/v1/public/acompanhar/${token2}`).expect(200);
    await ctx
      .http()
      .post(`/v1/public/chamadas-ao-vivo/${b.sessao_id}/terminar`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(200);
    expect(
      (await ctx.http().get(`/v1/public/acompanhar/${token2}`).expect(410)).body
        .erro.mensagem,
    ).toContain('terminou');
  });

  it('sem chamada web (telefone), juntar_familiar continua no caminho de sempre (SMS a ligar para a linha)', async () => {
    const tel = novoTelefone();
    const r = await ferramenta(
      ctx,
      { conversa: `conv-${randomUUID()}`, telefone: novoTelefone() },
      'juntar_familiar',
      {
        telefone: tel,
        resumo: 'Explicar o processo ao filho.',
      },
    ).expect(200);
    expect(r.body).toMatchObject({ juntado: false, modo: 'sms' });
    const [sms] = await smsPara(ctx, tel, 'familiar');
    expect(sms.corpo).not.toContain('/acompanhar/');
  });

  // ---------------------------------------------------------------- pitch

  it('eventos públicos: sem token 404; com token, anonimizados (nunca nome, telefone nem morada completa)', async () => {
    const config = ctx.app.get(ConfigService);
    config.set('AO_VIVO_PUBLICO_TOKEN', 'token-da-demo-e2e');
    await ctx.http().get(`/v1/public/ao-vivo/${MUNICIPIO}`).expect(404);
    await ctx
      .http()
      .get(`/v1/public/ao-vivo/${MUNICIPIO}?token=errado`)
      .expect(404);

    const telefone = novoTelefone();
    await ctx.db.query(
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ('00000000-0000-0000-0000-000000000001', $1, 'Joaquina Pública')`,
      [telefone],
    );
    const morada = `Rua do Souto ${randomUUID().slice(0, 4).replace(/\d/g, 'x')}, 12`;
    const eventos = await lerSse(
      `/v1/public/ao-vivo/${MUNICIPIO}?token=token-da-demo-e2e`,
      {},
      30,
      async () => {
        await new Promise((r) => setTimeout(r, 300));
        const s = await novaSessao(undefined, telefone);
        await escrever(s, [
          {
            tipo: 'fala',
            quem: 'municipe',
            texto: `Sou a Joaquina, o meu número é ${telefone}, há um buraco na estrada`,
          },
        ]).expect(200);
        const oc = await ferramenta(
          ctx,
          { conversa: s.ref, telefone },
          'registar_ocorrencia',
          {
            categoria: 'Buraco na via',
            descricao: 'Buraco na faixa.',
            morada,
          },
        ).expect(200);
        await escrever(s, [
          {
            tipo: 'ferramenta',
            ferramenta: 'registar_ocorrencia',
            fase: 'resposta',
            resultado: JSON.stringify(oc.body),
          },
        ]).expect(200);
      },
      7000,
    );
    const textos = eventos
      .filter((e) => e.dados.tipo === 'evento')
      .map((e) => e.dados.texto as string);
    expect(textos).toEqual(
      expect.arrayContaining([
        'Chamada iniciada',
        'Pergunta sobre estradas e passeios',
        `Ocorrência registada na ${morada.split(',')[0]}`,
      ]),
    );
    const tudo = JSON.stringify(eventos);
    expect(tudo).not.toContain('Joaquina');
    expect(tudo).not.toContain(telefone.slice(-9));
    expect(tudo).not.toContain(', 12');
    expect(eventos.find((e) => e.dados.tipo === 'estado')).toBeDefined();
  });

  it('simular chamada (só fora de produção): escreve pela mesma rota e junta o familiar', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/ao-vivo/simular')
      .set(chefe)
      .send({ rapido: true })
      .expect(201);
    const id = r.body.conversa_id as string;
    const espera = Date.now() + 15_000;
    let d: any;
    while (Date.now() < espera) {
      d = (
        await ctx
          .http()
          .get(`/v1/painel/ao-vivo/conversas/${id}`)
          .set(chefe)
          .expect(200)
      ).body;
      if (d.link_simulacao) break;
      await new Promise((x) => setTimeout(x, 200));
    }
    expect(d.conversa.simulada).toBe(true);
    expect(d.link_simulacao).toMatch(/\/acompanhar\/[A-Za-z0-9_-]{32}$/);
    const sms = await linha(
      ctx.db,
      `SELECT simulado FROM mensagens_saida WHERE motivo = 'familiar' AND relacionado->>'conversa_id' = $1`,
      [id],
    );
    expect(sms.simulado).toBe(true);
    await ctx
      .http()
      .post(`/v1/painel/ao-vivo/conversas/${id}/terminar-simulacao`)
      .set(chefe)
      .expect(200);
  });
});
