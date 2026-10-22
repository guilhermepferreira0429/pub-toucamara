/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'node:crypto';
import { arrancarApp, Contexto, linha } from './app';

/**
 * A avaliação à vista de todos: GET /v1/public/avaliacao/:municipio, sem
 * login. Um município só deste teste, para nenhum outro ficheiro mexer na
 * "última execução".
 */
describe('Avaliação pública (e2e)', () => {
  let ctx: Contexto;
  let slug: string;
  let municipioId: string;

  beforeAll(async () => {
    ctx = await arrancarApp();
    slug = `aval-${randomUUID().slice(0, 8)}`;
    const m = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipios (slug, nome) VALUES ($1, 'Avaliação Pública') RETURNING id`,
      [slug],
    );
    municipioId = m!.id;
  });
  afterAll(() => ctx.fechar());

  async function execucao(
    sistemaId: string,
    conjuntoId: string,
    respostas: [string, string, string | null][],
  ) {
    const ex = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.execucoes (sistema_id, conjunto_id, estado, terminada_em)
       VALUES ($1, $2, 'terminada', now()) RETURNING id`,
      [sistemaId, conjuntoId],
    );
    for (const [perguntaId, texto, veredicto] of respostas) {
      const r = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO avaliacao.respostas (execucao_id, pergunta_id, texto)
         VALUES ($1, $2, $3) RETURNING id`,
        [ex!.id, perguntaId, texto],
      );
      if (veredicto) {
        await ctx.db.query(
          `INSERT INTO avaliacao.avaliacoes (resposta_id, rubrica_versao, veredicto, justificacao)
           VALUES ($1, 'e2e', $2, $3)`,
          [r!.id, veredicto, `Veredicto sobre: ${texto}`],
        );
      }
    }
    return ex!.id;
  }

  it('sem avaliação: diz que não há números, sem inventar', async () => {
    const r = await ctx.http().get(`/v1/public/avaliacao/${slug}`).expect(200);
    expect(r.body).toMatchObject({
      municipio: { slug, nome: 'Avaliação Pública' },
      limiar: 80,
      outro_nome:
        'A assistente do site da Câmara Municipal de Avaliação Pública',
      nosso: null,
      outro: null,
      comparacao: null,
      perguntas: [],
    });
    expect(r.headers['cache-control']).toContain('max-age=60');
  });

  it('o nosso, por tema e pergunta a pergunta; o outro sem nome e comparado nas mesmas perguntas', async () => {
    const conjunto = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.conjuntos (nome, municipio_id) VALUES ('E2E pública', $1) RETURNING id`,
      [municipioId],
    );
    const perguntas: string[] = [];
    for (const [ordem, categoria, texto] of [
      [1, 'Urbanismo', 'Preciso de licença para mudar os azulejos?'],
      [2, 'Água', 'Estou sem água, o que faço?'],
      [3, 'Urbanismo', 'Quanto custa a licença de obras?'],
    ] as const) {
      const p = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO avaliacao.perguntas (conjunto_id, ordem, categoria, texto, comportamento)
         VALUES ($1, $2, $3, $4, 'responder') RETURNING id`,
        [conjunto!.id, ordem, categoria, texto],
      );
      perguntas.push(p!.id);
    }
    await ctx.db.query(
      `INSERT INTO avaliacao.gabarito (pergunta_id, municipio_id, resposta, fontes, estado, aprovado_em)
       VALUES ($1, $2, 'Não precisa: é uma obra isenta.', $3, 'aprovado', now())`,
      [
        perguntas[0],
        municipioId,
        JSON.stringify([
          { titulo: 'RJUE, artigo 6.º', url: 'https://exemplo.pt/rjue' },
        ]),
      ],
    );

    const nosso = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, nosso)
       VALUES ($1, $2, 'tou-chat', true) RETURNING id`,
      [`Tou · ${slug}`, municipioId],
    );
    const outro = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, nosso)
       VALUES ($1, $2, 'manual', false) RETURNING id`,
      [`Bia · ${slug}`, municipioId],
    );
    const execNossa = await execucao(nosso!.id, conjunto!.id, [
      [perguntas[0], 'Não precisa de licença.', 'certa'],
      [perguntas[1], 'Ligue para a Vimágua.', 'passada_bem'],
      [perguntas[2], 'Custa 10 euros.', 'errada'],
    ]);
    // O outro só foi avaliado em duas: a comparação conta essas duas.
    const execOutro = await execucao(outro!.id, conjunto!.id, [
      [perguntas[0], 'Olá, sou a Bia! Contacte a câmara por email.', 'errada'],
      [perguntas[1], 'A BIA não sabe. Ligue para a câmara. (Acme)', 'errada'],
      [perguntas[2], 'Sem resposta da Bianca.', null],
    ]);

    const r = await ctx.http().get(`/v1/public/avaliacao/${slug}`).expect(200);
    expect(r.body.nosso).toMatchObject({
      total: 3,
      certas: 1,
      passadas_bem: 1,
      erradas: 1,
      taxa: 66.67,
      passou: false,
    });
    expect(r.body.outro).toMatchObject({ total: 2, erradas: 2, taxa: 0 });
    expect(r.body.comparacao).toEqual({
      perguntas: 2,
      nosso: { acertos: 2, taxa: 100 },
      outro: { acertos: 0, taxa: 0 },
    });
    expect(r.body.categorias).toHaveLength(2);
    expect(r.body.categorias).toEqual(
      expect.arrayContaining([
        { categoria: 'Urbanismo', total: 2, taxa: 50 },
        { categoria: 'Água', total: 1, taxa: 100 },
      ]),
    );

    const [p1, p2, p3] = r.body.perguntas;
    expect(p1).toMatchObject({
      ordem: 1,
      categoria: 'Urbanismo',
      pergunta: 'Preciso de licença para mudar os azulejos?',
      resposta: 'Não precisa de licença.',
      veredicto: 'certa',
      resposta_certa: 'Não precisa: é uma obra isenta.',
      fontes: [{ titulo: 'RJUE, artigo 6.º', url: 'https://exemplo.pt/rjue' }],
      outro: {
        resposta: 'Olá, sou a [nome]! Contacte a câmara por email.',
        veredicto: 'errada',
        justificacao:
          'Veredicto sobre: Olá, sou a [nome]! Contacte a câmara por email.',
      },
    });
    // O nome sai em qualquer caixa, mas só a palavra inteira; e também os de
    // AVALIACAO_TAPAR (a marca do fornecedor).
    expect(p2.outro.resposta).toBe(
      'A [nome] não sabe. Ligue para a câmara. ([nome])',
    );
    expect(p3.outro).toMatchObject({
      resposta: 'Sem resposta da Bianca.',
      veredicto: null,
    });

    // Nada de nomes de sistemas nem de ids internos.
    const corpo = JSON.stringify(r.body);
    expect(corpo).not.toMatch(/\bBia\b/);
    expect(corpo).not.toContain(`Tou · ${slug}`);
    for (const id of [
      execNossa,
      execOutro,
      nosso!.id,
      outro!.id,
      perguntas[0],
    ]) {
      expect(corpo).not.toContain(id);
    }
  });

  it('os resultados da preparação da demo nunca aparecem, mesmo sendo os mais recentes', async () => {
    const conjunto = await linha<{ id: string }>(
      ctx.db,
      `SELECT id FROM avaliacao.conjuntos WHERE nome = 'E2E pública' AND municipio_id = $1`,
      [municipioId],
    );
    const { rows: perguntas } = await ctx.db.query<{ id: string }>(
      'SELECT id FROM avaliacao.perguntas WHERE conjunto_id = $1 ORDER BY ordem',
      [conjunto!.id],
    );
    for (const nosso of [true, false]) {
      const demo = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, config, nosso)
         VALUES ($1, $2, $3, '{"demonstracao": true}', $4) RETURNING id`,
        [
          `Demo ${nosso ? 'nosso' : 'outro'} · ${slug}`,
          municipioId,
          nosso ? 'tou-chat' : 'manual',
          nosso,
        ],
      );
      await execucao(
        demo!.id,
        conjunto!.id,
        perguntas.map((p) => [p.id, 'Resposta de demonstração.', 'certa']),
      );
    }

    const r = await ctx.http().get(`/v1/public/avaliacao/${slug}`).expect(200);
    expect(r.body.nosso).toMatchObject({ total: 3, taxa: 66.67 });
    expect(r.body.outro).toMatchObject({ total: 2, taxa: 0 });
    expect(JSON.stringify(r.body)).not.toContain('Resposta de demonstração.');
  });

  it('município que não existe: 404', async () => {
    await ctx.http().get('/v1/public/avaliacao/nao-existe-aqui').expect(404);
  });
});
