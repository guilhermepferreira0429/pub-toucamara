/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { RgpdService } from '../../src/modules/painel/rgpd.service';
import { hojeNoFuso } from '../../src/modules/painel/periodos';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  linha,
  MUNICIPIO_ID,
} from './app';

/**
 * Inquérito de satisfação (peça 7): a pergunta na página do resumo (sem SMS
 * a mais), uma resposta por conversa, o cartão do painel e a retenção.
 */

let n = 0;
/** Código de link livre (6 caracteres do alfabeto dos links). */
function novoCodigo(): string {
  n += 1;
  return `S${randomUUID()
    .replace(/[^0-9A-F]/gi, '')
    .slice(0, 4)
    .toUpperCase()}${n % 10}`;
}

/** Conversa terminada com o link do resumo (o que o SMS do fim leva). */
async function conversaComLink(
  ctx: Contexto,
  municipioId = MUNICIPIO_ID,
  iniciada = 'now()',
): Promise<{ id: string; codigo: string }> {
  const [c] = (
    await ctx.db.query<{ id: string }>(
      `INSERT INTO conversas (municipio_id, canal, iniciada_em, terminada_em, resultado)
       VALUES ($1, 'telefone', ${iniciada}, ${iniciada} + interval '3 minutes', 'resolvida')
       RETURNING id`,
      [municipioId],
    )
  ).rows;
  const codigo = novoCodigo();
  await ctx.db.query(
    `INSERT INTO links_curtos (codigo, municipio_id, destino_tipo, destino_id, expira_em)
     VALUES ($1, $2, 'resumo', $3, now() + interval '30 days')`,
    [codigo, municipioId, c.id],
  );
  return { id: c.id, codigo };
}

describe('Satisfação (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx?.fechar());

  it('a página do resumo pergunta; uma resposta por conversa (idempotente)', async () => {
    const { id, codigo } = await conversaComLink(ctx);

    const antes = await ctx
      .http()
      .get(`/v1/public/resumos/${codigo}/satisfacao`)
      .expect(200);
    expect(antes.body).toEqual({ respondida: false, nota: null });

    const r = await ctx
      .http()
      .post(`/v1/public/resumos/${codigo.toLowerCase()}/satisfacao`)
      .send({ nota: 2, comentario: '  Demorou a perceber o que eu queria. ' })
      .expect(200);
    // O comentário nunca volta à página pública.
    expect(r.body).toEqual({ respondida: true, nota: 2 });

    // Segunda resposta (duplo clique): fica a primeira.
    const outra = await ctx
      .http()
      .post(`/v1/public/resumos/${codigo}/satisfacao`)
      .send({ nota: 5 })
      .expect(200);
    expect(outra.body).toEqual({ respondida: true, nota: 2 });

    const s = await linha<{
      nota: number;
      comentario: string;
      municipio_id: string;
    }>(
      ctx.db,
      'SELECT nota, comentario, municipio_id FROM satisfacao_respostas WHERE conversa_id = $1',
      [id],
    );
    expect(s).toEqual({
      nota: 2,
      comentario: 'Demorou a perceber o que eu queria.',
      municipio_id: MUNICIPIO_ID,
    });
  });

  it('nota fora de 1–5 → 400; link inexistente → 404; link expirado → 404', async () => {
    const { codigo } = await conversaComLink(ctx);
    for (const nota of [0, 6, 'boa']) {
      const r = await ctx
        .http()
        .post(`/v1/public/resumos/${codigo}/satisfacao`)
        .send({ nota })
        .expect(400);
      expect(r.body.erro.codigo).toBe('pedido_invalido');
    }
    const x = await ctx
      .http()
      .post('/v1/public/resumos/ZZZZ99/satisfacao')
      .send({ nota: 4 })
      .expect(404);
    expect(x.body.erro.codigo).toBe('link_invalido');

    await ctx.db.query(
      `UPDATE links_curtos SET expira_em = now() - interval '1 minute' WHERE codigo = $1`,
      [codigo],
    );
    await ctx
      .http()
      .post(`/v1/public/resumos/${codigo}/satisfacao`)
      .send({ nota: 4 })
      .expect(404);
  });

  it('painel: nota média, taxa de resposta e os últimos comentários', async () => {
    const chefe = await entrarPainel(ctx);
    const a = await conversaComLink(ctx);
    const b = await conversaComLink(ctx);
    await conversaComLink(ctx); // sem resposta: conta para a taxa
    await ctx
      .http()
      .post(`/v1/public/resumos/${a.codigo}/satisfacao`)
      .send({ nota: 5, comentario: 'Muito rápido, obrigado' })
      .expect(200);
    await ctx
      .http()
      .post(`/v1/public/resumos/${b.codigo}/satisfacao`)
      .send({ nota: 4 })
      .expect(200);

    const hoje = hojeNoFuso('Europe/Lisbon');
    const r = await ctx
      .http()
      .get('/v1/painel/satisfacao')
      .query({ de: hoje, ate: hoje })
      .set(chefe)
      .expect(200);
    expect(r.body).toMatchObject({
      periodo: { de: hoje, ate: hoje },
      media: expect.any(Number),
      respostas: expect.any(Number),
      elegiveis: expect.any(Number),
      taxa_resposta_pct: expect.any(Number),
    });
    expect(r.body.respostas).toBeGreaterThanOrEqual(2);
    expect(r.body.elegiveis).toBeGreaterThan(r.body.respostas);
    expect(r.body.distribuicao).toHaveLength(5);
    expect(r.body.comentarios[0]).toMatchObject({
      conversa_id: a.id,
      nota: 5,
      comentario: 'Muito rápido, obrigado',
    });

    // Sem sessão não há números nem comentários.
    await ctx.http().get('/v1/painel/satisfacao').expect(401);
  });

  it('retenção: o comentário sai com as transcrições; a nota fica', async () => {
    const M = randomUUID();
    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Satisfação e2e')`,
      [M, `satisfacao-${M.slice(0, 8)}`],
    );
    const velha = await conversaComLink(ctx, M, "now() - interval '2 years'");
    const nova = await conversaComLink(ctx, M);
    for (const c of [velha, nova]) {
      await ctx
        .http()
        .post(`/v1/public/resumos/${c.codigo}/satisfacao`)
        .send({ nota: 3, comentario: 'Chamo-me Maria, moro na Rua X' })
        .expect(200);
    }

    const m = await linha<{
      id: string;
      slug: string;
      nome: string;
      fuso: string;
    }>(ctx.db, 'SELECT id, slug, nome, fuso FROM municipios WHERE id = $1', [
      M,
    ]);
    await ctx.app.get(RgpdService).correrMunicipio(m!);

    const v = await linha(
      ctx.db,
      'SELECT nota, comentario FROM satisfacao_respostas WHERE conversa_id = $1',
      [velha.id],
    );
    expect(v).toEqual({ nota: 3, comentario: null });
    const f = await linha(
      ctx.db,
      'SELECT nota, comentario FROM satisfacao_respostas WHERE conversa_id = $1',
      [nova.id],
    );
    expect(f).toEqual({ nota: 3, comentario: 'Chamo-me Maria, moro na Rua X' });
    const audit = await linha<{ dados: any }>(
      ctx.db,
      `SELECT dados FROM audit_log
       WHERE municipio_id = $1 AND objeto_tipo = 'retencao' AND objeto_id = 'transcricoes'`,
      [M],
    );
    expect(audit?.dados).toMatchObject({ comentarios: 1 });
  });
});
