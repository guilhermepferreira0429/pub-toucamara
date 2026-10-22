/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'crypto';
import { LinksCurtosService } from '../../src/modules/comunicacao/links-curtos.service';
import { PagamentosService } from '../../src/modules/pagamentos/pagamentos.service';
import { MunicipiosService } from '../../src/modules/municipios/municipios.service';
import {
  arrancarApp,
  Contexto,
  linha,
  MUNICIPIO_ID,
  novoTelefone,
  TIPO_CP_ID,
} from './app';

/**
 * V2 · Acompanhar o processo (munícipe): a taxa por pagar na página do
 * processo, o PDF da decisão e "como foi tratar disto connosco?".
 */
describe('O seu processo · pagar, decisão e avaliação (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  async function novoProcesso() {
    const telefone = novoTelefone();
    const m = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Rui Teste') RETURNING id`,
      [MUNICIPIO_ID, telefone],
    );
    const p = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, fase)
       VALUES ($1, $2, $3, $4, 'Porta na cozinha', 'apreciacao') RETURNING id`,
      [
        MUNICIPIO_ID,
        `CP ${randomInt(100_000, 999_999)}/PUB`,
        TIPO_CP_ID,
        m!.id,
      ],
    );
    const link = await ctx.app
      .get(LinksCurtosService)
      .criar(MUNICIPIO_ID, 'processo', p!.id);
    return { id: p!.id, codigo: link.codigo, telefone, municipeId: m!.id };
  }

  const ver = (codigo: string) =>
    ctx.http().get(`/v1/public/processos/${codigo}`).expect(200);

  it('taxa por pagar: aparece na página com o código do link de pagamento', async () => {
    const p = await novoProcesso();
    expect((await ver(p.codigo)).body).toMatchObject({
      pagamento: null,
      decisao_pdf: false,
      avaliacao: null,
    });
    const municipio = await ctx.app.get(MunicipiosService).porId(MUNICIPIO_ID);
    await ctx.app.get(PagamentosService).criar(
      {
        municipio,
        canal: 'chat',
        conversaId: null,
        municipeId: p.municipeId,
        telefone: p.telefone,
      },
      { processo_id: p.id },
      {
        linhas: [
          {
            codigo: 'X',
            descricao: 'Taxa',
            unidade: 'fixo',
            quantidade: 1,
            valor_unitario_cent: 6470,
            valor_cent: 6470,
          },
        ],
        total_cent: 6470,
      },
    );
    const r = await ver(p.codigo);
    expect(r.body.pagamento).toMatchObject({
      estado: 'pendente',
      valor_cent: 6470,
      modo_teste: true,
      codigo: expect.stringMatching(/^[A-Z0-9]{6}$/),
    });
    // O código abre a página de pagar.
    await ctx
      .http()
      .get(`/v1/public/pagamentos/${r.body.pagamento.codigo}`)
      .expect(200);
  });

  it('decisão: PDF da decisão e avaliação de 1 a 3 (uma por processo)', async () => {
    const p = await novoProcesso();
    const cedo = await ctx
      .http()
      .post(`/v1/public/processos/${p.codigo}/avaliacao`)
      .send({ nota: 3 })
      .expect(409);
    expect(cedo.body.erro.codigo).toBe('processo_aberto');
    await ctx
      .http()
      .get(`/v1/public/processos/${p.codigo}/decisao.pdf`)
      .expect(404);

    await ctx.db.query(
      `UPDATE processos SET fase = 'notificado', decisao = 'admitido', decidido_em = now() WHERE id = $1`,
      [p.id],
    );
    expect((await ver(p.codigo)).body.decisao_pdf).toBe(true);
    const pdf = await ctx
      .http()
      .get(`/v1/public/processos/${p.codigo}/decisao.pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    await ctx
      .http()
      .post(`/v1/public/processos/${p.codigo}/avaliacao`)
      .send({ nota: 3 })
      .expect(200);
    await ctx
      .http()
      .post(`/v1/public/processos/${p.codigo}/avaliacao`)
      .send({ nota: 2 })
      .expect(200);
    expect((await ver(p.codigo)).body.avaliacao).toBe(2);
    await ctx
      .http()
      .post(`/v1/public/processos/${p.codigo}/avaliacao`)
      .send({ nota: 5 })
      .expect(400);
  });
});
