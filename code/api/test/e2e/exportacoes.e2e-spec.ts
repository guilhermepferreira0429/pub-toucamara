/* eslint-disable @typescript-eslint/no-unsafe-member-access -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { nomeCsv } from '../../src/common/csv';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  MUNICIPIO_ID,
  novoTelefone,
} from './app';

/** CSV para o Excel português (peça 8): conversas, ocorrências, processos, reclamações. */

/** O corpo da resposta como texto (o supertest não lê text/csv sozinho). */
function comoTexto(
  res: unknown,
  fim: (e: Error | null, corpo: unknown) => void,
) {
  // Em runtime é o IncomingMessage do Node.
  const s = res as NodeJS.ReadableStream;
  let corpo = '';
  s.setEncoding('utf8');
  s.on('data', (c: string) => (corpo += c));
  s.on('end', () => fim(null, corpo));
}

describe('Exportar CSV (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx?.fechar());

  it('conversas: os filtros da lista, ; BOM CRLF, fórmulas neutralizadas, telefone mascarado', async () => {
    const marca = randomUUID().slice(0, 8);
    const telefone = novoTelefone();
    const {
      rows: [mu],
    } = await ctx.db.query<{ id: string }>(
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Maria Exportada') RETURNING id`,
      [MUNICIPIO_ID, telefone],
    );
    await ctx.db.query(
      `INSERT INTO conversas (municipio_id, municipe_id, canal, iniciada_em, duracao_s, resultado, resumo)
       VALUES ($1, $2, 'telefone', '2026-07-01T12:05:00Z', 90, 'sem_resposta', $3),
              ($1, $2, 'chat', '2026-07-01T12:06:00Z', NULL, 'resolvida', $4)`,
      [
        MUNICIPIO_ID,
        mu.id,
        `=HYPERLINK("x") ${marca}; "aspas"`,
        `Outra ${marca}`,
      ],
    );

    const r = await ctx
      .http()
      .get('/v1/painel/conversas/exportar.csv')
      .query({ resultado: 'sem_resposta', texto: marca })
      .set(chefe)
      .buffer(true)
      .parse(comoTexto)
      .expect(200);
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.headers['content-disposition']).toBe(
      `attachment; filename="${nomeCsv('conversas')}"`,
    );
    const csv = r.body as string;
    expect(csv.startsWith('\uFEFFInício;Canal;Duração (min);Resultado;')).toBe(
      true,
    );
    expect(csv.endsWith('\r\n')).toBe(true);
    const linhas = csv.split('\r\n').filter(Boolean);
    expect(linhas).toHaveLength(2); // cabeçalho + a conversa sem resposta
    const l = linhas[1];
    expect(l).toContain('01/07/2026 13:05;Telefone;1,5;Sem resposta;');
    expect(l).toContain(`"'=HYPERLINK(""x"") ${marca}; ""aspas"""`);
    expect(l).not.toContain('Maria Exportada');
    expect(l).not.toContain(telefone);
    expect(l).toContain(telefone.slice(-3));
  });

  it('ocorrências, processos e reclamações: 200 com cabeçalho; filtros inválidos → 400', async () => {
    for (const [lista, cabecalho] of [
      ['ocorrencias', 'Número;Registada em;Estado;Categoria;'],
      ['processos', 'Número;Tipo;Assunto;'],
      ['reclamacoes', 'Número;Recebida em;Canal;Estado;'],
    ]) {
      const r = await ctx
        .http()
        .get(`/v1/painel/${lista}/exportar.csv`)
        .set(chefe)
        .buffer(true)
        .parse(comoTexto)
        .expect(200);
      expect((r.body as string).startsWith(`\uFEFF${cabecalho}`)).toBe(true);
      expect(r.headers['content-disposition']).toContain(`${lista}-`);
    }
    const f = await ctx
      .http()
      .get('/v1/painel/ocorrencias/exportar.csv')
      .query({ estado: 'talvez' })
      .set(chefe)
      .expect(400);
    expect(f.body.erro.codigo).toBe('pedido_invalido');
  });

  it('a mesma permissão da lista: sem sessão 401; sem acesso 403', async () => {
    await ctx.http().get('/v1/painel/ocorrencias/exportar.csv').expect(401);
    // O vereador vê a visão geral, não a lista dos processos.
    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    await ctx
      .http()
      .get('/v1/painel/processos/exportar.csv')
      .set(vereador)
      .expect(403);
  });
});
