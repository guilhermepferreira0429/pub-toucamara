/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  MUNICIPIO_ID,
} from './app';

/** V2 · Processos · Tipos e documentos: a câmara edita os tipos e os documentos exigidos. */
describe('Tipos de processo · edição (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  const codigo = () =>
    `T${randomUUID()
      .replace(/[^a-f]/g, '')
      .slice(0, 4)
      .toUpperCase()
      .padEnd(4, 'X')}`;

  it('criar um tipo, mudar prazo e desativar; código repetido → 409; técnico → 403', async () => {
    const c = codigo();
    const r = await ctx
      .http()
      .post('/v1/painel/tipos-processo')
      .set(chefe)
      .send({
        codigo: c.toLowerCase(),
        nome: 'Ocupação da via pública',
        prazo_dias_uteis: 10,
      })
      .expect(201);
    expect(r.body).toMatchObject({
      codigo: c,
      prazo_dias_uteis: 10,
      ativo: true,
      documentos: [],
      usado_este_ano: 0,
    });
    await ctx
      .http()
      .post('/v1/painel/tipos-processo')
      .set(chefe)
      .send({ codigo: c, nome: 'Outro', prazo_dias_uteis: 5 })
      .expect(409);
    const a = await ctx
      .http()
      .patch(`/v1/painel/tipos-processo/${r.body.id}`)
      .set(chefe)
      .send({
        prazo_dias_uteis: 15,
        ativo: false,
        frase_do_agente: 'Diz isto.',
      })
      .expect(200);
    expect(a.body).toMatchObject({
      prazo_dias_uteis: 15,
      ativo: false,
      frase_do_agente: 'Diz isto.',
    });

    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await ctx
      .http()
      .patch(`/v1/painel/tipos-processo/${r.body.id}`)
      .set(tecnico)
      .send({ prazo_dias_uteis: 1 })
      .expect(403);
  });

  it('documentos exigidos: acrescentar com verificações, mudar, remover; em uso não se remove', async () => {
    const t = await ctx
      .http()
      .post('/v1/painel/tipos-processo')
      .set(chefe)
      .send({
        codigo: codigo(),
        nome: 'Licença de publicidade',
        prazo_dias_uteis: 20,
      })
      .expect(201);
    const d = await ctx
      .http()
      .post(`/v1/painel/tipos-processo/${t.body.id}/documentos`)
      .set(chefe)
      .send({
        nome: 'Certidão permanente',
        verificacoes: [{ tipo: 'validade', meses: 6 }, { tipo: 'assinatura' }],
      })
      .expect(201);
    const doc = d.body.documentos[0];
    expect(doc).toMatchObject({
      nome: 'Certidão permanente',
      obrigatorio: true,
      ordem: 1,
      verificacoes: [{ tipo: 'validade', meses: 6 }, { tipo: 'assinatura' }],
    });
    const m = await ctx
      .http()
      .patch(`/v1/painel/tipos-processo/${t.body.id}/documentos/${doc.id}`)
      .set(chefe)
      .send({ obrigatorio: false })
      .expect(200);
    expect(m.body.documentos[0].obrigatorio).toBe(false);
    const sem = await ctx
      .http()
      .delete(`/v1/painel/tipos-processo/${t.body.id}/documentos/${doc.id}`)
      .set(chefe)
      .expect(200);
    expect(sem.body.documentos).toEqual([]);
    await ctx
      .http()
      .post(`/v1/painel/tipos-processo/${t.body.id}/documentos`)
      .set(chefe)
      .send({ nome: 'X', verificacoes: [{ tipo: 'inventada' }] })
      .expect(400);
  });

  it('documento já pedido num processo não se remove (409)', async () => {
    const t = await ctx
      .http()
      .post('/v1/painel/tipos-processo')
      .set(chefe)
      .send({ codigo: codigo(), nome: 'Tipo com uso', prazo_dias_uteis: 20 })
      .expect(201);
    const d = await ctx
      .http()
      .post(`/v1/painel/tipos-processo/${t.body.id}/documentos`)
      .set(chefe)
      .send({ nome: 'Planta' })
      .expect(201);
    const docId: string = d.body.documentos[0].id;
    await ctx.db.query(
      `WITH p AS (
         INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto)
         VALUES ($1, $2, $3, 'Teste') RETURNING id),
       e AS (
         INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo)
         SELECT id, 'documento_pedido', 'Pedido', 'sistema' FROM p RETURNING id, processo_id)
       INSERT INTO processo_pedidos (processo_id, evento_id, descricao, tipo_documento_id, prazo)
       SELECT processo_id, id, 'Planta', $4, current_date + 10 FROM e`,
      [MUNICIPIO_ID, `TU ${randomUUID().slice(0, 8)}`, t.body.id, docId],
    );
    const r = await ctx
      .http()
      .delete(`/v1/painel/tipos-processo/${t.body.id}/documentos/${docId}`)
      .set(chefe)
      .expect(409);
    expect(r.body.erro.codigo).toBe('documento_em_uso');
  });
});
