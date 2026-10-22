/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  ferramenta,
  linha,
  MUNICIPIO_ID,
  novaChamada,
} from './app';

/**
 * Ajuda ao funcionário numa passagem: as regras que se aplicam (a mesma
 * pesquisa do agente), a ficha da pessoa e, sem IA configurada, sem resposta
 * sugerida mas com o motivo. "Ensinar ao agente" deixa a resposta proposta em
 * Conhecimento › Sem resposta.
 */
describe('Ajuda ao funcionário (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  async function novaPassagem(resumo: string): Promise<string> {
    const chamada = novaChamada('apoio');
    await ferramenta(ctx, chamada, 'passar_a_humano', {
      motivo: 'sem_fonte',
      resumo,
    }).expect(200);
    const p = await linha<{ id: string }>(
      ctx.db,
      `SELECT p.id FROM passagens_humano p JOIN conversas c ON c.id = p.conversa_id
       WHERE c.provider_id = $1`,
      [chamada.conversa],
    );
    return p!.id;
  }

  it('sugestão sem IA: as regras da pesquisa, sem resposta inventada', async () => {
    const id = await novaPassagem(
      'Quer abrir uma porta na fachada da casa e pergunta se precisa de licença.',
    );
    const r = await ctx
      .http()
      .post(`/v1/painel/passagens/${id}/sugestao`)
      .set(chefe)
      .expect(200);
    expect(r.body).toMatchObject({
      ia: false,
      sugestao: null,
      motivo_sem_ia: expect.stringContaining('não está configurado'),
      sem_fonte: false,
      processos: [],
      ocorrencias: [],
    });
    expect(r.body.regras.length).toBeGreaterThan(0);
    expect(r.body.regras[0]).toMatchObject({
      titulo: expect.any(String),
      referencia: expect.stringMatching(/art\./),
      texto: expect.any(String),
    });
  });

  it('ensinar ao agente: fica em Sem resposta, com a equipa, com a resposta do funcionário', async () => {
    const id = await novaPassagem('Pergunta se pode pôr um toldo na varanda.');
    const r = await ctx
      .http()
      .post(`/v1/painel/passagens/${id}/ensinar`)
      .set(chefe)
      .send({
        pergunta: 'Posso pôr um toldo na varanda?',
        resposta: 'Toldos na fachada precisam de comunicação à câmara.',
      })
      .expect(201);
    expect(r.body.estado).toBe('com_equipa');
    const p = await linha(
      ctx.db,
      'SELECT texto, estado, o_que_falta FROM perguntas_sem_resposta WHERE id = $1',
      [r.body.pergunta_sem_resposta_id],
    );
    expect(p).toMatchObject({
      texto: 'Posso pôr um toldo na varanda?',
      estado: 'com_equipa',
      o_que_falta: expect.stringContaining('comunicação à câmara'),
    });
  });

  it('sem resposta: ordena por mais perguntadas ou mais recentes, e pagina', async () => {
    for (const [texto, vezes, dias] of [
      ['Ordem A antiga e muito perguntada', 90, 20],
      ['Ordem B recente', 2, 0],
      ['Ordem C do meio', 5, 3],
    ] as const) {
      await ctx.db.query(
        `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes, ultima_em)
         VALUES ($1, $2, $3, now() - make_interval(days => $4))`,
        [MUNICIPIO_ID, texto, vezes, dias],
      );
    }
    const textos = async (q: string) => {
      const todas: string[] = [];
      let cursor: string | null = null;
      do {
        const r = await ctx
          .http()
          .get(
            `/v1/painel/conhecimento/sem-resposta?limite=1&${q}${cursor ? `&cursor=${cursor}` : ''}`,
          )
          .set(chefe)
          .expect(200);
        todas.push(...r.body.itens.map((x: { texto: string }) => x.texto));
        cursor = r.body.proximo_cursor;
      } while (cursor);
      return todas.filter((t) => t.startsWith('Ordem '));
    };
    expect(await textos('ordem=vezes')).toEqual([
      'Ordem A antiga e muito perguntada',
      'Ordem C do meio',
      'Ordem B recente',
    ]);
    expect(await textos('ordem=recentes')).toEqual([
      'Ordem B recente',
      'Ordem C do meio',
      'Ordem A antiga e muito perguntada',
    ]);
  });

  it('passagem de outro município ou inexistente → 404', async () => {
    await ctx
      .http()
      .post(
        '/v1/painel/passagens/00000000-0000-0000-0000-000000000000/sugestao',
      )
      .set(chefe)
      .expect(404);
  });
});
