/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { ConfigService } from '@nestjs/config';
import { assinaturaTwilio } from '../../src/modules/chamadas-saida/juncao-familiar';
import { JuncaoFamiliarService } from '../../src/modules/chamadas-saida/juncao-familiar.service';
import { SEGREDO_AGENTE } from './ambiente';
import {
  arrancarApp,
  Contexto,
  ferramenta,
  linha,
  MUNICIPIO_ID,
  novaChamada,
  novoTelefone,
} from './app';

const LINHA = '+351253000000'; // telefone_linha do município de teste
const API = 'https://api.teste.pt';
const TOKEN = 'token-twilio-e2e';

/**
 * "Fale com o meu filho": junção do familiar à chamada. O Twilio é falso
 * (regista os pedidos); o que falta testar numa chamada real está no
 * comentário do JuncaoFamiliarService.
 */
describe('Juntar familiar à chamada (e2e)', () => {
  let ctx: Contexto;
  let servico: JuncaoFamiliarService;
  let pedidos: { url: string; corpo: URLSearchParams }[];
  let falharEm: string | null;

  beforeAll(async () => {
    ctx = await arrancarApp();
    const config = ctx.app.get(ConfigService);
    config.set('comunicacao.twilio', { accountSid: 'ACe2e', authToken: TOKEN });
    config.set('app.apiUrl', API);
    await ctx.db.query(
      `UPDATE municipios SET telefone_linha = $2 WHERE id = $1`,
      [MUNICIPIO_ID, LINHA],
    );
    servico = ctx.app.get(JuncaoFamiliarService);
    servico.buscar = (url, init) => {
      const corpo = new URLSearchParams(init.body as string);
      pedidos.push({ url, corpo });
      const falha = falharEm && url.includes(falharEm);
      return Promise.resolve(
        new Response(falha ? '{"message":"erro"}' : '{}', {
          status: falha ? 500 : 201,
        }),
      );
    };
  });
  beforeEach(() => {
    pedidos = [];
    falharEm = null;
  });
  afterAll(() => ctx.fechar());

  const juncaoDe = (conversa: string) =>
    linha<{ id: string; estado: string; sala: string; modo: string }>(
      ctx.db,
      `SELECT j.id, j.estado, j.sala, j.modo FROM juncoes_familiar j
       JOIN conversas c ON c.id = j.conversa_id WHERE c.provider_id = $1`,
      [conversa],
    );

  it('com Twilio: sala, agente de volta com o contexto, familiar chamado e o estado pelo webhook', async () => {
    const chamada = novaChamada('fam');
    const filho = novoTelefone();
    const r = await ferramenta(ctx, chamada, 'juntar_familiar', {
      telefone: filho,
      nome: 'Rui',
      relacao: 'o seu filho',
      resumo:
        'A obra na cozinha precisa de comunicação prévia; falta a planta.',
      call_sid: 'CA123',
    }).expect(200);
    expect(r.body).toMatchObject({ juntado: true, modo: 'conferencia' });
    expect(r.body.dizer).toContain('o seu filho Rui');
    const j = (await juncaoDe(chamada.conversa))!;
    expect(j).toMatchObject({ estado: 'a_juntar', modo: 'conferencia' });

    await servico.executar(j.id);
    expect(pedidos.map((p) => p.url.replace(/.*Accounts\/ACe2e/, ''))).toEqual([
      '/Calls/CA123.json',
      `/Conferences/${j.sala}/Participants.json`,
      `/Conferences/${j.sala}/Participants.json`,
    ]);
    expect(pedidos[0].corpo.get('Twiml')).toContain(`>${j.sala}</Conference>`);
    expect(pedidos[1].corpo.get('To')).toBe(LINHA);
    expect(pedidos[2].corpo.get('To')).toBe(filho);
    expect(pedidos[2].corpo.getAll('StatusCallbackEvent')).toEqual([
      'answered',
      'completed',
    ]);
    const callback = `${API}/v1/webhooks/twilio/juncoes/${j.id}`;
    expect(pedidos[2].corpo.get('StatusCallback')).toBe(callback);

    // O agente volta: a linha liga para a linha.
    const inicio = await ctx
      .http()
      .post('/v1/webhooks/elevenlabs/inicio-chamada')
      .set('X-Agente-Segredo', SEGREDO_AGENTE)
      .send({ caller_id: LINHA, called_number: LINHA, agent_id: 'agente-e2e' })
      .expect(200);
    expect(inicio.body.dynamic_variables).toMatchObject({
      tipo_chamada: 'juncao_familiar',
      o_que_mudou: expect.stringContaining('falta a planta'),
    });
    expect((await juncaoDe(chamada.conversa))!.estado).toBe('agente_ligado');

    const estado = await ferramenta(ctx, chamada, 'estado_familiar').expect(
      200,
    );
    expect(estado.body.estado).toBe('agente_ligado');

    // O familiar atendeu (assinado); sem assinatura → 403.
    const params = { CallSid: 'CA999', CallStatus: 'in-progress' };
    await ctx
      .http()
      .post(`/v1/webhooks/twilio/juncoes/${j.id}`)
      .type('form')
      .send(params)
      .expect(403);
    await ctx
      .http()
      .post(`/v1/webhooks/twilio/juncoes/${j.id}`)
      .set('X-Twilio-Signature', assinaturaTwilio(TOKEN, callback, params))
      .type('form')
      .send(params)
      .expect(204);
    expect((await juncaoDe(chamada.conversa))!.estado).toBe('familiar_atendeu');
  });

  it('se o familiar não puder ser chamado, o munícipe volta ao agente', async () => {
    const chamada = novaChamada('fam');
    await ferramenta(ctx, chamada, 'juntar_familiar', {
      telefone: novoTelefone(),
      resumo: 'Quer saber o estado do pedido de licença de ruído.',
      call_sid: 'CA456',
    }).expect(200);
    const j = (await juncaoDe(chamada.conversa))!;
    falharEm = 'Participants';
    await servico.executar(j.id);
    const fim = await linha<{ estado: string; erro: string }>(
      ctx.db,
      'SELECT estado, erro FROM juncoes_familiar WHERE id = $1',
      [j.id],
    );
    expect(fim).toMatchObject({
      estado: 'falhou',
      erro: expect.stringContaining('500'),
    });
    const ultimo = pedidos[pedidos.length - 1];
    expect(ultimo.url).toContain('/Calls/CA456.json');
    expect(ultimo.corpo.get('Twiml')).toContain(`<Dial>${LINHA}</Dial>`);
  });

  it('sem CallSid (ou no chat): SMS ao familiar só com o primeiro nome, sem o assunto', async () => {
    const chamada = novaChamada('fam');
    await ctx.db.query(
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Maria Fernandes')`,
      [MUNICIPIO_ID, chamada.telefone],
    );
    const filha = novoTelefone();
    const r = await ferramenta(ctx, chamada, 'juntar_familiar', {
      telefone: filha,
      nome: 'Ana Maria',
      relacao: 'a sua filha',
      resumo: 'Dívida de IMI de 2024 em execução fiscal.',
    }).expect(200);
    expect(r.body).toMatchObject({ juntado: false, modo: 'sms' });
    expect(pedidos).toHaveLength(0);
    const sms = await linha<{ corpo: string }>(
      ctx.db,
      `SELECT corpo FROM mensagens_saida WHERE destino = $1 AND motivo = 'familiar'`,
      [filha],
    );
    expect(sms!.corpo).toMatch(/^Olá Ana\. Maria pediu/);
    expect(sms!.corpo).toContain('da parte de Maria');
    expect(sms!.corpo).toContain(LINHA);
    expect(sms!.corpo).not.toContain('IMI');
  });

  it('número inválido ou o próprio número: pede outra vez, não junta', async () => {
    const chamada = novaChamada('fam');
    const mal = await ferramenta(ctx, chamada, 'juntar_familiar', {
      telefone: '12345678901234',
      resumo: 'Qualquer coisa para explicar.',
      call_sid: 'CA1',
    }).expect(200);
    expect(mal.body.juntado).toBe(false);
    const proprio = await ferramenta(ctx, chamada, 'juntar_familiar', {
      telefone: chamada.telefone,
      resumo: 'Qualquer coisa para explicar.',
      call_sid: 'CA1',
    }).expect(200);
    expect(proprio.body.dizer).toContain('de onde está a ligar');
  });
});
