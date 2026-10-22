/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'crypto';
import {
  arrancarApp,
  Chamada,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  MUNICIPIO_ID,
  novaChamada,
  smsPara,
} from './app';

function novoNif(): string {
  const base = `2${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const soma = [...base].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const controlo = 11 - (soma % 11);
  return `${base}${controlo >= 10 ? 0 : controlo}`;
}

function pedir(
  ctx: Contexto,
  c: Chamada | undefined,
  acao: string,
  dados: Record<string, string> = {},
) {
  return ferramenta(ctx, c, 'pedir_servico', {
    area: 'habitacao',
    acao,
    dados: Object.entries(dados).map(([campo, valor]) => ({ campo, valor })),
  }).expect(200);
}

async function identificar(ctx: Contexto, c: Chamada): Promise<string> {
  await ferramenta(ctx, c, 'identificar_municipe', { nif: novoNif() }).expect(
    200,
  );
  const r = await linha<{ municipe_id: string }>(
    ctx.db,
    'SELECT municipe_id FROM conversas WHERE provider_id = $1',
    [c.conversa],
  );
  return r!.municipe_id;
}

describe('Habitação municipal (V4 #7): catálogo de serviços + painel', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let chamada: Chamada;
  let municipeId: string;
  let codigoCandidatura: string;
  let codigoReparacao: string;
  const fogo = `TESTE-${randomInt(100000, 999999)}`;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    await ctx
      .http()
      .post('/v1/painel/habitacao/demonstracao')
      .set(chefe)
      .expect(201);
    chamada = novaChamada('habitacao');
  });

  afterAll(() => ctx.fechar());

  it('outros_servicos lista as ações da habitação', async () => {
    const r = await ferramenta(ctx, chamada, 'outros_servicos', {
      area: 'habitacao',
    }).expect(200);
    expect(r.body.acoes.map((a: { acao: string }) => a.acao)).toEqual([
      'criterios',
      'pre_candidatura',
      'estado_candidatura',
      'renda',
      'pedir_reparacao',
      'revisao_renda',
    ]);
  });

  it('critérios sem identificação, com o limite do agregado', async () => {
    const r = await pedir(ctx, chamada, 'criterios', {
      regime: 'apoiado',
      agregado: '3',
      rendimento_anual: '9800',
    });
    expect(r.body.limites[0]).toMatchObject({ agregado: 3, cabe: true });
    expect(r.body.valores_de_demonstracao).toBe(true);
  });

  it('pré-candidatura: pede o NIF, pontua e explica cada critério', async () => {
    const sem = await pedir(ctx, chamada, 'pre_candidatura', {
      regime: 'apoiado',
      agregado: '3',
      rendimento_anual: '9800',
      situacao: 'sem_condicoes',
    });
    expect(sem.body.motivo).toBe('precisa_identificacao');

    municipeId = await identificar(ctx, chamada);
    const r = await pedir(ctx, chamada, 'pre_candidatura', {
      regime: 'apoiado',
      agregado: '3',
      rendimento_anual: '9800',
      situacao: 'sem_condicoes',
      menores: '2',
      anos_residencia: '6',
    });
    expect(r.body).toMatchObject({
      feito: true,
      elegivel: true,
      pontuacao_provisoria: 70,
      valores_de_demonstracao: true,
    });
    expect(r.body.criterios).toHaveLength(5);
    expect(r.body.dizer).toContain('70 em 100');
    codigoCandidatura = r.body.codigo;

    const outra = await pedir(ctx, chamada, 'pre_candidatura', {
      regime: 'apoiado',
      agregado: '3',
      rendimento_anual: '9800',
      situacao: 'sem_condicoes',
    });
    expect(outra.body).toMatchObject({
      motivo: 'ja_existe',
      codigo: codigoCandidatura,
    });

    const estado = await pedir(ctx, chamada, 'estado_candidatura');
    expect(estado.body.candidaturas[0]).toMatchObject({
      codigo: codigoCandidatura,
      estado: 'submetida',
      pontuacao: 70,
    });
  });

  it('acima do limite fica registada como excluída, com o motivo', async () => {
    const c = novaChamada('habitacao-rica');
    await identificar(ctx, c);
    const r = await pedir(ctx, c, 'pre_candidatura', {
      regime: 'apoiado',
      agregado: '1',
      rendimento_anual: '50000',
      situacao: 'adequada',
    });
    expect(r.body).toMatchObject({ feito: true, elegivel: false });
    expect(r.body.exclusoes[0]).toContain('limite');
    const bd = await linha(
      ctx.db,
      'SELECT estado FROM habitacao_candidaturas WHERE codigo = $1',
      [r.body.codigo],
    );
    expect(bd.estado).toBe('excluida');
  });

  it('renda e prestações só para quem tem contrato', async () => {
    const sem = await pedir(ctx, chamada, 'renda');
    expect(sem.body.motivo).toBe('sem_contrato');

    await ctx.db.query(
      `WITH f AS (
         INSERT INTO habitacao_fogos (municipio_id, codigo, morada, tipologia, estado)
         VALUES ($1, $2, 'Rua do Teste, 1', 'T2', 'ocupado') RETURNING id)
       INSERT INTO habitacao_contratos (municipio_id, fogo_id, municipe_id, regime, inicio,
         renda_cent, dia_vencimento, agregado, em_divida_cent)
       SELECT $1, f.id, $3, 'apoiado', '2020-01-01', 15000, 8, 1, 3000 FROM f`,
      [MUNICIPIO_ID, fogo, municipeId],
    );
    const r = await pedir(ctx, chamada, 'renda');
    expect(r.body).toMatchObject({
      encontrado: true,
      renda: '150,00 €',
      vence_ao_dia: 8,
      em_divida: '30,00 €',
    });
    expect(r.body.proximas).toHaveLength(3);
    expect(r.body.proximas[0].vence).toMatch(/-08$/);
  });

  it('reparação: gás é perigo (112 + piquete de demonstração); janela é normal', async () => {
    const gas = await pedir(ctx, chamada, 'pedir_reparacao', {
      categoria: 'gas',
      descricao: 'Há cheiro a gás na cozinha',
    });
    expect(gas.body).toMatchObject({
      feito: true,
      urgencia: 'urgente',
      perigo: true,
      piquete: '253 000 999',
      valores_de_demonstracao: true,
    });
    expect(gas.body.dizer).toContain('112');

    const janela = await pedir(ctx, chamada, 'pedir_reparacao', {
      categoria: 'portas_janelas',
      descricao: 'A janela do quarto não fecha bem',
    });
    expect(janela.body).toMatchObject({ feito: true, urgencia: 'normal' });
    expect(janela.body.piquete).toBeUndefined();
    codigoReparacao = janela.body.codigo;
  });

  it('revisão da renda com a estimativa provisória; não duplica', async () => {
    const r = await pedir(ctx, chamada, 'revisao_renda', {
      rendimento_mensal: '800',
      agregado: '1',
      motivo: 'Fiquei desempregado',
    });
    expect(r.body).toMatchObject({
      feito: true,
      renda_atual: '150,00 €',
      renda_estimada: '82,07 €',
      valores_de_demonstracao: true,
    });
    const outra = await pedir(ctx, chamada, 'revisao_renda', {
      rendimento_mensal: '700',
      agregado: '1',
      motivo: 'De novo',
    });
    expect(outra.body.motivo).toBe('ja_pedida');
  });

  it('painel: candidaturas com os critérios, mudar estado, reparações e fogos', async () => {
    const p = await ctx
      .http()
      .get('/v1/painel/habitacao')
      .set(chefe)
      .expect(200);
    expect(p.body.regras.demonstracao).toBe(true);

    const c = await ctx
      .http()
      .get('/v1/painel/habitacao/candidaturas')
      .set(chefe)
      .expect(200);
    const minha = c.body.candidaturas.find(
      (x: { codigo: string }) => x.codigo === codigoCandidatura,
    );
    expect(minha.pontuacao).toBe(70);
    expect(minha.criterios.lista).toHaveLength(5);
    await ctx
      .http()
      .patch(`/v1/painel/habitacao/candidaturas/${minha.id}`)
      .set(chefe)
      .send({ estado: 'admitida', nota: 'Documentos conferidos.' })
      .expect(200);
    const estado = await pedir(ctx, chamada, 'estado_candidatura', {
      codigo: codigoCandidatura,
    });
    expect(estado.body.dizer).toContain('admitida');
    expect(estado.body.dizer).toContain('Documentos conferidos.');

    const rep = await ctx
      .http()
      .get('/v1/painel/habitacao/reparacoes')
      .set(chefe)
      .expect(200);
    const j = rep.body.reparacoes.find(
      (x: { codigo: string }) => x.codigo === codigoReparacao,
    );
    expect(j).toMatchObject({ urgencia: 'normal', estado: 'registada', fogo });
    const atr = await ctx
      .http()
      .patch(`/v1/painel/habitacao/reparacoes/${j.id}`)
      .set(chefe)
      .send({ atribuida_a: 'Equipa de carpintaria' })
      .expect(200);
    expect(atr.body).toMatchObject({
      estado: 'atribuida',
      atribuida_a: 'Equipa de carpintaria',
    });
    const fim = await ctx
      .http()
      .patch(`/v1/painel/habitacao/reparacoes/${j.id}`)
      .set(chefe)
      .send({ estado: 'concluida' })
      .expect(200);
    expect(fim.body).toMatchObject({ estado: 'concluida', sms_enviado: true });
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms.some((s) => s.corpo.includes(codigoReparacao))).toBe(true);
    await ctx
      .http()
      .patch(`/v1/painel/habitacao/reparacoes/${j.id}`)
      .set(chefe)
      .send({})
      .expect(400);

    const f = await ctx
      .http()
      .get('/v1/painel/habitacao/fogos')
      .set(chefe)
      .expect(200);
    const meu = f.body.fogos.find((x: { codigo: string }) => x.codigo === fogo);
    expect(meu).toMatchObject({
      renda_cent: 15000,
      em_divida_cent: 3000,
      reparacoes_abertas: 1,
    });
    expect(
      f.body.revisoes.some(
        (v: { renda_estimada_cent: number }) => v.renda_estimada_cent === 8207,
      ),
    ).toBe(true);
    expect(
      f.body.fogos.some((x: { codigo: string }) => x.codigo === 'AZ-A-1E'),
    ).toBe(true);

    const aud = await linha(
      ctx.db,
      `SELECT 1 AS ok FROM audit_log WHERE objeto_id = $1 AND acao = 'mudar_estado_candidatura_habitacao'`,
      [minha.id],
    );
    expect(aud).toEqual({ ok: 1 });
  });

  it('permissões: quem atende não vê a habitação; o técnico vê', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .get('/v1/painel/habitacao/candidaturas')
      .set(atendimento)
      .expect(403);
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await ctx
      .http()
      .get('/v1/painel/habitacao/candidaturas')
      .set(tecnico)
      .expect(200);
  });
});
