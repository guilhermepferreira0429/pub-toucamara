import { randomInt } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { assinaturaTwilio } from '../../src/common/twilio';
import {
  arrancarApp,
  Contexto,
  linha,
  linhas,
  MUNICIPIO_ID,
  novoTelefone,
  TIPO_CP_ID,
} from './app';

const URL = 'https://api.teste.pt/v1/webhooks/sms/entrada';
const TOKEN = 'token-sms-entrada-e2e';
const NUMERO_SMS = '+351939000111';

/** SMS de entrada: estado do processo, PARAR e ajuda, pelo webhook do Twilio. */
describe('SMS de entrada (e2e)', () => {
  let ctx: Contexto;
  let sid = 0;

  beforeAll(async () => {
    ctx = await arrancarApp();
    const config = ctx.app.get(ConfigService);
    config.set('comunicacao.twilio', { accountSid: 'ACin', authToken: TOKEN });
    config.set('app.apiUrl', 'https://api.teste.pt');
    await ctx.db.query(
      `UPDATE municipios SET telefone_sms = $2, telefone_linha = '253 000 000' WHERE id = $1`,
      [MUNICIPIO_ID, NUMERO_SMS],
    );
  });
  afterAll(() => ctx.fechar());

  function enviar(de: string, corpo: string, assinar = true) {
    const p = {
      MessageSid: `SMin${++sid}`,
      From: de,
      To: NUMERO_SMS,
      Body: corpo,
    };
    const r = ctx.http().post('/v1/webhooks/sms/entrada').type('form');
    if (assinar) r.set('X-Twilio-Signature', assinaturaTwilio(TOKEN, URL, p));
    return r.send(p);
  }

  const resposta = async (de: string) =>
    (await linha<{ corpo: string }>(
      ctx.db,
      `SELECT corpo FROM mensagens_saida WHERE destino = $1 AND motivo = 'resposta_sms'
       ORDER BY enviar_em DESC, id DESC LIMIT 1`,
      [de],
    ))!.corpo;

  async function municipeComProcesso() {
    const tel = novoTelefone();
    const m = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Rui SMS') RETURNING id`,
      [MUNICIPIO_ID, tel],
    );
    const numero = `CP ${randomInt(1000, 9999)}/2026`;
    await ctx.db.query(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, fase)
       VALUES ($1, $2, $3, $4, 'Muro', 'apreciacao')`,
      [MUNICIPIO_ID, numero, TIPO_CP_ID, m!.id],
    );
    return { tel, numero };
  }

  it('estado do processo pelo número, só para o dono', async () => {
    const { tel, numero } = await municipeComProcesso();
    const r = await enviar(tel, numero).expect(200);
    expect(r.text).toContain('<Response></Response>');
    expect(await resposta(tel)).toContain(numero);

    // Outro número a perguntar pelo mesmo processo: não fica a saber nada.
    const estranho = novoTelefone();
    await enviar(estranho, numero).expect(200);
    expect(await resposta(estranho)).toMatch(/^Por SMS só damos o estado/);
    expect(await resposta(estranho)).not.toContain('Muro');
  });

  it('PARAR desliga os avisos; número desconhecido não finge que desligou', async () => {
    const { tel } = await municipeComProcesso();
    await enviar(tel, 'PARAR').expect(200);
    expect(await resposta(tel)).toMatch(/deixa de receber avisos/);
    const desconhecido = novoTelefone();
    await enviar(desconhecido, 'stop').expect(200);
    expect(await resposta(desconhecido)).toMatch(/não tem nada para desligar/);
  });

  it('ajuda, repetição do webhook, limite por hora e assinatura', async () => {
    const tel = novoTelefone();
    await enviar(tel, 'bom dia').expect(200);
    expect(await resposta(tel)).toMatch(/envie o número/);

    // O Twilio repete o mesmo MessageSid: uma resposta só.
    const p = {
      MessageSid: 'SMrepetido',
      From: tel,
      To: NUMERO_SMS,
      Body: 'ola',
    };
    for (let i = 0; i < 2; i++) {
      await ctx
        .http()
        .post('/v1/webhooks/sms/entrada')
        .type('form')
        .set('X-Twilio-Signature', assinaturaTwilio(TOKEN, URL, p))
        .send(p)
        .expect(200);
    }
    // Limite: 6 por hora; a partir daí regista mas não responde.
    for (let i = 0; i < 6; i++) await enviar(tel, `mensagem ${i}`).expect(200);
    const enviados = await linhas(
      ctx.db,
      `SELECT 1 FROM mensagens_saida WHERE destino = $1 AND motivo = 'resposta_sms'`,
      [tel],
    );
    expect(enviados).toHaveLength(6);
    const ignorados = await linhas(
      ctx.db,
      `SELECT 1 FROM sms_recebidos WHERE de = $1 AND intencao = 'ignorado'`,
      [tel],
    );
    expect(ignorados).toHaveLength(2);

    await enviar(tel, 'CP 1/2026', false).expect(403);
  });
});
