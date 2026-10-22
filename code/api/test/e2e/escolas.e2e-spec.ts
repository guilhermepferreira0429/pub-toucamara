/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
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

type Dados = Record<string, string>;

function pedir(
  ctx: Contexto,
  c: Chamada | undefined,
  acao: string,
  dados: Dados = {},
) {
  return ferramenta(ctx, c, 'pedir_servico', {
    area: 'escolas',
    acao,
    dados: Object.entries(dados).map(([campo, valor]) => ({ campo, valor })),
  }).expect(200);
}

function diaMais(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

describe('Escolas (V4 #3): catálogo de serviços + painel', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let chamada: Chamada;
  // Nome único por execução (o mesmo encarregado só tem um aluno com o nome).
  const tag = String(randomInt(1000, 9999));
  const aluno = `Tomás Teste ${tag}`;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    await ctx
      .http()
      .post('/v1/painel/escolas/demonstracao')
      .set(chefe)
      .expect(201);
    chamada = novaChamada('escolas');
  });

  afterAll(() => ctx.fechar());

  it('outros_servicos mostra a área escolas e os campos de cada ação', async () => {
    const todas = await ferramenta(ctx, chamada, 'outros_servicos', {}).expect(
      200,
    );
    const areas = todas.body.areas.map((a: { area: string }) => a.area);
    expect(areas).toContain('escolas');
    const r = await ferramenta(ctx, chamada, 'outros_servicos', {
      area: 'escolas',
    }).expect(200);
    const acoes = r.body.acoes.map((a: { acao: string }) => a.acao);
    expect(acoes).toEqual(
      expect.arrayContaining([
        'inscrever_cantina',
        'marcar_refeicao',
        'situacao_aluno',
        'pedir_transporte',
        'atividades',
        'inscrever_atividade',
        'pre_inscricao',
      ]),
    );
    const cantina = r.body.acoes.find(
      (a: { acao: string }) => a.acao === 'inscrever_cantina',
    );
    expect(cantina.altera).toBe(true);
    expect(cantina.campos.map((c: { campo: string }) => c.campo)).toContain(
      'alergias',
    );
  });

  it('dados de menores: sem o NIF do encarregado não mexe', async () => {
    const r = await pedir(ctx, chamada, 'inscrever_cantina', {
      nome_aluno: aluno,
      escola: 'Azurém',
      ano: '3',
    });
    expect(r.body).toMatchObject({
      feito: false,
      motivo: 'precisa_identificacao',
    });
    expect(r.body.instrucao).toContain('identificar_municipe');
  });

  it('inscreve na cantina com o escalão do abono; as alergias não voltam ao agente', async () => {
    await ferramenta(ctx, chamada, 'identificar_municipe', {
      nif: novoNif(),
      nome: 'Sandra Teste',
    }).expect(200);

    const falta = await pedir(ctx, chamada, 'inscrever_cantina', {
      nome_aluno: aluno,
      ano: '3',
    });
    expect(falta.body.motivo).toBe('faltam_dados');
    expect(falta.body.em_falta[0].campo).toBe('escola');

    const r = await pedir(ctx, chamada, 'inscrever_cantina', {
      nome_aluno: aluno,
      escola: 'escola de Azurém',
      ano: '3',
      escalao_abono: '2',
      alergias: 'Amendoim e kiwi',
    });
    expect(r.body).toMatchObject({
      feito: true,
      escola: 'EB de Azurém',
      escalao: 'escalão B',
      preco_refeicao: '0,73 €',
      saude_registada: true,
      valores_de_demonstracao: true,
    });
    expect(r.body.codigo).toMatch(/^ESC-/);
    expect(JSON.stringify(r.body).toLowerCase()).not.toContain('amendoim');

    const bd = await linha(
      ctx.db,
      `SELECT a.alergias, a.escalao FROM escolas_alunos a WHERE a.nome = $1`,
      [aluno],
    );
    expect(bd).toEqual({ alergias: 'Amendoim e kiwi', escalao: 'B' });

    const outra = await pedir(ctx, chamada, 'inscrever_cantina', {
      nome_aluno: aluno,
      escola: 'Azurém',
      ano: '3',
    });
    expect(outra.body.ja_estava_inscrito).toBe(true);
  });

  it('desmarca e volta a marcar uma refeição; a cozinha vê a contagem e as dietas', async () => {
    // Um dia de aulas daqui a 2+ dias (sem fins de semana nem feriados).
    let dia = '';
    let r;
    for (let n = 2; n < 12; n++) {
      dia = diaMais(n);
      r = await pedir(ctx, chamada, 'marcar_refeicao', {
        nome_aluno: aluno.split(' ')[0],
        dia,
        marcar: 'não',
      });
      if (r.body.motivo !== 'sem_aulas') break;
    }
    expect(r!.body).toMatchObject({ feito: true, marcada: false });

    const semEle = await ctx
      .http()
      .get(`/v1/painel/escolas/refeicoes?dia=${dia}`)
      .set(chefe)
      .expect(200);
    expect(semEle.body.dia_de_aulas).toBe(true);
    const azurem = (b: any) =>
      b.escolas.find((e: { escola: string }) => e.escola === 'EB de Azurém');
    const dietasAntes = azurem(semEle.body)?.dietas ?? [];
    expect(dietasAntes.map((d: { aluno: string }) => d.aluno)).not.toContain(
      aluno,
    );

    await pedir(ctx, chamada, 'marcar_refeicao', {
      nome_aluno: aluno,
      dia,
      marcar: 'sim',
    });
    const comEle = await ctx
      .http()
      .get(`/v1/painel/escolas/refeicoes?dia=${dia}`)
      .set(chefe)
      .expect(200);
    expect(azurem(comEle.body).total).toBe(
      (azurem(semEle.body)?.total ?? 0) + 1,
    );
    expect(azurem(comEle.body).dietas).toContainEqual({
      aluno,
      alergias: 'Amendoim e kiwi',
    });

    const passado = await pedir(ctx, chamada, 'marcar_refeicao', {
      nome_aluno: aluno,
      dia: diaMais(-1),
      marcar: 'não',
    });
    expect(passado.body).toMatchObject({ feito: false, motivo: 'dia_passado' });
  });

  it('situação do aluno: conta do mês, escalão, sem dados de saúde', async () => {
    const r = await pedir(ctx, chamada, 'situacao_aluno', {
      nome_aluno: aluno,
    });
    expect(r.body).toMatchObject({
      encontrado: true,
      escola: 'EB de Azurém',
      escalao: 'escalão B',
      valores_de_demonstracao: true,
    });
    expect(r.body.cantina.preco).toBe('0,73 €');
    expect(JSON.stringify(r.body).toLowerCase()).not.toContain('amendoim');

    const ninguem = await pedir(ctx, chamada, 'situacao_aluno', {
      nome_aluno: 'Zacarias',
    });
    expect(ninguem.body.motivo).toBe('aluno_nao_encontrado');
  });

  it('transporte: pede, não duplica, e o painel aprova com SMS', async () => {
    const r = await pedir(ctx, chamada, 'pedir_transporte', {
      nome_aluno: aluno,
      morada: 'Rua do Monte, 12, Azurém',
      distancia_km: '4,5',
    });
    expect(r.body).toMatchObject({ feito: true, proposta: 'cumpre' });
    const codigo = r.body.codigo;
    const outra = await pedir(ctx, chamada, 'pedir_transporte', {
      nome_aluno: aluno,
      morada: 'Rua do Monte, 12, Azurém',
    });
    expect(outra.body.motivo).toBe('ja_pedido');

    const lista = await ctx
      .http()
      .get('/v1/painel/escolas/transporte?estado=pendente')
      .set(chefe)
      .expect(200);
    const p = lista.body.pedidos.find(
      (x: { codigo: string }) => x.codigo === codigo,
    );
    expect(p).toMatchObject({
      aluno,
      escola: 'EB de Azurém',
      proposta: 'cumpre',
      distancia_km: 4.5,
    });

    await ctx
      .http()
      .post(`/v1/painel/escolas/transporte/${p.id}/decidir`)
      .set(chefe)
      .send({ decisao: 'recusar' })
      .expect(400);
    const d = await ctx
      .http()
      .post(`/v1/painel/escolas/transporte/${p.id}/decidir`)
      .set(chefe)
      .send({ decisao: 'aprovar' })
      .expect(200);
    expect(d.body).toMatchObject({ estado: 'aprovado', sms_enviado: true });
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(
      sms.some((s) => s.corpo.includes('aprovado') && s.corpo.includes(codigo)),
    ).toBe(true);
    await ctx
      .http()
      .post(`/v1/painel/escolas/transporte/${p.id}/decidir`)
      .set(chefe)
      .send({ decisao: 'recusar', motivo: 'x' })
      .expect(409);

    const auditoria = await linha(
      ctx.db,
      `SELECT acao FROM audit_log WHERE objeto_id = $1 AND acao = 'aprovar_transporte_escolar'`,
      [p.id],
    );
    expect(auditoria).toBeDefined();

    const sit = await pedir(ctx, chamada, 'situacao_aluno', {
      nome_aluno: aluno,
    });
    expect(sit.body.transporte.estado).toBe('aprovado');
  });

  it('atividades: oferta sem identificação; inscrição só para a escola certa', async () => {
    const outra = novaChamada('escolas-anon');
    const of = await pedir(ctx, outra, 'atividades', { tipo: 'aec' });
    expect(of.body.encontrado).toBe(true);
    expect(
      of.body.atividades.map((a: { codigo: string }) => a.codigo),
    ).toContain('AEC-MUSICA');

    const r = await pedir(ctx, chamada, 'inscrever_atividade', {
      nome_aluno: aluno,
      atividade: 'AEC-MUSICA',
    });
    expect(r.body).toMatchObject({ feito: true, atividade: 'Música' });
    const robotica = await pedir(ctx, chamada, 'inscrever_atividade', {
      nome_aluno: aluno,
      atividade: 'AEC-ROBOTICA',
    });
    expect(robotica.body.motivo).toBe('outra_escola');
  });

  it('pré-inscrição no pré-escolar: regista e diz que quem decide é o agrupamento', async () => {
    const ano = new Date().getUTCFullYear() - 4;
    const r = await pedir(ctx, chamada, 'pre_inscricao', {
      nome_crianca: `Inês Teste ${tag}`,
      data_nascimento: `${ano}-05-02`,
      escolas_preferidas: 'Creixomil, Azurém',
    });
    expect(r.body).toMatchObject({
      feito: true,
      quem_decide: 'o agrupamento de escolas',
      escolas_preferidas: ['Jardim de Infância de Creixomil', 'EB de Azurém'],
    });
    expect(r.body.dizer).toContain('agrupamento');

    const bebe = await pedir(ctx, chamada, 'pre_inscricao', {
      nome_crianca: 'Bebé Teste',
      data_nascimento: `${ano + 3}-01-01`,
      escolas_preferidas: 'Creixomil',
    });
    expect(bebe.body.motivo).toBe('idade_fora_do_pre_escolar');
  });

  it('painel: escolas, alunos com as alergias e as inscrições', async () => {
    const p = await ctx.http().get('/v1/painel/escolas').set(chefe).expect(200);
    expect(p.body.regras).toMatchObject({
      demonstracao: true,
      distancia_minima_km: 3,
    });
    expect(p.body.escolas.map((e: { nome: string }) => e.nome)).toContain(
      'EB de Azurém',
    );

    const a = await ctx
      .http()
      .get('/v1/painel/escolas/alunos')
      .set(chefe)
      .expect(200);
    const t = a.body.alunos.find((x: { nome: string }) => x.nome === aluno);
    expect(t).toMatchObject({
      alergias: 'Amendoim e kiwi',
      escalao: 'B',
      transporte: 'aprovado',
    });
    expect(
      t.inscricoes.map((i: { atividade: string }) => i.atividade),
    ).toContain('Música');
    const ines = a.body.alunos.find(
      (x: { nome: string }) => x.nome === `Inês Teste ${tag}`,
    );
    expect(ines.inscricoes[0]).toMatchObject({
      tipo: 'pre_escolar',
      estado: 'pendente',
    });
  });

  it('permissões: o vereador não entra; quem atende entra', async () => {
    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    await ctx.http().get('/v1/painel/escolas').set(vereador).expect(403);
    await ctx.http().get('/v1/painel/escolas/alunos').set(vereador).expect(403);
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .get('/v1/painel/escolas/transporte')
      .set(atendimento)
      .expect(200);
    expect(MUNICIPIO_ID).toBeDefined();
  });
});
