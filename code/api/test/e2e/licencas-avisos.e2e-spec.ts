/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { LicencasAvisosService } from '../../src/modules/licencas/avisos.service';
import { somarDias } from '../../src/modules/licencas/comum';
import {
  arrancarApp,
  Chamada,
  Contexto,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
  pedirLicenca,
  smsPara,
} from './app';

/** A linha, que tem de existir. */
async function existe<T>(
  db: Contexto['db'],
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const r = await linha<T>(db, sql, params);
  if (!r) throw new Error(`Sem resultado: ${sql}`);
  return r;
}

/** Um dia útil daqui a ~3 semanas (AAAA-MM-DD). */
function daquiA(dias = 21): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Calendário de obrigações: avisos antes de a licença expirar (SMS uma
 * só vez por aviso, ou chamada a quem prefere telefone), o separador
 * "A expirar" do painel e a renovação pelo agente.
 */
describe('Licenças: avisos antes de expirar e renovação (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let avisos: LicencasAvisosService;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    avisos = ctx.app.get(LicencasAvisosService);
  });
  afterAll(() => ctx.fechar());

  async function pagar(processoId: string) {
    const l = await linha(
      ctx.db,
      `SELECT lc.codigo FROM pagamentos pg
       JOIN links_curtos lc ON lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
       WHERE pg.processo_id = $1 ORDER BY lc.expira_em DESC LIMIT 1`,
      [processoId],
    );
    await ctx
      .http()
      .post(`/v1/public/pagamentos/${l.codigo}/simular-pagamento`)
      .send({})
      .expect((r) => expect([200, 201]).toContain(r.status));
  }

  /** Uma esplanada de 1 mês, paga e emitida; devolve a licença. */
  async function esplanadaEmitida(chamada: Chamada) {
    const r = await pedirLicenca(ctx, chamada, 'esplanada', {
      estabelecimento: 'Café Avenida',
      morada: 'Avenida Conde Margaride 20, Guimarães',
      data_inicio: daquiA(),
      meses: 1,
      area_m2: 10,
      mesas: 4,
      passeio_livre_m: 2,
      nome: 'Café Avenida Lda',
    }).expect(200);
    expect(r.body.proposta).toBe('aprovar');
    const l = await existe<{ id: string; processo_id: string }>(
      ctx.db,
      `SELECT l.id, l.processo_id FROM licencas l JOIN processos p ON p.id = l.processo_id
       WHERE p.numero = $1 AND p.municipio_id = '${MUNICIPIO_ID}'`,
      [r.body.numero],
    );
    await pagar(l.processo_id);
    // A leitura do painel passa as pagas a "por aprovar".
    await ctx.http().get(`/v1/painel/licencas/${l.id}`).set(chefe).expect(200);
    const ap = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(200);
    expect(ap.body.estado).toBe('emitida');
    const v = await existe<{ valida_ate: string }>(
      ctx.db,
      `SELECT to_char(valida_ate, 'YYYY-MM-DD') AS valida_ate FROM licencas WHERE id = $1`,
      [l.id],
    );
    return {
      id: l.id,
      numero: r.body.numero as string,
      codigo: ap.body.codigo_verificacao as string,
      valida_ate: v.valida_ate,
    };
  }

  it('job: SMS 30 dias antes, uma só vez; depois o de 7 dias; a página diz "avisamos 30 dias antes"', async () => {
    const chamada = novaChamada('aviso');
    const l = await esplanadaEmitida(chamada);
    expect(l.valida_ate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const pub = await ctx
      .http()
      .get(`/v1/public/licencas/${l.codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      valida_ate: l.valida_ate,
      aviso_dias_antes: 30,
    });

    // Ainda antes da janela: nada.
    await avisos.avisar(somarDias(l.valida_ate, -31));
    expect(await smsPara(ctx, chamada.telefone, 'lembrete')).toHaveLength(0);

    const dia30 = somarDias(l.valida_ate, -30);
    await avisos.avisar(dia30);
    await avisos.avisar(dia30);
    await avisos.avisar(somarDias(dia30, 1));
    const sms = await smsPara(ctx, chamada.telefone, 'lembrete');
    expect(sms).toHaveLength(1);
    expect(sms[0].corpo).toContain(l.numero);
    expect(sms[0].corpo).toContain('Para renovar, ligue ou escreva-nos');
    expect(sms[0].corpo).toContain(`/licenca/${l.codigo}`);
    expect(sms[0].relacionado).toMatchObject({ licenca_id: l.id });

    await avisos.avisar(somarDias(l.valida_ate, -7));
    await avisos.avisar(somarDias(l.valida_ate, -6));
    expect(await smsPara(ctx, chamada.telefone, 'lembrete')).toHaveLength(2);
    const enviados = await linhas<{ dias: number; canal: string }>(
      ctx.db,
      'SELECT dias, canal FROM licenca_avisos WHERE licenca_id = $1 ORDER BY dias DESC',
      [l.id],
    );
    expect(enviados).toEqual([
      { dias: 30, canal: 'sms' },
      { dias: 7, canal: 'sms' },
    ]);

    // O painel: separador "A expirar", por semana, com o aviso enviado.
    const ax = await ctx
      .http()
      .get('/v1/painel/licencas/a-expirar?dias=90')
      .set(chefe)
      .expect(200);
    const todas = ax.body.semanas.flatMap(
      (s: { licencas: unknown[] }) => s.licencas,
    );
    expect(todas.find((x: { id: string }) => x.id === l.id)).toMatchObject({
      numero: l.numero,
      tipo: 'esplanada',
      valida_ate: l.valida_ate,
      estado_aviso: 'avisado',
      avisos: [
        expect.objectContaining({ dias: 30, canal: 'sms' }),
        expect.objectContaining({ dias: 7, canal: 'sms' }),
      ],
    });
    expect(ax.body.avisos.esplanada).toEqual([30, 7]);
    expect(ax.body.semanas[0]).toMatchObject({
      inicio: expect.any(String),
      fim: expect.any(String),
    });
  });

  it('renovar_licenca: encontra a licença a expirar, renova com os mesmos dados e só o que mudou; depois já não avisa', async () => {
    const chamada = novaChamada('renova');
    const l = await esplanadaEmitida(chamada);

    // Primeiro sem confirmar: mostra os dados.
    const ver = await ferramenta(ctx, chamada, 'renovar_licenca', {}).expect(
      200,
    );
    expect(ver.body).toMatchObject({
      encontrada: true,
      licenca: {
        numero: l.numero,
        tipo: 'esplanada',
        valida_ate: l.valida_ate,
      },
      dizer: expect.stringContaining('Mudou alguma coisa?'),
    });
    expect(ver.body.licenca.dados.join(' ')).toContain('Mesas: 4');

    const r = await ferramenta(ctx, chamada, 'renovar_licenca', {
      confirmar: true,
      alteracoes: { mesas: 5, meses: 2 },
    }).expect(200);
    expect(r.body).toMatchObject({
      pedida: true,
      tipo: 'esplanada',
      renova: l.numero,
      numero: expect.stringMatching(/^ESP /),
      proposta: 'aprovar',
      // 10 m² × 2 meses × 3 € = 60 €
      pagamento: { valor_cent: 6000 },
      dizer: expect.stringContaining(
        `Pedido de renovação da licença de esplanada ${l.numero}`,
      ),
    });
    const nova = await existe<{
      renova_licenca_id: string;
      dados: Record<string, unknown>;
    }>(
      ctx.db,
      `SELECT l.renova_licenca_id, l.dados FROM licencas l JOIN processos p ON p.id = l.processo_id
       WHERE p.numero = $1 AND p.municipio_id = '${MUNICIPIO_ID}'`,
      [r.body.numero],
    );
    expect(nova.renova_licenca_id).toBe(l.id);
    expect(nova.dados).toMatchObject({
      estabelecimento: 'Café Avenida',
      mesas: 5,
      meses: 2,
      data_inicio: somarDias(l.valida_ate, 1),
    });

    // Já renovada: o job não avisa e a ferramenta diz que já está.
    await avisos.avisar(somarDias(l.valida_ate, -30));
    expect(await smsPara(ctx, chamada.telefone, 'lembrete')).toHaveLength(0);
    const outra = await ferramenta(ctx, chamada, 'renovar_licenca', {}).expect(
      200,
    );
    expect(outra.body).toMatchObject({
      encontrada: false,
      motivo: 'ja_renovada',
    });
    const ax = await ctx
      .http()
      .get('/v1/painel/licencas/a-expirar?dias=90')
      .set(chefe)
      .expect(200);
    expect(
      ax.body.semanas
        .flatMap((s: { licencas: unknown[] }) => s.licencas)
        .find((x: { id: string }) => x.id === l.id),
    ).toMatchObject({
      estado_aviso: 'renovada',
      renovacao: { numero: r.body.numero },
    });
  });

  it('renovar_licenca sem licenças a expirar, e sem identificação', async () => {
    const r = await ferramenta(
      ctx,
      novaChamada('nada'),
      'renovar_licenca',
      {},
    ).expect(200);
    expect(r.body.encontrada).toBe(false);
    expect(['sem_licencas', 'precisa_identificacao']).toContain(r.body.motivo);
    const anon = await ferramenta(
      ctx,
      { conversa: novaChamada('anon').conversa, telefone: '' },
      'renovar_licenca',
      {},
    ).expect(200);
    expect(anon.body.motivo).toBe('precisa_identificacao');
  });

  it('a quem prefere telefone, com a opção ligada: o agente liga em vez do SMS', async () => {
    const [cfg] = (
      await ctx.db.query(
        'SELECT chamadas_saida FROM agente_config WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      )
    ).rows as { chamadas_saida: unknown }[];
    await ctx.db.query(
      'UPDATE agente_config SET chamadas_saida = $2 WHERE municipio_id = $1',
      [
        MUNICIPIO_ID,
        JSON.stringify({
          ativo: true,
          motivos: ['renovacao_licenca'],
          numero_id: 'phnum_teste',
          via: 'twilio',
        }),
      ],
    );
    const regras = await ctx
      .http()
      .get('/v1/painel/licencas/regras/esplanada')
      .set(chefe)
      .expect(200);
    await ctx
      .http()
      .put('/v1/painel/licencas/regras/esplanada')
      .set(chefe)
      .send({ ...regras.body.config, aviso_por_chamada: true })
      .expect(200);
    try {
      const chamada = novaChamada('ligar');
      const l = await esplanadaEmitida(chamada);
      await ctx.db.query(
        `UPDATE municipes SET canal_preferido = 'telefone', aceita_chamadas = true
         WHERE telefone_e164 = $1`,
        [chamada.telefone],
      );
      await avisos.avisar(somarDias(l.valida_ate, -30));
      const a = await existe<{ canal: string; chamada_id: string }>(
        ctx.db,
        'SELECT canal, chamada_id FROM licenca_avisos WHERE licenca_id = $1',
        [l.id],
      );
      expect(a.canal).toBe('chamada');
      const c = await existe<{
        motivo: string;
        contexto: { o_que_mudou: string };
        recurso: { corpo: string };
      }>(
        ctx.db,
        'SELECT motivo, contexto, recurso FROM chamadas_saida WHERE id = $1',
        [a.chamada_id],
      );
      expect(c.motivo).toBe('renovacao_licenca');
      expect(c.contexto.o_que_mudou).toContain(l.numero);
      expect(c.recurso.corpo).toContain('Para renovar');
      // Sem SMS (vai só se a chamada não for atendida).
      expect(await smsPara(ctx, chamada.telefone, 'lembrete')).toHaveLength(0);
      await ctx.db.query(
        `UPDATE chamadas_saida SET estado = 'cancelada' WHERE id = $1`,
        [a.chamada_id],
      );
    } finally {
      await ctx
        .http()
        .put('/v1/painel/licencas/regras/esplanada')
        .set(chefe)
        .send(regras.body.config)
        .expect(200);
      await ctx.db.query(
        'UPDATE agente_config SET chamadas_saida = $2 WHERE municipio_id = $1',
        [MUNICIPIO_ID, JSON.stringify(cfg?.chamadas_saida ?? null)],
      );
    }
  });
});
