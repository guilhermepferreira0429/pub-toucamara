/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'node:crypto';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  MUNICIPIO_ID,
  TIPO_CP_ID,
} from './app';

/**
 * Painel · Processos: os abertos primeiro e os decididos no fim, e as
 * colunas N.º, Fase e Prazo ordenáveis, com o "Ver mais" a seguir a ordem.
 * Os processos deste teste têm uma freguesia só sua (a BD é partilhada).
 */
describe('Processos: ordem da lista (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  const freguesia = `Ordem ${randomUUID().slice(0, 8)}`;

  // [número, fase, prazo_fim] pela ordem em que entram.
  const PROCESSOS: [string, string, string | null][] = [
    ['A', 'notificado', '2026-01-10'],
    ['B', 'apreciacao', '2026-12-01'],
    ['C', 'entrada', null],
    ['D', 'arquivado', '2025-06-01'],
    ['E', 'decisao', '2026-11-20'],
  ];

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    for (const [i, [n, fase, prazo]] of PROCESSOS.entries()) {
      await ctx.db.query(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, fase, prazo_fim, freguesia, criado_em)
         VALUES ($1, $2, $3, $4, $5::fase_processo, $6::date, $7, now() - make_interval(mins => $8))`,
        [
          MUNICIPIO_ID,
          `${freguesia} ${n}`,
          TIPO_CP_ID,
          `Processo ${n}`,
          fase,
          prazo,
          freguesia,
          100 - i,
        ],
      );
    }
  });
  afterAll(() => ctx.fechar());

  async function lista(q: Record<string, string>): Promise<string[]> {
    const nomes: string[] = [];
    let cursor: string | null = null;
    do {
      const qs = new URLSearchParams({
        freguesia,
        limite: '2',
        ...q,
        ...(cursor ? { cursor } : {}),
      });
      const r = await ctx
        .http()
        .get(`/v1/painel/processos?${qs.toString()}`)
        .set(chefe)
        .expect(200);
      nomes.push(
        ...r.body.itens.map((p: { assunto: string }) => p.assunto.slice(-1)),
      );
      cursor = r.body.proximo_cursor;
    } while (cursor);
    return nomes;
  }

  it('por omissão: abertos pelo prazo (sem prazo no fim), e os decididos no fundo', async () => {
    expect(await lista({})).toEqual(['E', 'B', 'C', 'D', 'A']);
  });

  it('por N.º (ordem de entrada), nos dois sentidos; os decididos continuam no fim', async () => {
    expect(await lista({ ordem: 'numero' })).toEqual(['B', 'C', 'E', 'A', 'D']);
    expect(await lista({ ordem: 'numero', sentido: 'desc' })).toEqual([
      'E',
      'C',
      'B',
      'D',
      'A',
    ]);
  });

  it('por fase, pela ordem do processo', async () => {
    expect(await lista({ ordem: 'fase' })).toEqual(['C', 'B', 'E', 'A', 'D']);
  });

  it('um cursor antigo (só a data) recomeça do início em vez de dar erro', async () => {
    const antigo = Buffer.from(
      JSON.stringify({ em: '2026-01-01', id: randomUUID() }),
    ).toString('base64url');
    const r = await ctx
      .http()
      .get(
        `/v1/painel/processos?${new URLSearchParams({ freguesia, cursor: antigo }).toString()}`,
      )
      .set(chefe)
      .expect(200);
    expect(r.body.itens).toHaveLength(5);
  });
});
