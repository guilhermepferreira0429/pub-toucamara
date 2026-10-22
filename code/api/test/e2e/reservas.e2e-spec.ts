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

/** Daqui a n dias (AAAA-MM-DD). */
function daqui(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const TODOS = ['08:00-22:00'];
const HORARIO = {
  seg: TODOS,
  ter: TODOS,
  qua: TODOS,
  qui: TODOS,
  sex: TODOS,
  sab: TODOS,
  dom: TODOS,
};

/**
 * Reservas (V4 #4) pelo catálogo de serviços: disponibilidade, reservar
 * (pagamento de teste ou aprovação), bilhetes com lugares limitados,
 * cancelar, a página pública e o painel.
 */
describe('Reservas (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  // Nomes únicos: o agente escolhe o equipamento pelo que a pessoa diz.
  const marca = `zeta${randomInt(100_000, 999_999)}`;
  const dia = daqui(5);

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    const novo = (nome: string, preco: number, aprovacao: string) =>
      ctx
        .http()
        .post('/v1/painel/reservas/equipamentos')
        .set(chefe)
        .send({
          nome,
          tipo: 'pavilhao',
          morada: 'Rua do Teste',
          horario: HORARIO,
          antecedencia_horas: 0,
          duracao_max_horas: 3,
          preco_hora_cent: preco,
          aprovacao,
        })
        .expect(201);
    await novo(`Pavilhão ${marca} pago`, 1000, 'automatica');
    await novo(`Sala ${marca} aprovada`, 0, 'funcionario');
  });
  afterAll(() => ctx.fechar());

  const pedir = (
    chamada: Chamada | undefined,
    acao: string,
    dados: Record<string, string> = {},
  ) =>
    ferramenta(ctx, chamada, 'pedir_servico', {
      area: 'reservas',
      acao,
      dados: Object.entries(dados).map(([campo, valor]) => ({ campo, valor })),
    }).expect(200);

  const codigoDoSms = async (telefone: string) => {
    const sms = await smsPara(ctx, telefone, 'marcacao');
    const m = /\/reserva\/([A-Z0-9]{10})/.exec(
      sms.map((s) => s.corpo).join(' '),
    );
    return m?.[1];
  };

  it('outros_servicos lista as ações de reservas', async () => {
    const r = await ferramenta(ctx, undefined, 'outros_servicos', {
      area: 'reservas',
    }).expect(200);
    expect(r.body.acoes.map((a: { acao: string }) => a.acao)).toEqual(
      expect.arrayContaining([
        'ver_disponibilidade',
        'reservar',
        'ver_eventos',
        'comprar_bilhete',
        'minhas_reservas',
        'cancelar',
      ]),
    );
  });

  it('disponibilidade, reservar com pagamento de teste, sem sobreposição, página pública com QR depois de pagar', async () => {
    const v = await pedir(novaChamada(), 'ver_disponibilidade', {
      equipamento: `pavilhão ${marca} pago`,
      dia,
    });
    expect(v.body).toMatchObject({ encontrado: true });
    expect(v.body.livres[0].horas).toContain('10:00');

    const chamada = novaChamada('res');
    const dados = {
      equipamento: `pavilhão ${marca} pago`,
      dia,
      hora_inicio: '10h',
      duracao_horas: '1,5',
      finalidade: 'Jogo de futsal',
      nome: 'Rita Teste',
    };
    const ler = await pedir(chamada, 'reservar', dados);
    expect(ler.body).toMatchObject({
      confirmar: true,
      resumo: {
        das: '10:00',
        as: '12:00',
        valor: expect.stringContaining('20'),
      },
    });
    const r = await pedir(chamada, 'reservar', { ...dados, confirmado: 'sim' });
    expect(r.body).toMatchObject({
      feito: true,
      estado: 'por_pagar',
      pagamento: { modo_teste: true, valor_cent: 2000 },
      codigo: expect.stringMatching(/^[A-Z0-9]{10}$/),
    });
    expect(await codigoDoSms(chamada.telefone)).toBe(r.body.codigo);

    // A mesma hora já não está livre.
    const outra = await pedir(novaChamada(), 'reservar', {
      ...dados,
      hora_inicio: '11:00',
      duracao_horas: '1',
      confirmado: 'sim',
    });
    expect(outra.body).toMatchObject({ feito: false, motivo: 'ocupado' });
    const fora = await pedir(novaChamada(), 'reservar', {
      ...dados,
      hora_inicio: '23:00',
      confirmado: 'sim',
    });
    expect(fora.body).toMatchObject({
      feito: false,
      motivo: 'fora_do_horario',
    });

    const pub = await ctx
      .http()
      .get(`/v1/public/reservas/${r.body.codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      estado: 'por_pagar',
      qr: false,
      hora_inicio: '10:00',
      pagamento: { modo_teste: true },
    });
    expect(pub.body.nome).toBe('Rita');

    const lc = await linha(
      ctx.db,
      `SELECT lc.codigo FROM reservas r JOIN pagamentos pg ON pg.processo_id = r.processo_id
       JOIN links_curtos lc ON lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
       WHERE r.codigo = $1 LIMIT 1`,
      [r.body.codigo],
    );
    await ctx
      .http()
      .post(`/v1/public/pagamentos/${lc.codigo}/simular-pagamento`)
      .send({})
      .expect(200);
    const paga = await ctx
      .http()
      .get(`/v1/public/reservas/${r.body.codigo}`)
      .expect(200);
    expect(paga.body).toMatchObject({ estado: 'confirmada', qr: true });
    const sms = await smsPara(ctx, chamada.telefone, 'marcacao');
    expect(sms.map((s) => s.corpo).join(' ')).toContain('pagamento recebido');
  });

  it('equipamento com aprovação: fica por aprovar; o painel aprova ou recusa com SMS', async () => {
    const a = novaChamada('apr');
    const base = {
      equipamento: `sala ${marca}`,
      dia,
      duracao_horas: '1',
      finalidade: 'Reunião da associação',
      nome: 'Ana Teste',
      confirmado: 'sim',
    };
    const r1 = await pedir(a, 'reservar', { ...base, hora_inicio: '14:00' });
    expect(r1.body).toMatchObject({ feito: true, estado: 'por_aprovar' });
    const b = novaChamada('rec');
    const r2 = await pedir(b, 'reservar', { ...base, hora_inicio: '16:00' });

    const painel = await ctx
      .http()
      .get('/v1/painel/reservas')
      .set(chefe)
      .expect(200);
    const id1 = painel.body.reservas.find(
      (x: { codigo: string }) => x.codigo === r1.body.codigo,
    ).id;
    const id2 = painel.body.reservas.find(
      (x: { codigo: string }) => x.codigo === r2.body.codigo,
    ).id;
    expect(painel.body.contagens.por_aprovar).toBeGreaterThanOrEqual(2);

    const ok = await ctx
      .http()
      .post(`/v1/painel/reservas/${id1}/aprovar`)
      .set(chefe)
      .expect(200);
    expect(ok.body).toMatchObject({ estado: 'confirmada' });
    await ctx
      .http()
      .post(`/v1/painel/reservas/${id1}/aprovar`)
      .set(chefe)
      .expect(409);
    expect(
      (await smsPara(ctx, a.telefone, 'marcacao'))
        .map((s) => s.corpo)
        .join(' '),
    ).toContain('aprovada');

    await ctx
      .http()
      .post(`/v1/painel/reservas/${id2}/recusar`)
      .set(chefe)
      .send({ motivo: 'A sala está em obras.' })
      .expect(200);
    expect(
      (await smsPara(ctx, b.telefone, 'marcacao'))
        .map((s) => s.corpo)
        .join(' '),
    ).toContain('em obras');
    const pub = await ctx
      .http()
      .get(`/v1/public/reservas/${r2.body.codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      estado: 'recusada',
      motivo_recusa: 'A sala está em obras.',
      pode_cancelar: false,
    });
  });

  it('bilhetes: lugares limitados, máximo por pessoa, QR; minhas reservas e cancelar', async () => {
    const titulo = `Concerto ${marca}`;
    await ctx.db.query(
      `INSERT INTO reserva_sessoes (municipio_id, titulo, local, inicio, lotacao, preco_cent, max_por_pessoa)
       VALUES ($1, $2, 'Auditório de Teste', now() + interval '7 days', 3, 0, 2)`,
      [MUNICIPIO_ID, titulo],
    );
    const ev = await pedir(novaChamada(), 'ver_eventos', { evento: marca });
    expect(ev.body.eventos).toEqual([
      expect.objectContaining({
        nome: titulo,
        lugares_livres: 3,
        preco: 'gratuito',
      }),
    ]);

    const a = novaChamada('bil');
    const demais = await pedir(a, 'comprar_bilhete', {
      evento: marca,
      quantidade: '3',
      nome: 'Rui Teste',
      confirmado: 'sim',
    });
    expect(demais.body).toMatchObject({ feito: false, motivo: 'sem_lugares' });
    const r = await pedir(a, 'comprar_bilhete', {
      evento: marca,
      quantidade: '2',
      nome: 'Rui Teste',
      confirmado: 'sim',
    });
    expect(r.body).toMatchObject({
      feito: true,
      estado: 'confirmada',
      quantidade: 2,
    });
    const pub = await ctx
      .http()
      .get(`/v1/public/reservas/${r.body.codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      tipo: 'bilhete',
      qr: true,
      quantidade: 2,
    });

    const b = novaChamada('bil');
    const sobra = await pedir(b, 'comprar_bilhete', {
      evento: marca,
      quantidade: '2',
      nome: 'Eva Teste',
      confirmado: 'sim',
    });
    expect(sobra.body).toMatchObject({ feito: false, dizer: 'Só há 1 lugar.' });

    const minhas = await pedir(a, 'minhas_reservas');
    expect(
      minhas.body.reservas.map((x: { codigo: string }) => x.codigo),
    ).toContain(r.body.codigo);

    // Cancelar pelo agente: confirma primeiro; o lugar volta a ficar livre.
    const ler = await pedir(a, 'cancelar', { codigo: r.body.codigo });
    expect(ler.body).toMatchObject({ confirmar: true });
    const c = await pedir(a, 'cancelar', {
      codigo: r.body.codigo,
      confirmado: 'sim',
    });
    expect(c.body).toMatchObject({ feito: true });
    const agora = await pedir(b, 'comprar_bilhete', {
      evento: marca,
      quantidade: '2',
      nome: 'Eva Teste',
      confirmado: 'sim',
    });
    expect(agora.body).toMatchObject({ feito: true });

    // Cancelar na página pública.
    const p = await ctx
      .http()
      .post(`/v1/public/reservas/${agora.body.codigo}/cancelar`)
      .expect(200);
    expect(p.body).toMatchObject({ estado: 'cancelada', pode_cancelar: false });
    await ctx
      .http()
      .post(`/v1/public/reservas/${agora.body.codigo}/cancelar`)
      .expect(409);
  });

  it('sem identificação não reserva; código inválido dá 404', async () => {
    const r = await pedir(undefined, 'reservar', {
      equipamento: `pavilhão ${marca} pago`,
      dia,
      hora_inicio: '18:00',
      finalidade: 'Treino',
      nome: 'Sem Nome',
      confirmado: 'sim',
    });
    expect(r.body).toMatchObject({ motivo: 'precisa_identificacao' });
    await ctx.http().get('/v1/public/reservas/ZZZZZZZZZZ').expect(404);
    await ctx.http().get('/v1/public/reservas/curto').expect(404);
  });

  it('demonstração e permissões: atendimento vê e aprova, não gere equipamentos; vereador não entra', async () => {
    const d = await ctx
      .http()
      .post('/v1/painel/reservas/demonstracao')
      .set(chefe)
      .expect(200);
    expect(d.body).toMatchObject({ demonstracao: true });
    const v = await pedir(novaChamada(), 'ver_disponibilidade', {
      equipamento: 'piscina',
    });
    expect(v.body.equipamento).toMatchObject({
      nome: 'Piscina Municipal',
      entrada: expect.stringContaining('2,50'),
    });

    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    await ctx.http().get('/v1/painel/reservas').set(atendimento).expect(200);
    await ctx.http().get('/v1/painel/reservas').set(vereador).expect(403);
    await ctx
      .http()
      .post('/v1/painel/reservas/equipamentos')
      .set(atendimento)
      .send({ nome: 'Não pode', tipo: 'sala', morada: 'Rua', horario: {} })
      .expect(403);
  });
});
