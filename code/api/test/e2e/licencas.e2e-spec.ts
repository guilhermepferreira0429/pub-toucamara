/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { LicencasService } from '../../src/modules/licencas/licencas.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  novaChamada,
  smsPara,
  MUNICIPIO_ID,
} from './app';

/** O próximo sábado com pelo menos 10 dias de distância (AAAA-MM-DD). */
function sabadoDistante(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 10);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Uma terça-feira distante (o limite é a meia-noite). */
function tercaDistante(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 10);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Licença decidida na chamada: as regras correm em código, a taxa paga-se
 * em modo de teste, um funcionário aprova com um clique e a licença chega
 * por SMS com um QR verificável.
 */
describe('Licenças decididas na chamada (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    // Estes testes são do fluxo "um funcionário aprova com um clique".
    await ctx
      .http()
      .put('/v1/painel/licencas/aprovacao/ruido')
      .set(chefe)
      .send({ aprovacao: 'funcionario' })
      .expect(200);
  });
  afterAll(async () => {
    await ctx
      .http()
      .put('/v1/painel/licencas/aprovacao/ruido')
      .set(chefe)
      .send({ aprovacao: 'automatica' });
    await ctx.fechar();
  });

  const festa = (data = sabadoDistante()) => ({
    atividade: 'festa_privada',
    descricao: 'Festa de anos no quintal, com música',
    morada: 'Rua do Teste 10, Guimarães',
    data,
    hora_inicio: '20:00',
    hora_fim: '1h',
    pessoas: 40,
    musica_amplificada: true,
    nome: 'Rita Festas',
  });

  /** Paga o pagamento de teste do processo pela página pública (como no link do SMS). */
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

  it('dentro das regras: MB WAY de teste → pago → aprovar → SMS com o QR → página e PDF', async () => {
    const chamada = novaChamada('ler');
    const r = await ferramenta(
      ctx,
      chamada,
      'pedir_licenca_ruido',
      festa(),
    ).expect(200);
    expect(r.body).toMatchObject({
      pedida: true,
      numero: expect.stringMatching(/^LER \d+\/\d{4}$/),
      proposta: 'aprovar',
      taxa: expect.stringContaining('25'),
      pagamento: { modo_teste: true, metodo: 'mbway', valor_cent: 2500 },
      regras_de_demonstracao: true,
      dizer: expect.stringContaining('cumpre'),
    });
    expect(r.body.condicoes.join(' ')).toContain('dentro de casa');

    const l = await linha(
      ctx.db,
      `SELECT l.id, l.estado, l.processo_id, p.numero, p.fase::text AS fase, t.codigo
       FROM licencas l JOIN processos p ON p.id = l.processo_id
       JOIN tipos_processo t ON t.id = p.tipo_processo_id
       WHERE p.numero = $1 AND p.municipio_id = '${MUNICIPIO_ID}'`,
      [r.body.numero],
    );
    expect(l).toMatchObject({
      estado: 'a_pagar',
      codigo: 'LER',
      fase: 'apreciacao',
    });

    // Ainda por pagar: não se aprova.
    const cedo = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(409);
    expect(cedo.body.erro.mensagem).toContain('paga');

    await pagar(l.processo_id);
    const lista = await ctx
      .http()
      .get('/v1/painel/licencas')
      .set(chefe)
      .expect(200);
    const naLista = lista.body.licencas.find(
      (x: { id: string }) => x.id === l.id,
    );
    expect(naLista).toMatchObject({
      estado: 'por_aprovar',
      pagamento: { estado: 'pago', modo_teste: true },
      avaliacao: { proposta: 'aprovar' },
    });
    expect(lista.body.licencas[0].estado).toBe('por_aprovar');

    const ap = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(200);
    expect(ap.body).toMatchObject({
      estado: 'emitida',
      codigo_verificacao: expect.stringMatching(/^[A-Z0-9]{10}$/),
      decidida_por_nome: expect.any(String),
    });
    const codigo = ap.body.codigo_verificacao;

    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms.map((s) => s.corpo).join(' ')).toContain(`/licenca/${codigo}`);

    const pub = await ctx
      .http()
      .get(`/v1/public/licencas/${codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      numero: r.body.numero,
      valida: true,
      titular: 'Rita F.',
      horario: '20:00 às 01:00',
      modo_teste: true,
      pdf: true,
    });
    const pdf = await ctx
      .http()
      .get(`/v1/public/licencas/${codigo}/pdf`)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const p = await linha(
      ctx.db,
      `SELECT fase::text AS fase, decisao FROM processos WHERE id = $1`,
      [l.processo_id],
    );
    expect(p).toEqual({ fase: 'notificado', decisao: 'admitido' });
  });

  it('fora das regras (terça até à 1h): vai para um técnico, que pode aprovar ou recusar', async () => {
    const chamada = novaChamada('ler');
    const r = await ferramenta(
      ctx,
      chamada,
      'pedir_licenca_ruido',
      festa(tercaDistante()),
    ).expect(200);
    expect(r.body).toMatchObject({
      proposta: 'tecnico',
      pagamento: null,
      taxa: null,
    });
    expect(r.body.regras.join(' ')).toContain('✗');
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms[0].corpo).toContain('técnico');

    const l = await linha(
      ctx.db,
      `SELECT l.id FROM licencas l JOIN processos p ON p.id = l.processo_id WHERE p.numero = $1 AND p.municipio_id = '${MUNICIPIO_ID}'`,
      [r.body.numero],
    );
    const rec = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/recusar`)
      .set(chefe)
      .send({ motivo: 'Numa terça o limite é a meia-noite.' })
      .expect(200);
    expect(rec.body).toMatchObject({ estado: 'recusada' });
    await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(409);
  });

  it('técnico aprova fora das regras: falta pagar e emite sozinha quando chega o pagamento', async () => {
    const chamada = novaChamada('ler');
    const r = await ferramenta(
      ctx,
      chamada,
      'pedir_licenca_ruido',
      festa(tercaDistante()),
    ).expect(200);
    const l = await linha(
      ctx.db,
      `SELECT l.id, l.processo_id FROM licencas l JOIN processos p ON p.id = l.processo_id WHERE p.numero = $1 AND p.municipio_id = '${MUNICIPIO_ID}'`,
      [r.body.numero],
    );
    const ap = await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(200);
    expect(ap.body.estado).toBe('a_pagar');
    await pagar(l.processo_id);
    await ctx.app.get(LicencasService).sincronizar();
    const d = await ctx
      .http()
      .get(`/v1/painel/licencas/${l.id}`)
      .set(chefe)
      .expect(200);
    expect(d.body.estado).toBe('emitida');
  });

  it('regras: a câmara muda os números (só com permissão de agente) e o agente usa-os', async () => {
    const atual = await ctx
      .http()
      .get('/v1/painel/licencas/regras')
      .set(chefe)
      .expect(200);
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await ctx
      .http()
      .put('/v1/painel/licencas/regras')
      .set(tecnico)
      .send(atual.body.config)
      .expect(403);
    await ctx
      .http()
      .put('/v1/painel/licencas/regras')
      .set(chefe)
      .send({
        ...atual.body.config,
        hora_fim_max_semana: '02:00',
        taxa_cent: 0,
      })
      .expect(200);
    const r = await ferramenta(
      ctx,
      novaChamada('ler'),
      'pedir_licenca_ruido',
      festa(tercaDistante()),
    ).expect(200);
    expect(r.body).toMatchObject({ proposta: 'aprovar', pagamento: null });
    const l = await linha(
      ctx.db,
      `SELECT l.estado FROM licencas l JOIN processos p ON p.id = l.processo_id WHERE p.numero = $1 AND p.municipio_id = '${MUNICIPIO_ID}'`,
      [r.body.numero],
    );
    expect(l.estado).toBe('por_aprovar');
    await ctx
      .http()
      .put('/v1/painel/licencas/regras')
      .set(chefe)
      .send(atual.body.config)
      .expect(200);
  });

  it('sem número de telefone (chat anónimo) → precisa_identificacao', async () => {
    const r = await ferramenta(
      ctx,
      { conversa: novaChamada().conversa, telefone: '' },
      'pedir_licenca_ruido',
      festa(),
    ).expect(200);
    expect(r.body).toMatchObject({
      pedida: false,
      motivo: 'precisa_identificacao',
    });
  });

  it('código desconhecido na página pública → 404', async () => {
    await ctx.http().get('/v1/public/licencas/ABCDEFGHJK').expect(404);
    await ctx.http().get('/v1/public/licencas/curto').expect(404);
  });
});
