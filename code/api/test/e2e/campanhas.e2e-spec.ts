/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { ChamadasSaidaService } from '../../src/modules/chamadas-saida/chamadas-saida.service';
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

/**
 * Campanhas de contacto (ação social): pessoas inscritas, "ligar a todos",
 * a resposta do agente, quem não atende recebe SMS e o painel mostra
 * primeiro quem precisa de ajuda.
 */
describe('Campanhas de contacto (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let configOriginal: unknown;
  const freguesia = `Freguesia E2E ${Date.now()}`;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    const a = await linha(
      ctx.db,
      'SELECT chamadas_saida FROM agente_config WHERE municipio_id = $1',
      [MUNICIPIO_ID],
    );
    configOriginal = a?.chamadas_saida;
  });
  afterAll(async () => {
    await ctx.db.query(
      'UPDATE agente_config SET chamadas_saida = $2 WHERE municipio_id = $1',
      [MUNICIPIO_ID, JSON.stringify(configOriginal)],
    );
    await ctx.fechar();
  });

  const inscrever = (
    nome: string,
    telefone = novoTelefone(),
    extra: object = {},
  ) =>
    ctx
      .http()
      .post('/v1/painel/campanhas/contactos')
      .set(chefe)
      .send({ nome, telefone, freguesia, morada: 'Rua do Teste 1', ...extra })
      .expect(201)
      .then((r) => ({ id: r.body.id as string, telefone }));

  const PRESET = {
    tipo: 'onda_calor',
    titulo: 'Onda de calor E2E',
    mensagem: 'Estamos a ligar por causa do calor destes dias.',
    perguntas: ['Está tudo bem consigo?', 'Precisa de alguma coisa?'],
    sms_recurso: 'Camara: com o calor, esta tudo bem? Ligue-nos se precisar.',
  };

  it('perfil técnico não tem acesso (acao_social)', async () => {
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    const r = await ctx
      .http()
      .get('/v1/painel/campanhas')
      .set(tecnico)
      .expect(403);
    expect(r.body.erro.detalhes).toEqual({ recurso: 'acao_social' });
  });

  it('inscrever e listar pessoas, com presets e freguesias', async () => {
    await inscrever('Maria Inscrita');
    const r = await ctx
      .http()
      .get('/v1/painel/campanhas/contactos')
      .set(chefe)
      .expect(200);
    expect(r.body.contactos).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nome: 'Maria Inscrita',
          freguesia,
          consentimento_origem: 'acao_social',
          ligavel: true,
        }),
      ]),
    );
    expect(r.body.freguesias).toEqual(
      expect.arrayContaining([
        { nome: freguesia, pessoas: expect.any(Number) },
      ]),
    );
    expect(r.body.presets.map((p: { tipo: string }) => p.tipo)).toContain(
      'onda_calor',
    );
  });

  it('ligar a todos: chamadas agendadas; sem ElevenLabs vai o SMS e fica "sem ligação"', async () => {
    const f = `${freguesia} A`;
    const a = await inscrever('Ana Calor', novoTelefone(), { freguesia: f });
    const b = await inscrever('Bruno Recusa', novoTelefone(), { freguesia: f });
    await ctx.db.query(
      `UPDATE municipes SET aceita_chamadas = false WHERE telefone_e164 = $1`,
      [b.telefone],
    );
    const pre = await ctx
      .http()
      .post('/v1/painel/campanhas/pre-visualizar')
      .set(chefe)
      .send({ freguesias: [f] })
      .expect(200);
    expect(pre.body).toMatchObject({
      destinatarios: 2,
      a_ligar: 1,
      recusam_chamadas: 1,
    });

    const c = await ctx
      .http()
      .post('/v1/painel/campanhas')
      .set(chefe)
      .send({ ...PRESET, freguesias: [f], ignorar_horario: true })
      .expect(201);
    expect(c.body).toMatchObject({ destinatarios: 2, a_ligar: 2 });

    const chamadas = await linhas(
      ctx.db,
      `SELECT cs.motivo, cs.estado, cs.forcar_horario, cs.contexto
       FROM campanha_destinatarios d JOIN chamadas_saida cs ON cs.id = d.chamada_saida_id
       WHERE d.campanha_id = $1`,
      [c.body.id],
    );
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]).toMatchObject({
      motivo: 'campanha',
      estado: 'agendada',
      forcar_horario: true,
      contexto: { campanha: { id: c.body.id, perguntas: PRESET.perguntas } },
    });

    // O job: sem ElevenLabs configurado → 'falhou' + SMS; quem recusa → 'cancelada' + SMS.
    await ctx.app.get(ChamadasSaidaService).processar();
    const d = await ctx
      .http()
      .get(`/v1/painel/campanhas/${c.body.id}`)
      .set(chefe)
      .expect(200);
    expect(d.body.contagens).toMatchObject({
      sem_ligacao: 1,
      recusou: 1,
      a_ligar: 0,
    });
    expect(d.body.estado).toBe('terminada');
    for (const t of [a.telefone, b.telefone]) {
      const sms = await smsPara(ctx, t, 'aviso');
      expect(sms.map((s) => s.corpo)).toContain(PRESET.sms_recurso);
    }
  });

  it('resposta do agente na chamada: precisa de ajuda aparece primeiro e a ação social trata', async () => {
    const f = `${freguesia} B`;
    await inscrever('Carla Bem', novoTelefone(), { freguesia: f });
    await inscrever('Dulce Ajuda', novoTelefone(), { freguesia: f });
    const c = await ctx
      .http()
      .post('/v1/painel/campanhas')
      .set(chefe)
      .send({ ...PRESET, freguesias: [f], ignorar_horario: true })
      .expect(201);
    const dest = await linhas<{ id: string; nome: string; chamada: string }>(
      ctx.db,
      `SELECT d.id, cc.nome, d.chamada_saida_id AS chamada
       FROM campanha_destinatarios d JOIN contactos_cuidado cc ON cc.id = d.contacto_id
       WHERE d.campanha_id = $1`,
      [c.body.id],
    );

    // Simula o ElevenLabs a ligar: a chamada fica 'a_ligar' com o id da conversa.
    const responder = async (nome: string, corpo: object) => {
      const x = dest.find((y) => y.nome === nome)!;
      const chamada = novaChamada('camp');
      await ctx.db.query(
        `UPDATE chamadas_saida SET estado = 'a_ligar', tentativas = 1, iniciada_em = now(),
           provider_conversa_ref = $2 WHERE id = $1`,
        [x.chamada, chamada.conversa],
      );
      const motivo = await ferramenta(ctx, chamada, 'motivo_da_chamada').expect(
        200,
      );
      expect(motivo.body).toMatchObject({
        chamada_de_saida: true,
        perguntas: PRESET.perguntas,
        instrucao: expect.stringContaining('resposta_campanha'),
      });
      return ferramenta(ctx, chamada, 'resposta_campanha', corpo).expect(200);
    };

    const ok = await responder('Carla Bem', { estado: 'bem' });
    expect(ok.body).toMatchObject({ gravado: true });
    const ajuda = await responder('Dulce Ajuda', {
      estado: 'precisa_ajuda',
      necessidades: ['agua', 'transporte'],
      nota: 'Sozinha, sem água fresca.',
    });
    expect(ajuda.body.dizer).toContain('ação social');

    const d = await ctx
      .http()
      .get(`/v1/painel/campanhas/${c.body.id}`)
      .set(chefe)
      .expect(200);
    expect(d.body.destinatarios[0]).toMatchObject({
      nome: 'Dulce Ajuda',
      estado: 'precisa_ajuda',
      necessidades: ['agua', 'transporte'],
      nota: 'Sozinha, sem água fresca.',
      tratado_em: null,
    });
    expect(d.body.contagens).toMatchObject({ bem: 1, precisa_ajuda: 1 });

    await ctx
      .http()
      .patch(`/v1/painel/campanhas/destinatarios/${d.body.destinatarios[0].id}`)
      .set(chefe)
      .send({ nota: 'Levámos água às 15h.' })
      .expect(200);
    const depois = await ctx
      .http()
      .get(`/v1/painel/campanhas/${c.body.id}`)
      .set(chefe)
      .expect(200);
    const dulce = depois.body.destinatarios.find(
      (x: { nome: string }) => x.nome === 'Dulce Ajuda',
    );
    expect(dulce).toMatchObject({
      tratado_nota: 'Levámos água às 15h.',
      tratado_em: expect.any(String),
      tratado_por_nome: expect.any(String),
    });
  });

  it('resposta_campanha fora de uma campanha → gravado: false', async () => {
    const r = await ferramenta(ctx, novaChamada(), 'resposta_campanha', {
      estado: 'bem',
    }).expect(200);
    expect(r.body.gravado).toBe(false);
  });

  it('cancelar: as chamadas ainda por fazer ficam canceladas', async () => {
    const f = `${freguesia} C`;
    await inscrever('Eva Cancela', novoTelefone(), { freguesia: f });
    const c = await ctx
      .http()
      .post('/v1/painel/campanhas')
      .set(chefe)
      .send({ ...PRESET, freguesias: [f] })
      .expect(201);
    const r = await ctx
      .http()
      .post(`/v1/painel/campanhas/${c.body.id}/cancelar`)
      .set(chefe)
      .expect(200);
    expect(r.body).toEqual({ cancelada: true, chamadas_canceladas: 1 });
    const d = await ctx
      .http()
      .get(`/v1/painel/campanhas/${c.body.id}`)
      .set(chefe)
      .expect(200);
    expect(d.body).toMatchObject({
      estado: 'cancelada',
      contagens: { cancelado: 1 },
    });
  });

  it('sem pessoas na freguesia → 422', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/campanhas')
      .set(chefe)
      .send({ ...PRESET, freguesias: ['Ninguém mora aqui'] })
      .expect(422);
    expect(r.body.erro.codigo).toBe('sem_destinatarios');
  });
});
