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

/** Matrícula nova (AA-00-AA) e auto novo, para não depender de outros testes. */
function matricula(): string {
  const l = () => String.fromCharCode(65 + randomInt(26));
  return `${l()}${l()}-${String(randomInt(100)).padStart(2, '0')}-${l()}${l()}`;
}

/**
 * Estacionamento (V4 #5) pelo catálogo de serviços: consultar, pagar
 * (modo de teste) e defender uma multa, parques, lugar reservado e o
 * painel que decide (com SMS).
 */
describe('Estacionamento (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    await ctx
      .http()
      .post('/v1/painel/estacionamento/demonstracao')
      .set(chefe)
      .expect(200);
  });
  afterAll(() => ctx.fechar());

  const pedir = (
    chamada: Chamada | undefined,
    acao: string,
    dados: Record<string, string> = {},
  ) =>
    ferramenta(ctx, chamada, 'pedir_servico', {
      area: 'estacionamento',
      acao,
      dados: Object.entries(dados).map(([campo, valor]) => ({ campo, valor })),
    }).expect(200);

  async function novaMulta(mat = matricula()) {
    const auto = `E2E-${randomInt(1_000_000)}`;
    await ctx.db.query(
      `INSERT INTO estacionamento_multas (municipio_id, numero_auto, matricula, infracao, local,
         verificada_em, valor_cent, prazo_pagamento, prazo_defesa)
       VALUES ($1, $2, $3, 'Estacionamento em zona tarifada sem título', 'Rua de Teste',
         now() - interval '2 days', 3000, current_date + 10, current_date + 10)`,
      [MUNICIPIO_ID, auto, mat],
    );
    return { auto, mat };
  }

  it('outros_servicos lista as ações da área', async () => {
    const r = await ferramenta(ctx, undefined, 'outros_servicos', {
      area: 'estacionamento',
    }).expect(200);
    expect(r.body.acoes.map((a: { acao: string }) => a.acao)).toEqual(
      expect.arrayContaining([
        'consultar_multa',
        'pagar_multa',
        'apresentar_defesa',
        'onde_estacionar',
        'lugar_deficiencia',
        'distico_residente',
      ]),
    );
    const todas = await ferramenta(
      ctx,
      undefined,
      'outros_servicos',
      {},
    ).expect(200);
    expect(todas.body.areas.map((a: { area: string }) => a.area)).toContain(
      'estacionamento',
    );
  });

  it('consultar pela matrícula (qualquer escrita) e pagar: confirma, MB WAY de teste, fica paga', async () => {
    const { auto, mat } = await novaMulta();
    const chamada = novaChamada('mul');
    const c = await pedir(chamada, 'consultar_multa', {
      matricula: mat.replace(/-/g, ' ').toLowerCase(),
    });
    expect(c.body).toMatchObject({
      encontrado: true,
      multas: [
        {
          numero_auto: auto,
          matricula: mat,
          pode_pagar: true,
          pode_defender: true,
        },
      ],
      prazos_de_demonstracao: true,
    });
    expect(c.body.dizer).toContain(auto);

    const antes = await pedir(chamada, 'pagar_multa', { numero_auto: auto });
    expect(antes.body).toMatchObject({ feito: false, confirmar: true });
    const p = await pedir(chamada, 'pagar_multa', {
      numero_auto: auto,
      confirmado: 'sim',
    });
    expect(p.body).toMatchObject({
      feito: true,
      pagamento: { modo_teste: true, metodo: 'mbway', valor_cent: 3000 },
    });

    const lc = await linha(
      ctx.db,
      `SELECT lc.codigo FROM estacionamento_multas m
       JOIN pagamentos pg ON pg.processo_id = m.processo_id
       JOIN links_curtos lc ON lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
       WHERE m.numero_auto = $1 ORDER BY lc.expira_em DESC LIMIT 1`,
      [auto],
    );
    await ctx
      .http()
      .post(`/v1/public/pagamentos/${lc.codigo}/simular-pagamento`)
      .send({})
      .expect(200);

    const painel = await ctx
      .http()
      .get('/v1/painel/estacionamento')
      .set(chefe)
      .expect(200);
    const m = painel.body.multas.find(
      (x: { numero_auto: string }) => x.numero_auto === auto,
    );
    expect(m).toMatchObject({
      estado: 'paga',
      processo_id: expect.any(String),
    });

    // Depois de paga, já não há nada a pagar.
    const outra = await pedir(chamada, 'pagar_multa', {
      numero_auto: auto,
      confirmado: 'sim',
    });
    expect(outra.body).toMatchObject({ feito: false, motivo: 'nada_a_fazer' });
  });

  it('auto ou matrícula desconhecidos e matrícula mal dita', async () => {
    const a = await pedir(novaChamada(), 'consultar_multa', {
      numero_auto: 'NAO-EXISTE-1',
    });
    expect(a.body).toMatchObject({ encontrado: false });
    const b = await pedir(novaChamada(), 'consultar_multa', {
      matricula: 'XYZ123',
    });
    expect(b.body).toMatchObject({ motivo: 'dados_invalidos' });
    const c = await pedir(novaChamada(), 'consultar_multa', {});
    expect(c.body).toMatchObject({ motivo: 'faltam_dados' });
  });

  it('defesa: precisa de identificação; regista, suspende o pagamento; o painel recusa e avisa por SMS', async () => {
    const { auto } = await novaMulta();
    const motivo =
      'Tinha o talão no tablier e ainda estava dentro da hora paga.';
    const sem = await pedir(undefined, 'apresentar_defesa', {
      numero_auto: auto,
      motivo,
      nome: 'Rita Teste',
      confirmado: 'sim',
    });
    expect(sem.body).toMatchObject({ motivo: 'precisa_identificacao' });

    const chamada = novaChamada('def');
    const ler = await pedir(chamada, 'apresentar_defesa', {
      numero_auto: auto,
      motivo,
      nome: 'Rita Teste',
    });
    expect(ler.body).toMatchObject({ confirmar: true });
    const r = await pedir(chamada, 'apresentar_defesa', {
      numero_auto: auto,
      motivo,
      nome: 'Rita Teste',
      confirmado: 'sim',
    });
    expect(r.body).toMatchObject({
      feito: true,
      defesa_id: expect.any(String),
    });
    expect(
      (await smsPara(ctx, chamada.telefone, 'processo'))[0].corpo,
    ).toContain('defesa');

    // Em defesa: nem se paga nem se defende outra vez.
    const pagar = await pedir(chamada, 'pagar_multa', {
      numero_auto: auto,
      confirmado: 'sim',
    });
    expect(pagar.body).toMatchObject({ feito: false });

    const painel = await ctx
      .http()
      .get('/v1/painel/estacionamento')
      .set(chefe)
      .expect(200);
    const d = painel.body.defesas.find(
      (x: { id: string }) => x.id === r.body.defesa_id,
    );
    expect(d).toMatchObject({
      estado: 'por_analisar',
      texto: motivo,
      numero_auto: auto,
    });

    await ctx
      .http()
      .post(`/v1/painel/estacionamento/defesas/${d.id}/decidir`)
      .set(chefe)
      .send({ decisao: 'recusada', nota: 'O talão era de outro dia.' })
      .expect(200);
    await ctx
      .http()
      .post(`/v1/painel/estacionamento/defesas/${d.id}/decidir`)
      .set(chefe)
      .send({ decisao: 'aceite', nota: 'Outra vez não.' })
      .expect(404);
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms.map((s) => s.corpo).join(' ')).toContain('não foi aceite');
    const m = await linha(
      ctx.db,
      'SELECT estado FROM estacionamento_multas WHERE numero_auto = $1',
      [auto],
    );
    expect(m.estado).toBe('por_pagar');
    // Recusada: não há segunda defesa.
    const outra = await pedir(chamada, 'apresentar_defesa', {
      numero_auto: auto,
      motivo,
      nome: 'Rita Teste',
      confirmado: 'sim',
    });
    expect(outra.body).toMatchObject({ feito: false, motivo: 'ja_defendida' });
  });

  it('defesa aceite anula a multa', async () => {
    const { auto } = await novaMulta();
    const chamada = novaChamada('def');
    const r = await pedir(chamada, 'apresentar_defesa', {
      numero_auto: auto,
      motivo: 'O carro estava avariado e chamei o reboque.',
      nome: 'Rui Teste',
      confirmado: 'sim',
    });
    await ctx
      .http()
      .post(`/v1/painel/estacionamento/defesas/${r.body.defesa_id}/decidir`)
      .set(chefe)
      .send({ decisao: 'aceite', nota: 'Confirmámos a avaria.' })
      .expect(200);
    const m = await linha(
      ctx.db,
      'SELECT estado FROM estacionamento_multas WHERE numero_auto = $1',
      [auto],
    );
    expect(m.estado).toBe('anulada');
    const audit = await linha(
      ctx.db,
      `SELECT acao FROM audit_log WHERE objeto_tipo = 'defesa_multa' AND objeto_id = $1`,
      [r.body.defesa_id],
    );
    expect(audit.acao).toBe('aceitar_defesa_multa');
  });

  it('onde estacionar: parques perto, horário, tarifa e custo (demonstração)', async () => {
    const r = await pedir(novaChamada(), 'onde_estacionar', {
      onde: 'Largo do Toural',
      horas: '2',
    });
    expect(r.body).toMatchObject({
      encontrado: true,
      valores_de_demonstracao: true,
    });
    const nomes = r.body.parques.map((p: { nome: string }) => p.nome);
    expect(nomes).toContain('Parque de São Francisco');
    expect(r.body.parques[0].custo).toEqual(expect.stringContaining('€'));
    const longe = await pedir(novaChamada(), 'onde_estacionar', {
      onde: 'Avenida da Liberdade em Lisboa',
    });
    expect(longe.body).toMatchObject({ nao_encontrei_essa_zona: true });
  });

  it('lugar reservado para pessoa com deficiência: registo, SMS e decisão no painel', async () => {
    const chamada = novaChamada('lrd');
    const dados = {
      morada: 'Rua do Teste 1, Guimarães',
      tem_cartao: 'sim',
      matricula: '12-ab-34',
      nome: 'Ana Teste',
    };
    expect(
      (await pedir(chamada, 'lugar_deficiencia', dados)).body,
    ).toMatchObject({ confirmar: true });
    const r = await pedir(chamada, 'lugar_deficiencia', {
      ...dados,
      confirmado: 'sim',
    });
    expect(r.body).toMatchObject({
      feito: true,
      numero: expect.stringMatching(/^LRD \d+\/\d{4}$/),
      regras_de_demonstracao: true,
    });
    const painel = await ctx
      .http()
      .get('/v1/painel/estacionamento')
      .set(chefe)
      .expect(200);
    const l = painel.body.lugares.find(
      (x: { numero: string }) => x.numero === r.body.numero,
    );
    expect(l).toMatchObject({
      estado: 'recebido',
      matricula: '12-AB-34',
      tem_cartao: true,
    });
    await ctx
      .http()
      .post(`/v1/painel/estacionamento/lugares/${l.id}/decidir`)
      .set(chefe)
      .send({
        decisao: 'aprovado',
        nota: 'O lugar fica pintado na próxima semana.',
      })
      .expect(200);
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms.map((s) => s.corpo).join(' ')).toContain('foi aprovado');
  });

  it('dístico de residente: manda para a licença', async () => {
    const r = await pedir(novaChamada(), 'distico_residente');
    expect(r.body).toMatchObject({ usar_licenca: 'distico_residente' });
    expect(r.body.instrucao).toContain('pedir_licenca');
  });

  it('permissões: atendimento vê e decide; vereador não; demonstração só a chefia', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    await ctx
      .http()
      .get('/v1/painel/estacionamento')
      .set(atendimento)
      .expect(200);
    await ctx.http().get('/v1/painel/estacionamento').set(vereador).expect(403);
    await ctx
      .http()
      .post('/v1/painel/estacionamento/demonstracao')
      .set(atendimento)
      .expect(403);
  });
});
