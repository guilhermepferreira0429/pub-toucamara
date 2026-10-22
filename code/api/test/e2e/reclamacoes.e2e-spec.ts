/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { hojeLisboa, somarDiasUteis } from '../../src/common/dias-uteis';
import { ReclamacoesService } from '../../src/modules/reclamacoes/reclamacoes.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
  novoTelefone,
  smsPara,
} from './app';

const SERVICO_ID = '00000000-0000-0000-0000-0000000000a1';

/** Dia `n` dias de calendário antes de hoje. */
function diasAtras(n: number): string {
  const d = new Date(`${hojeLisboa()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Livro de reclamações: o agente regista a reclamação formal (lê-a de
 * volta, diz o número e a data-limite, SMS com o link), o painel atribui,
 * responde (SMS) e encerra, a página pública mostra estado e resposta e o
 * trabalho diário avisa do que está a terminar ou em atraso.
 */
describe('Livro de reclamações (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let feriados: Set<string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    feriados = new Set(
      (
        await linhas<{ dia: string }>(
          ctx.db,
          `SELECT to_char(data, 'YYYY-MM-DD') AS dia FROM feriados
           WHERE municipio_id IS NULL OR municipio_id = $1`,
          [MUNICIPIO_ID],
        )
      ).map((f) => f.dia),
    );
  });
  afterAll(() => ctx.fechar());

  const queixa = {
    nome: 'Ana Reclamante',
    servico_visado: 'balcão de urbanismo',
    descricao:
      'Na segunda de manhã esperei duas horas no balcão e ninguém me atendeu.',
    pedido: 'Quero uma explicação e que isto não se repita',
  };

  it('registar_reclamacao: sem número pede identificação; primeiro lê de volta; depois regista, diz o prazo e manda SMS', async () => {
    const sem = await ferramenta(
      ctx,
      { conversa: novaChamada('rec').conversa, telefone: '' },
      'registar_reclamacao',
      queixa,
    ).expect(200);
    expect(sem.body).toMatchObject({
      registada: false,
      motivo: 'precisa_identificacao',
    });

    const chamada = novaChamada('rec');
    const ler = await ferramenta(
      ctx,
      chamada,
      'registar_reclamacao',
      queixa,
    ).expect(200);
    expect(ler.body).toMatchObject({
      registada: false,
      motivo: 'falta_confirmar',
      ler_a_pessoa: expect.stringContaining('Ana Reclamante'),
    });
    expect(ler.body.ler_a_pessoa).toContain('balcão de urbanismo');
    expect(await smsPara(ctx, chamada.telefone, 'reclamacao')).toHaveLength(0);

    const r = await ferramenta(ctx, chamada, 'registar_reclamacao', {
      ...queixa,
      confirmado: true,
    }).expect(200);
    const esperado = somarDiasUteis(hojeLisboa(), 15, feriados);
    expect(r.body).toMatchObject({
      registada: true,
      numero: expect.stringMatching(/^REC \d+\/\d{4}$/),
      responder_ate: esperado,
      prazo_dias_uteis: 15,
      prazo_de_demonstracao: true,
      dizer: expect.stringContaining('tem de lhe responder até'),
      link: expect.stringMatching(/\/reclamacao\/[A-Z0-9]{10}$/),
    });

    const sms = await smsPara(ctx, chamada.telefone, 'reclamacao');
    expect(sms).toHaveLength(1);
    expect(sms[0].corpo).toContain(r.body.numero);
    expect(sms[0].corpo).toContain('/reclamacao/');

    const bd = await linha(
      ctx.db,
      `SELECT canal, estado, to_char(responder_ate, 'YYYY-MM-DD') AS ate, conversa_id
       FROM reclamacoes WHERE numero = $1 AND municipio_id = $2`,
      [r.body.numero, MUNICIPIO_ID],
    );
    expect(bd).toMatchObject({
      canal: 'telefone',
      estado: 'recebida',
      ate: esperado,
    });
    expect(bd.conversa_id).toBeTruthy();
    const auditoria = await linha(
      ctx.db,
      `SELECT ator_tipo FROM audit_log WHERE acao = 'registar_reclamacao' ORDER BY em DESC LIMIT 1`,
    );
    expect(auditoria?.ator_tipo).toBe('agente');
  });

  it('painel: lista com o prazo, atribui, rascunho sem IA, responde por SMS e encerra; página pública com a resposta', async () => {
    const chamada = novaChamada('rec');
    const r = await ferramenta(ctx, chamada, 'registar_reclamacao', {
      ...queixa,
      confirmado: true,
    }).expect(200);
    const codigo = /([A-Z0-9]{10})$/.exec(r.body.link)![1];

    const lista = await ctx
      .http()
      .get('/v1/painel/reclamacoes?estado=abertas')
      .set(chefe)
      .expect(200);
    const item = lista.body.reclamacoes.find(
      (x: any) => x.numero === r.body.numero,
    );
    expect(item).toMatchObject({
      estado: 'recebida',
      canal: 'telefone',
      prazo: { situacao: 'no_prazo', dias_uteis_restantes: 15 },
      prazo_de_demonstracao: true,
    });
    expect(lista.body.indicadores).toMatchObject({
      total: expect.any(Number),
      abertas: expect.any(Number),
    });
    expect(lista.body.config).toMatchObject({
      prazo_dias_uteis: 15,
      demonstracao: true,
    });

    const atribuida = await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${item.id}/atribuir`)
      .set(chefe)
      .send({ servico_id: SERVICO_ID })
      .expect(200);
    expect(atribuida.body).toMatchObject({
      estado: 'em_analise',
      servico: 'Obras particulares',
    });

    const rascunho = await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${item.id}/rascunho`)
      .set(chefe)
      .send({ notas: 'Faltou um funcionário nesse dia.' })
      .expect(200);
    expect(rascunho.body).toMatchObject({ origem: 'modelo' }); // sem IA nos testes
    expect(rascunho.body.texto).toContain(r.body.numero);

    // Anexos: sem S3 nos testes, 503 (nunca se finge que guardou).
    const anexo = await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${item.id}/anexos`)
      .set(chefe)
      .send({ nome: 'folha.pdf', mime: 'application/pdf' })
      .expect(503);
    expect(anexo.body.erro.codigo).toBe('armazenamento_indisponivel');

    // Com marcadores por completar não se envia.
    await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${item.id}/responder`)
      .set(chefe)
      .send({ texto: rascunho.body.texto })
      .expect(400);

    const resposta =
      'Lamentamos a espera. Nesse dia faltou um funcionário; reforçámos o balcão às segundas de manhã.';
    const respondida = await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${item.id}/responder`)
      .set(chefe)
      .send({ texto: resposta })
      .expect(200);
    expect(respondida.body).toMatchObject({
      estado: 'respondida',
      resposta,
      prazo: { situacao: 'respondida_no_prazo' },
    });
    const sms = await smsPara(ctx, chamada.telefone, 'reclamacao');
    expect(sms).toHaveLength(2);
    expect(sms[1].corpo).toContain('já há resposta');
    expect(sms[1].corpo).toContain(`/reclamacao/${codigo}`);

    await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${item.id}/responder`)
      .set(chefe)
      .send({ texto: resposta })
      .expect(409);

    const pub = await ctx
      .http()
      .get(`/v1/public/reclamacoes/${codigo.toLowerCase()}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      numero: r.body.numero,
      estado: 'respondida',
      resposta,
      nome: 'Ana R.',
      servico: 'Obras particulares',
      prazo_de_demonstracao: true,
      fonte: expect.stringContaining('DL 135/99'),
    });
    expect(pub.body.telefone).toBeUndefined();

    const encerrada = await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${item.id}/encerrar`)
      .set(chefe)
      .send({})
      .expect(200);
    expect(encerrada.body.estado).toBe('encerrada');
    expect(encerrada.body.eventos.map((e: any) => e.tipo)).toEqual([
      'recebida',
      'atribuida',
      'respondida',
      'encerrada',
    ]);

    await ctx.http().get('/v1/public/reclamacoes/NAOEXISTE1').expect(404);
    await ctx.http().get('/v1/public/reclamacoes/curto').expect(404);
  });

  it('painel: Livro Amarelo em papel com data antiga fica em atraso; encerrar sem resposta pede nota; o aviso diário vai ao responsável uma vez', async () => {
    const tecnico = await criarUtilizador(ctx, 'tecnico');
    const telefone = novoTelefone();
    const nova = await ctx
      .http()
      .post('/v1/painel/reclamacoes')
      .set(chefe)
      .send({
        canal: 'livro_amarelo',
        nome: 'Rui Papel',
        telefone,
        descricao: 'Folha do Livro Amarelo: a fatura da água veio em dobro.',
        recebida_em: diasAtras(40),
      })
      .expect(201);
    expect(nova.body).toMatchObject({
      canal: 'livro_amarelo',
      resposta_por: 'sms',
      responder_ate: somarDiasUteis(diasAtras(40), 15, feriados),
      prazo: { situacao: 'em_atraso' },
    });
    expect(await smsPara(ctx, telefone, 'reclamacao')).toHaveLength(1);

    await ctx
      .http()
      .post('/v1/painel/reclamacoes')
      .set(chefe)
      .send({ canal: 'balcao', nome: 'X', descricao: 'curta' })
      .expect(400);

    await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${nova.body.id}/atribuir`)
      .set(chefe)
      .send({ utilizador_id: tecnico })
      .expect(200);

    const servico = ctx.app.get(ReclamacoesService);
    const r1 = await servico.avisar();
    expect(r1.reclamacoes).toBeGreaterThanOrEqual(1);
    const email = await linha(
      ctx.db,
      `SELECT ms.corpo, ms.estado::text AS estado FROM mensagens_saida ms
       JOIN utilizadores u ON u.email = ms.destino
       WHERE u.id = $1 AND ms.canal = 'email' AND ms.motivo = 'reclamacao'`,
      [tecnico],
    );
    expect(email).toMatchObject({ estado: 'enviada' });
    expect(email.corpo).toContain(nova.body.numero);
    expect(email.corpo).toContain('EM ATRASO');
    const r2 = await servico.avisar();
    const repetidos = await linhas(
      ctx.db,
      `SELECT 1 FROM mensagens_saida ms JOIN utilizadores u ON u.email = ms.destino
       WHERE u.id = $1 AND ms.canal = 'email'`,
      [tecnico],
    );
    expect(repetidos).toHaveLength(1);
    expect(r2.emails).toBe(0);

    await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${nova.body.id}/encerrar`)
      .set(chefe)
      .send({})
      .expect(400);
    const fechada = await ctx
      .http()
      .post(`/v1/painel/reclamacoes/${nova.body.id}/encerrar`)
      .set(chefe)
      .send({ nota: 'A pessoa desistiu ao balcão.' })
      .expect(200);
    expect(fechada.body.estado).toBe('encerrada');

    const lista = await ctx
      .http()
      .get('/v1/painel/reclamacoes')
      .set(chefe)
      .expect(200);
    expect(lista.body.indicadores.respondidas_no_prazo_pct).not.toBeUndefined();
  });

  it('email da triagem que soa a reclamação: aparece como candidato e converte-se numa reclamação formal (uma só vez)', async () => {
    const e = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO emails_entrada (municipio_id, de, assunto, corpo, recebido_em, tema)
       VALUES ($1, 'Maria Queixosa <maria@exemplo.pt>', 'Reclamação sobre o atendimento',
               'Fui mal atendida no balcão da câmara e quero apresentar uma reclamação.', now(), 'Reclamações')
       RETURNING id`,
      [MUNICIPIO_ID],
    );
    const cand = await ctx
      .http()
      .get('/v1/painel/reclamacoes/emails')
      .set(chefe)
      .expect(200);
    expect(cand.body.emails.map((x: any) => x.id)).toContain(e!.id);

    const conv = await ctx
      .http()
      .post(`/v1/painel/reclamacoes/emails/${e!.id}`)
      .set(chefe)
      .send({})
      .expect(201);
    expect(conv.body).toMatchObject({
      canal: 'email',
      nome: 'Maria Queixosa',
      email: 'maria@exemplo.pt',
      resposta_por: 'email',
      email_id: e!.id,
    });
    await ctx
      .http()
      .post(`/v1/painel/reclamacoes/emails/${e!.id}`)
      .set(chefe)
      .send({})
      .expect(409);
    const depois = await ctx
      .http()
      .get('/v1/painel/reclamacoes/emails')
      .set(chefe)
      .expect(200);
    expect(depois.body.emails.map((x: any) => x.id)).not.toContain(e!.id);
  });

  it('prazo configurável (só a chefia) e permissões do painel', async () => {
    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx.http().get('/v1/painel/reclamacoes').set(vereador).expect(403);
    await ctx.http().get('/v1/painel/reclamacoes').set(atendimento).expect(200);
    const atual = (
      await ctx
        .http()
        .get('/v1/painel/reclamacoes/config')
        .set(atendimento)
        .expect(200)
    ).body.config;
    await ctx
      .http()
      .put('/v1/painel/reclamacoes/config')
      .set(atendimento)
      .send({ ...atual, prazo_dias_uteis: 10 })
      .expect(403);
    await ctx
      .http()
      .put('/v1/painel/reclamacoes/config')
      .set(chefe)
      .send({ ...atual, prazo_dias_uteis: 0 })
      .expect(400);
    await ctx
      .http()
      .put('/v1/painel/reclamacoes/config')
      .set(chefe)
      .send({ ...atual, prazo_dias_uteis: 10 })
      .expect(200);

    const r = await ferramenta(ctx, novaChamada('rec'), 'registar_reclamacao', {
      ...queixa,
      confirmado: true,
    }).expect(200);
    expect(r.body).toMatchObject({
      prazo_dias_uteis: 10,
      responder_ate: somarDiasUteis(hojeLisboa(), 10, feriados),
    });
    // Repor o valor de demonstração.
    await ctx.db.query(
      'UPDATE municipios SET reclamacoes_config = NULL WHERE id = $1',
      [MUNICIPIO_ID],
    );

    const eu = await ctx
      .http()
      .get('/v1/painel/auth/eu')
      .set(vereador)
      .expect(200);
    expect(eu.body.permissoes.reclamacoes).toBe(false);
  });
});
