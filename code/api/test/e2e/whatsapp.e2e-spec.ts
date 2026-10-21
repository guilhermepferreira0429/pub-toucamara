import { randomInt } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { assinaturaTwilio } from '../../src/common/twilio';
import { ChatService } from '../../src/modules/chat/chat.service';
import {
  arrancarApp,
  Contexto,
  linha,
  linhas,
  MUNICIPIO_ID,
  novoTelefone,
  TIPO_CP_ID,
} from './app';

const URL = 'https://api.teste.pt/v1/webhooks/whatsapp/entrada';
const TOKEN = 'token-whatsapp-e2e';
const NUMERO_WA = '+351939000222';

/**
 * WhatsApp: o webhook grava e responde já; o job responde pelo agente (ou,
 * sem IA, como o SMS). Sem chave de IA nos testes: o caminho do agente é
 * testado com o turno do chat substituído.
 */
describe('WhatsApp (e2e)', () => {
  let ctx: Contexto;
  let sid = 0;

  beforeAll(async () => {
    ctx = await arrancarApp();
    const config = ctx.app.get(ConfigService);
    config.set('comunicacao.twilio', { accountSid: 'ACwa', authToken: TOKEN });
    config.set('app.apiUrl', 'https://api.teste.pt');
    await ctx.db.query(
      `UPDATE municipios SET telefone_whatsapp = $2 WHERE id = $1`,
      [MUNICIPIO_ID, NUMERO_WA],
    );
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => ctx.fechar());

  function escrever(
    de: string,
    corpo: string,
    extra: Record<string, string> = {},
    assinar = true,
  ) {
    const p = {
      MessageSid: `SMwa${++sid}`,
      From: `whatsapp:${de}`,
      To: `whatsapp:${NUMERO_WA}`,
      Body: corpo,
      NumMedia: '0',
      ...extra,
    };
    const r = ctx.http().post('/v1/webhooks/whatsapp/entrada').type('form');
    if (assinar) r.set('X-Twilio-Signature', assinaturaTwilio(TOKEN, URL, p));
    return r.send(p);
  }

  /** As respostas por WhatsApp a um número (espera pelo job). */
  async function respostas(de: string, n = 1): Promise<string[]> {
    for (let i = 0; i < 100; i++) {
      const r = await linhas<{ corpo: string }>(
        ctx.db,
        `SELECT corpo FROM mensagens_saida WHERE destino = $1 AND canal = 'whatsapp'
         ORDER BY enviar_em, chave_idempotencia`,
        [de],
      );
      if (r.length >= n) return r.map((x) => x.corpo);
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error(`Sem ${n} resposta(s) por WhatsApp para ${de}.`);
  }

  it('sem IA: o estado do processo pelo número, por WhatsApp, só para o dono', async () => {
    const tel = novoTelefone();
    const m = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Rita WA') RETURNING id`,
      [MUNICIPIO_ID, tel],
    );
    const numero = `CP ${randomInt(1000, 9999)}/2026`;
    await ctx.db.query(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, fase)
       VALUES ($1, $2, $3, $4, 'Anexo', 'apreciacao')`,
      [MUNICIPIO_ID, numero, TIPO_CP_ID, m!.id],
    );
    const r = await escrever(tel, `Qual o estado do ${numero}?`).expect(200);
    expect(r.text).toContain('<Response></Response>');
    expect((await respostas(tel))[0]).toContain(numero);

    // A conversa é do canal whatsapp e fica ligada à pessoa.
    const c = await linha<{ canal: string; municipe_id: string }>(
      ctx.db,
      `SELECT canal::text, municipe_id FROM conversas WHERE provider_id LIKE $1`,
      [`wa:${tel}:%`],
    );
    expect(c).toMatchObject({ canal: 'whatsapp', municipe_id: m!.id });
  });

  it('com IA: corre o agente com o canal whatsapp, junta mensagens seguidas e parte respostas longas', async () => {
    const chat = ctx.app.get(ChatService);
    jest.spyOn(chat, 'iaDisponivel', 'get').mockReturnValue(true);
    const turno = jest
      .spyOn(chat, 'turno')
      .mockResolvedValue({ texto: 'Olá! '.repeat(400).trim(), erro: null });
    const tel = novoTelefone();
    await escrever(tel, 'Bom dia').expect(200);
    const partes = await respostas(tel, 2);
    expect(partes.every((p) => p.length <= 1600)).toBe(true);
    expect(turno).toHaveBeenCalledWith(
      expect.objectContaining({ telefone: tel }),
      'Bom dia',
      'whatsapp',
    );

    // A segunda mensagem continua a mesma conversa (dentro das 24 h).
    await escrever(tel, 'E outra coisa').expect(200);
    await respostas(tel, 4);
    const conversas = await linhas(
      ctx.db,
      `SELECT 1 FROM conversas WHERE provider_id LIKE $1`,
      [`wa:${tel}:%`],
    );
    expect(conversas).toHaveLength(1);
  });

  it('fotos: o agente fica a saber que veio um anexo; repetição do webhook e assinatura', async () => {
    const chat = ctx.app.get(ChatService);
    jest.spyOn(chat, 'iaDisponivel', 'get').mockReturnValue(true);
    const turno = jest
      .spyOn(chat, 'turno')
      .mockResolvedValue({ texto: 'Recebi.', erro: null });
    const tel = novoTelefone();
    const p = {
      MessageSid: 'SMwa-repetida',
      From: `whatsapp:${tel}`,
      To: `whatsapp:${NUMERO_WA}`,
      Body: 'Buraco na rua',
      NumMedia: '1',
    };
    for (let i = 0; i < 2; i++) {
      await ctx
        .http()
        .post('/v1/webhooks/whatsapp/entrada')
        .type('form')
        .set('X-Twilio-Signature', assinaturaTwilio(TOKEN, URL, p))
        .send(p)
        .expect(200);
    }
    await respostas(tel);
    expect(turno).toHaveBeenCalledTimes(1);
    expect(turno.mock.calls[0][1]).toContain('um anexo');
    const recebidas = await linhas(
      ctx.db,
      `SELECT 1 FROM whatsapp_recebidas WHERE de = $1`,
      [tel],
    );
    expect(recebidas).toHaveLength(1);

    await escrever(tel, 'sem assinatura', {}, false).expect(403);
  });
});
