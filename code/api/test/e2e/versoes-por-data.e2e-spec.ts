/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  MUNICIPIO_ID,
  novaChamada,
  TIPO_CP_ID,
} from './app';

/** "Que regra valia no dia X" (FUN §12): as versões de uma fonte por data. */
describe('Versões dos regulamentos por data (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  const palavra = `quiosques${randomUUID()
    .replace(/[^a-f]/g, '')
    .slice(0, 6)}`;
  let fonteId: string;
  let v1: string;
  let v2: string;

  const regulamento = (euros: number) =>
    [
      'Artigo 1.º Taxas',
      `A ocupação de ${palavra} na via pública paga uma taxa de ${euros} euros por mês, por cada ${palavra}.`,
    ].join('\n');

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    // Os ids do seed não são UUID v4 (o zod do painel recusa-os).
    const e = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO entidades (id, municipio_id, nome, tipo) VALUES ($1, $2, 'Câmara (versões)', 'camara') RETURNING id`,
      [randomUUID(), MUNICIPIO_ID],
    );
    const f = await ctx
      .http()
      .post('/v1/painel/conhecimento/fontes')
      .set(chefe)
      .send({
        entidade_id: e!.id,
        titulo: `Regulamento de ${palavra}`,
        tipo: 'regulamento',
        url: `https://exemplo.pt/${palavra}`,
        leitura_automatica: false,
      });
    if (f.status !== 201) throw new Error(JSON.stringify(f.body));
    fonteId = f.body.id;
    v1 = (
      await ctx
        .http()
        .post(`/v1/painel/conhecimento/fontes/${fonteId}/texto`)
        .set(chefe)
        .send({ texto: regulamento(10), vigor_desde: '2024-01-01' })
        .expect(200)
    ).body.versao_id;
    v2 = (
      await ctx
        .http()
        .post(`/v1/painel/conhecimento/fontes/${fonteId}/texto`)
        .set(chefe)
        .send({ texto: regulamento(20), vigor_desde: '2025-06-01' })
        .expect(200)
    ).body.versao_id;
  });
  afterAll(() => ctx.fechar());

  const procurar = (em_data?: string) =>
    ferramenta(ctx, novaChamada(), 'procurar_conhecimento', {
      pergunta: `Quanto custa a taxa dos ${palavra}?`,
      ...(em_data ? { em_data } : {}),
    }).expect(200);

  it('o agente responde com a regra de hoje, ou com a que valia nesse dia', async () => {
    const hoje = await procurar();
    expect(hoje.body.trechos[0].texto).toContain('20 euros');

    const antes = await procurar('2025-01-15');
    expect(antes.body).toMatchObject({
      em_data: '2025-01-15',
      sem_fonte: false,
      mudou_desde: true,
    });
    expect(antes.body.trechos[0]).toMatchObject({
      versao_id: v1,
      vigor_desde: '2024-01-01',
      versao_atual: false,
    });
    expect(antes.body.trechos[0].texto).toContain('10 euros');

    // Antes de existir a regra: nada (não se responde com a de hoje).
    const cedo = await procurar('2023-05-01');
    expect(cedo.body).toMatchObject({ sem_fonte: true, trechos: [] });
  });

  it('painel: versões da fonte, o texto num dia e acertar as datas legais', async () => {
    const vs = await ctx
      .http()
      .get(`/v1/painel/conhecimento/fontes/${fonteId}/versoes`)
      .set(chefe)
      .expect(200);
    expect(vs.body.itens.map((x: { id: string }) => x.id)).toEqual([v2, v1]);
    expect(vs.body.itens[0]).toMatchObject({ atual: true, data_legal: true });

    const em = await ctx
      .http()
      .get(`/v1/painel/conhecimento/fontes/${fonteId}/em?data=2025-01-15`)
      .set(chefe)
      .expect(200);
    expect(em.body).toMatchObject({ versao_id: v1 });
    expect(em.body.texto).toContain('10 euros');

    // Afinal a versão nova foi publicada a 1 de janeiro de 2025.
    await ctx
      .http()
      .patch(`/v1/painel/conhecimento/fontes/${fonteId}/versoes/${v2}`)
      .set(chefe)
      .send({ vigor_desde: '2025-01-01' })
      .expect(200);
    const depois = await procurar('2025-01-15');
    expect(depois.body.trechos[0].versao_id).toBe(v2);

    await ctx
      .http()
      .patch(`/v1/painel/conhecimento/fontes/${fonteId}/versoes/${v2}`)
      .set(chefe)
      .send({ vigor_desde: '2025-02-01', vigor_ate: '2025-01-01' })
      .expect(400);
    await ctx
      .http()
      .get(`/v1/painel/conhecimento/fontes/${fonteId}/em?data=2020-01-01`)
      .set(chefe)
      .expect(404);
  });

  it('a regra que valia quando o processo entrou', async () => {
    const p = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, fase, criado_em)
       VALUES ($1, $2, $3, 'Quiosque', 'apreciacao', '2024-12-01T10:00:00Z') RETURNING id`,
      [MUNICIPIO_ID, `CP ${randomInt(10000, 99999)}/2024`, TIPO_CP_ID],
    );
    const r = await ctx
      .http()
      .get(
        `/v1/painel/conhecimento/a-data-do-processo?q=${encodeURIComponent(`taxa dos ${palavra}`)}&processo_id=${p!.id}`,
      )
      .set(chefe)
      .expect(200);
    expect(r.body.processo.dia).toBe('2024-12-01');
    expect(r.body.trechos[0]).toMatchObject({ versao_id: v1 });
  });

  it('só quem edita o conhecimento acerta as datas', async () => {
    const at = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .patch(`/v1/painel/conhecimento/fontes/${fonteId}/versoes/${v1}`)
      .set(at)
      .send({ vigor_ate: '2024-12-31' })
      .expect(403);
  });
});
