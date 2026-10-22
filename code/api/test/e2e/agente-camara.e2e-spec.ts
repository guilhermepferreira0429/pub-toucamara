/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { RetomarService } from '../../src/modules/conversas/retomar.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  MUNICIPIO_ID,
} from './app';

/**
 * V2 · Agente: "As perguntas da câmara" (um conjunto do município no
 * avaliador, versão nova a cada mudança) e a voz/ritmo do painel na chamada.
 */
describe('Agente · perguntas da câmara e voz (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  it('acrescentar e tirar perguntas cria versões; o resultado vem do nosso sistema', async () => {
    const vazio = await ctx
      .http()
      .get('/v1/painel/agente/perguntas')
      .set(chefe)
      .expect(200);
    expect(vazio.body).toMatchObject({ total: 0, certas_pct: null });

    const a = await ctx
      .http()
      .post('/v1/painel/agente/perguntas')
      .set(chefe)
      .send({
        texto: 'O meu pai precisa de uma rampa à porta, a câmara ajuda?',
      })
      .expect(201);
    expect(a.body.itens[0]).toMatchObject({
      comportamento: 'responder',
      veredicto: null,
    });
    await ctx
      .http()
      .post('/v1/painel/agente/perguntas')
      .set(chefe)
      .send({
        texto: 'Onde deixo o carro para ir ao Balcão Único?',
        comportamento: 'responder',
      })
      .expect(201);
    const repetida = await ctx
      .http()
      .post('/v1/painel/agente/perguntas')
      .set(chefe)
      .send({ texto: 'onde deixo o carro para ir ao balcão único?' })
      .expect(409);
    expect(repetida.body.erro.codigo).toBe('pergunta_repetida');

    // O avaliador correu a versão atual: uma certa, uma errada.
    const atual = await ctx
      .http()
      .get('/v1/painel/agente/perguntas')
      .set(chefe)
      .expect(200);
    const [rampa, carro] = atual.body.itens as { id: string }[];
    const conjunto = await linha<{ conjunto_id: string }>(
      ctx.db,
      'SELECT conjunto_id FROM avaliacao.perguntas WHERE id = $1',
      [rampa.id],
    );
    const sistema = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, nosso)
       VALUES ('Tou E2E perguntas', $1, 'tou-chat', true) RETURNING id`,
      [MUNICIPIO_ID],
    );
    const ex = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.execucoes (sistema_id, conjunto_id, estado)
       VALUES ($1, $2, 'terminada') RETURNING id`,
      [sistema!.id, conjunto!.conjunto_id],
    );
    for (const [p, veredicto] of [
      [rampa.id, 'certa'],
      [carro.id, 'errada'],
    ]) {
      const r = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO avaliacao.respostas (execucao_id, pergunta_id, texto)
         VALUES ($1, $2, 'resposta') RETURNING id`,
        [ex!.id, p],
      );
      await ctx.db.query(
        `INSERT INTO avaliacao.avaliacoes (resposta_id, rubrica_versao, veredicto)
         VALUES ($1, 'e2e', $2)`,
        [r!.id, veredicto],
      );
    }
    await ctx.db.query(
      `INSERT INTO avaliacao.gabarito (pergunta_id, municipio_id, resposta, estado, aprovado_em)
       VALUES ($1, $2, 'Sim, há apoio.', 'aprovado', now())`,
      [rampa.id, MUNICIPIO_ID],
    );

    // Tirar a do carro: versão nova, a da rampa mantém resultado e gabarito.
    const depois = await ctx
      .http()
      .delete(`/v1/painel/agente/perguntas/${carro.id}`)
      .set(chefe)
      .expect(200);
    expect(depois.body).toMatchObject({
      total: 1,
      avaliadas: 1,
      certas: 1,
      certas_pct: 100,
      a_corrigir: 0,
    });
    const nova = depois.body.itens[0];
    expect(nova.id).not.toBe(rampa.id);
    expect(nova.veredicto).toBe('certa');
    const g = await linha(
      ctx.db,
      `SELECT estado FROM avaliacao.gabarito WHERE pergunta_id = $1`,
      [nova.id],
    );
    expect(g?.estado).toBe('aprovado');
    const versoes = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM avaliacao.conjuntos
       WHERE nome = 'Perguntas da câmara' AND municipio_id = $1`,
      [MUNICIPIO_ID],
    );
    expect(versoes?.n).toBe(3);
    // As execuções antigas continuam a apontar para as perguntas feitas.
    expect(
      await linha(ctx.db, 'SELECT 1 FROM avaliacao.perguntas WHERE id = $1', [
        carro.id,
      ]),
    ).toBeTruthy();

    await ctx
      .http()
      .delete(`/v1/painel/agente/perguntas/${carro.id}`)
      .set(chefe)
      .expect(404);
  });

  it('só quem tem o agente vê as perguntas', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .get('/v1/painel/agente/perguntas')
      .set(atendimento)
      .expect(403);
  });

  it('início da chamada: voz e ritmo do painel só com a flag', async () => {
    await ctx.db.query(
      `UPDATE agente_config SET voz_id = 'voz-minho', ritmo = 'calmo' WHERE municipio_id = $1`,
      [MUNICIPIO_ID],
    );
    const retomar = ctx.app.get(RetomarService);
    const pedido = {
      agent_id: 'agente-e2e',
      caller_id: '+351910000999',
      called_number: '+351253000000',
    };
    const sem = await retomar.inicioChamada(pedido);
    expect(sem.conversation_config_override).toBeUndefined();
    const com = await retomar.inicioChamada(pedido, new Date(), true);
    expect(com.conversation_config_override).toEqual({
      tts: { voice_id: 'voz-minho', speed: 0.9 },
    });
  });
});
