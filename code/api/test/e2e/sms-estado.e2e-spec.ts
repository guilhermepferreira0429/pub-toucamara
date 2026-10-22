/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`. */
import { ConfigService } from '@nestjs/config';
import { assinaturaTwilio } from '../../src/common/twilio';
import {
  arrancarApp,
  Contexto,
  linha,
  MUNICIPIO_ID,
  novoTelefone,
} from './app';

const URL_ESTADO = 'https://api.teste.pt/v1/webhooks/sms/estado';
const TOKEN = 'token-twilio-sms-e2e';

/** POST /v1/webhooks/sms/estado: entregue / falhou pelo StatusCallback do Twilio. */
describe('Estado dos SMS (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
    const config = ctx.app.get(ConfigService);
    config.set('comunicacao.twilio', { accountSid: 'ACsms', authToken: TOKEN });
    config.set('app.apiUrl', 'https://api.teste.pt');
  });
  afterAll(() => ctx.fechar());

  async function smsEnviado(sid: string): Promise<string> {
    const m = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO mensagens_saida (municipio_id, canal, destino, motivo, corpo, estado, provider_id, enviada_em)
       VALUES ($1, 'sms', $2, 'processo', 'Olá', 'enviada', $3, now()) RETURNING id`,
      [MUNICIPIO_ID, novoTelefone(), sid],
    );
    return m!.id;
  }

  const avisar = (params: Record<string, string>, assinar = true) => {
    const r = ctx.http().post('/v1/webhooks/sms/estado').type('form');
    if (assinar) {
      r.set('X-Twilio-Signature', assinaturaTwilio(TOKEN, URL_ESTADO, params));
    }
    return r.send(params);
  };

  const estado = (id: string) =>
    linha<{ estado: string; erro: string | null; entregue_em: Date | null }>(
      ctx.db,
      'SELECT estado, erro, entregue_em FROM mensagens_saida WHERE id = $1',
      [id],
    );

  it('entregue, e depois um aviso atrasado de falha não o desfaz', async () => {
    const id = await smsEnviado('SM111');
    await avisar({ MessageSid: 'SM111', MessageStatus: 'sent' }).expect(204);
    expect((await estado(id))!.estado).toBe('enviada');
    await avisar({ MessageSid: 'SM111', MessageStatus: 'delivered' }).expect(
      204,
    );
    expect(await estado(id)).toMatchObject({
      estado: 'entregue',
      entregue_em: expect.any(Date),
    });
    await avisar({
      MessageSid: 'SM111',
      MessageStatus: 'undelivered',
      ErrorCode: '30003',
    }).expect(204);
    expect((await estado(id))!.estado).toBe('entregue');
  });

  it('falhou, com o código do erro', async () => {
    const id = await smsEnviado('SM222');
    await avisar({
      MessageSid: 'SM222',
      MessageStatus: 'undelivered',
      ErrorCode: '30005',
    }).expect(204);
    expect(await estado(id)).toMatchObject({
      estado: 'falhou',
      erro: 'Twilio: undelivered (30005)',
    });
  });

  it('sem assinatura válida → 403 e nada muda', async () => {
    const id = await smsEnviado('SM333');
    const r = await avisar(
      { MessageSid: 'SM333', MessageStatus: 'delivered' },
      false,
    ).expect(403);
    expect(r.body.erro).toBeDefined();
    expect((await estado(id))!.estado).toBe('enviada');
  });
});
