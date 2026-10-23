/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'node:crypto';
import {
  arrancarApp,
  Contexto,
  ferramenta,
  MUNICIPIO,
  novaConversa,
  smsPara,
} from './app';

/** Um telemóvel fora da gama de demonstração (+351 910 000 xxx). */
function telemovel(): string {
  return `+35196${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}

/**
 * "Experimentar uma renovação" no /ligar: a licença de esplanada de
 * demonstração fica no número de quem experimenta, sem SMS na preparação;
 * na chamada com esse número o assistente encontra-a e renova-a, e os SMS
 * da renovação vão para esse número.
 */
describe('Demonstração: experimentar uma renovação com o próprio número (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  const preparar = (telefone: string) =>
    ctx
      .http()
      .post(`/v1/public/demo/${MUNICIPIO}/renovacao`)
      .send({ telefone });

  it('cria a licença no número (uma só), a chamada encontra-a e renova; os SMS vão para esse número', async () => {
    const telefone = telemovel();
    const r = await preparar(telefone.slice(4)).expect(201);
    expect(r.body).toMatchObject({
      numero: expect.stringMatching(/^ESP /),
      estabelecimento: 'Café da Praça',
      valida_ate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      ja_existia: false,
    });
    // A preparação não manda nada a quem experimenta.
    expect(await smsPara(ctx, telefone)).toHaveLength(0);

    // Outra vez: a mesma licença.
    const outra = await preparar(telefone).expect(201);
    expect(outra.body).toMatchObject({
      numero: r.body.numero,
      ja_existia: true,
    });

    const chamada = { conversa: novaConversa('visitante'), telefone };
    const ver = await ferramenta(ctx, chamada, 'renovar_licenca', {}).expect(
      200,
    );
    expect(ver.body).toMatchObject({
      encontrada: true,
      licenca: {
        numero: r.body.numero,
        tipo: 'esplanada',
        valida_ate: r.body.valida_ate,
      },
    });
    const ren = await ferramenta(ctx, chamada, 'renovar_licenca', {
      confirmar: true,
    }).expect(200);
    expect(ren.body).toMatchObject({
      pedida: true,
      renova: r.body.numero,
      proposta: 'aprovar',
      pagamento: { referencia: expect.any(String) },
    });
    expect((await smsPara(ctx, telefone)).length).toBeGreaterThan(0);

    // Já renovada: a próxima tentativa cria outra.
    const nova = await preparar(telefone).expect(201);
    expect(nova.body.ja_existia).toBe(false);
    expect(nova.body.numero).not.toBe(r.body.numero);
  });

  it('recusa os números de demonstração e os que não são telemóveis', async () => {
    const demo = await preparar('910000106').expect(400);
    expect(demo.body.erro.codigo).toBe('telefone_demonstracao');
    const fixo = await preparar('253421200').expect(400);
    expect(fixo.body.erro.codigo).toBe('telefone_invalido');
  });
});
