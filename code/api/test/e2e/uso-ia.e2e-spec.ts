/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { randomUUID } from 'crypto';
import { UsoIaService } from '../../src/ia/uso-ia.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  MUNICIPIO_ID,
} from './app';

/*
 * Uso da IA: o registo (com o município tirado do alvo nos jobs), o custo
 * por atendimento no painel e a lista "onde a IA foi usada" numa conversa.
 */
describe('uso da IA', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let uso: UsoIaService;
  const conversa = randomUUID();

  beforeAll(async () => {
    ctx = await arrancarApp();
    uso = ctx.app.get(UsoIaService);
    chefe = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'chefe_divisao'),
    );
    // Uma chamada de 10 minutos, hoje.
    await ctx.db.query(
      `INSERT INTO conversas (id, municipio_id, canal, iniciada_em, terminada_em, duracao_s, resultado)
       VALUES ($1, $2, 'telefone', now() - interval '20 minutes', now() - interval '10 minutes', 600, 'resolvida')`,
      [conversa, MUNICIPIO_ID],
    );
  }, 60_000);

  afterAll(async () => {
    await ctx?.fechar();
  });

  it('regista com o município do alvo e mostra o custo por atendimento', async () => {
    const antes = (
      await ctx.http().get('/v1/painel/uso-ia/custos').set(chefe).expect(200)
    ).body;

    // Num job não há pedido do painel: o município vem da conversa.
    await uso.registar({
      tarefa: 'resumo_conversa',
      modelo: 'claude-sonnet-5-5',
      resultado: 'ok',
      tokens: { entrada: 1000, saida: 200, cacheLidos: 5000, cacheEscritos: 0 },
      municipioId: null,
      alvo: { tipo: 'conversa', id: conversa },
      dadosMinimizados: true,
      instrucoesDetetadas: 1,
    });

    const r = await ctx
      .http()
      .get('/v1/painel/uso-ia/custos')
      .set(chefe)
      .expect(200);
    expect(r.body).toMatchObject({ estimativa: true });
    expect(r.body.atendimentos).toBe(antes.atendimentos);
    // 5000 microdólares de IA a mais.
    expect(r.body.ia_eur - antes.ia_eur).toBeCloseTo(
      0.005 * r.body.cambio_usd_eur,
      6,
    );
    expect(r.body.instrucoes_detetadas - antes.instrucoes_detetadas).toBe(1);
    expect(r.body.pedidos_minimizados - antes.pedidos_minimizados).toBe(1);
    expect(r.body.voz_minutos).toBeGreaterThanOrEqual(10);
    expect(r.body.por_atendimento_eur).toBeGreaterThan(0);
    expect(
      r.body.por_tarefa.map((t: { tarefa: string }) => t.tarefa),
    ).toContain('resumo_conversa');
  });

  it('a conversa mostra onde a IA foi usada', async () => {
    const r = await ctx
      .http()
      .get(`/v1/painel/uso-ia/registo?alvo_tipo=conversa&alvo_id=${conversa}`)
      .set(chefe)
      .expect(200);
    expect(r.body).toEqual([
      expect.objectContaining({
        tarefa: 'resumo_conversa',
        resultado: 'ok',
        dados_minimizados: true,
        instrucoes_detetadas: 1,
      }),
    ]);
  });

  it('sem sessão do painel, nada', async () => {
    await ctx.http().get('/v1/painel/uso-ia/custos').expect(401);
  });
});
