/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  novaChamada,
  novoTelefone,
  seguirLink,
  smsPara,
} from './app';

/**
 * "Tem direito a isto e ainda não pediu": catálogo de demonstração, a
 * ferramenta que pergunta só o que falta e manda a lista por SMS, a página
 * do link (pedir), o pedido na conversa, o painel e "ligar a quem pode ter
 * direito" (campanha).
 */
describe('Apoios: tem direito e ainda não pediu (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let atendimento: Record<string, string>;
  let tecnico: Record<string, string>;

  // Uma idosa sozinha, inquilina, com rendimento baixo.
  const IDOSA = {
    residente_concelho: true,
    idade: 72,
    pessoas_agregado: 1,
    rendimento_mensal_agregado: 452,
    filhos_idades: [],
    inquilino: true,
  };

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
  });
  afterAll(() => ctx.fechar());

  const painel = () =>
    ctx.http().get('/v1/painel/apoios').set(chefe).expect(200);
  const apoioId = async (codigo: string): Promise<string> =>
    (await painel()).body.apoios.find(
      (a: { codigo: string }) => a.codigo === codigo,
    ).id;

  it('sem catálogo → sem_catalogo (não inventa)', async () => {
    const r = await ferramenta(ctx, novaChamada('apo'), 'que_apoios_tenho', {
      idade: 70,
    }).expect(200);
    expect(r.body).toMatchObject({ respondido: false, motivo: 'sem_catalogo' });
  });

  it('permissões: ver é da ação social; carregar e editar é de quem gere o agente', async () => {
    await ctx.http().get('/v1/painel/apoios').set(tecnico).expect(403);
    await ctx.http().get('/v1/painel/apoios').set(atendimento).expect(200);
    await ctx
      .http()
      .post('/v1/painel/apoios/demonstracao')
      .set(atendimento)
      .expect(403);
    const r = await ctx
      .http()
      .post('/v1/painel/apoios/demonstracao')
      .set(chefe)
      .expect(201);
    expect(r.body.apoios).toHaveLength(5);
    expect(
      r.body.apoios.every((a: { demonstracao: boolean }) => a.demonstracao),
    ).toBe(true);
    expect(r.body.fontes_da_lista.nota).toContain('não tem rendimentos');
    await ctx
      .http()
      .post('/v1/painel/apoios/demonstracao')
      .set(chefe)
      .expect(409);
  });

  let codigoConsulta = '';
  let telefoneIdosa = '';

  it('pergunta só o que falta, depois diz os apoios e manda a lista por SMS', async () => {
    const chamada = novaChamada('apo');
    telefoneIdosa = chamada.telefone;
    const primeiro = await ferramenta(ctx, chamada, 'que_apoios_tenho', {
      idade: 72,
    }).expect(200);
    expect(primeiro.body).toMatchObject({
      respondido: false,
      sms_enviado: false,
      valores_de_demonstracao: true,
    });
    expect(primeiro.body.perguntar_a_seguir[0]).toBe('Mora no concelho?');
    // Só com a idade nada fica decidido: nem sim, nem não.
    expect(primeiro.body.tem_direito).toEqual([]);
    expect(primeiro.body.nao_tem).toEqual([]);
    expect(await smsPara(ctx, chamada.telefone, 'apoio')).toHaveLength(0);

    // A segunda chamada só manda o que faltava (a idade já ficou guardada).
    const { idade: _i, ...resto } = IDOSA;
    void _i;
    const r = await ferramenta(ctx, chamada, 'que_apoios_tenho', {
      ...resto,
      aceita_contacto: true,
    }).expect(200);
    expect(r.body).toMatchObject({ respondido: true, sms_enviado: true });
    expect(
      r.body.tem_direito.map((x: { apoio: string }) => x.apoio).sort(),
    ).toEqual(['apoio_renda', 'cartao_idoso', 'tarifa_social_agua']);
    expect(r.body.dizer).toContain('pode ter direito a');
    expect(r.body.dizer).toContain('demonstração');
    expect(r.body.link).toMatch(/\/apoios\/[A-Z0-9]{8}$/);
    codigoConsulta = String(r.body.link).split('/').pop()!;

    const sms = await smsPara(ctx, chamada.telefone, 'apoio');
    expect(sms).toHaveLength(1);
    expect(sms[0].corpo).toContain(`/apoios/${codigoConsulta}`);

    // Guarda o escalão do rendimento, nunca o valor.
    const c = await linha(
      ctx.db,
      'SELECT perfil, tem_direito, aceita_contacto FROM consultas_apoios WHERE codigo = $1',
      [codigoConsulta],
    );
    expect(c.perfil).toMatchObject({
      idade: 72,
      rendimento_escalao: '300_500',
    });
    expect(JSON.stringify(c)).not.toContain('452');
    expect(c.aceita_contacto).toBe(true);
    expect(await linhas(ctx.db, 'SELECT 1 FROM consultas_apoios')).toHaveLength(
      1,
    );
  });

  it('página pública: a lista com o que entregar; pedir cria um processo APS e manda SMS', async () => {
    const pub = await ctx
      .http()
      .get(`/v1/public/apoios/${codigoConsulta}`)
      .expect(200);
    expect(pub.body.tem_direito).toHaveLength(3);
    const renda = pub.body.tem_direito.find(
      (x: { apoio: string }) => x.apoio === 'apoio_renda',
    );
    expect(renda).toMatchObject({
      pode_pedir: true,
      pedido: null,
      demonstracao: true,
    });
    expect(renda.documentos.length).toBeGreaterThan(0);
    expect(pub.body.nao.map((x: { apoio: string }) => x.apoio)).toContain(
      'cheque_bebe',
    );
    await ctx.http().get('/v1/public/apoios/NAOEXISTE').expect(404);

    const p = await ctx
      .http()
      .post(`/v1/public/apoios/${codigoConsulta}/pedir`)
      .send({ apoio: 'apoio_renda' })
      .expect(200);
    const depois = p.body.tem_direito.find(
      (x: { apoio: string }) => x.apoio === 'apoio_renda',
    );
    expect(depois.pode_pedir).toBe(false);
    expect(depois.pedido.numero).toMatch(/^APS \d+\/\d{4}$/);

    const proc = await linha(
      ctx.db,
      `SELECT p.assunto, p.fase::text AS fase, t.codigo,
              (SELECT count(*)::int FROM processo_eventos e WHERE e.processo_id = p.id AND e.interno) AS internos
       FROM processos p JOIN tipos_processo t ON t.id = p.tipo_processo_id WHERE p.numero = $1`,
      [depois.pedido.numero],
    );
    expect(proc).toMatchObject({
      assunto: 'Pedido de apoio: Apoio à renda',
      fase: 'entrada',
      codigo: 'APS',
      internos: 1,
    });
    const sms = await smsPara(ctx, telefoneIdosa, 'apoio');
    expect(sms).toHaveLength(2);
    const link = /https?:\/\/\S+\/r\/[A-Z0-9]+/.exec(sms[1].corpo)![0];
    expect((await seguirLink(ctx, link)).destino).toBe('processo');

    // Pedir outra vez não duplica; fora da lista não deixa.
    await ctx
      .http()
      .post(`/v1/public/apoios/${codigoConsulta}/pedir`)
      .send({ apoio: 'apoio_renda' })
      .expect(200);
    expect(
      await linhas(ctx.db, 'SELECT 1 FROM pedidos_apoio WHERE origem = $1', [
        'pagina',
      ]),
    ).toHaveLength(1);
    await ctx
      .http()
      .post(`/v1/public/apoios/${codigoConsulta}/pedir`)
      .send({ apoio: 'cheque_bebe' })
      .expect(422);
  });

  it('pedir_apoio na conversa: cria o pedido, não duplica, e pede identificação sem número', async () => {
    const chamada = novaChamada('apo');
    await ferramenta(ctx, chamada, 'que_apoios_tenho', IDOSA).expect(200);
    const r = await ferramenta(ctx, chamada, 'pedir_apoio', {
      apoio: 'cartao_idoso',
      nome: 'Maria Teste',
    }).expect(200);
    expect(r.body).toMatchObject({
      pedido: true,
      ja_existia: false,
      sms_enviado: true,
    });
    expect(r.body.numero).toMatch(/^APS /);
    expect(r.body.dizer).toContain('Fiz o pedido de Cartão municipal do idoso');
    const outra = await ferramenta(ctx, chamada, 'pedir_apoio', {
      apoio: 'cartao_idoso',
    }).expect(200);
    expect(outra.body).toMatchObject({
      ja_existia: true,
      numero: r.body.numero,
    });

    const x = await ferramenta(ctx, chamada, 'pedir_apoio', {
      apoio: 'nao_existe',
    }).expect(200);
    expect(x.body).toMatchObject({
      pedido: false,
      motivo: 'apoio_desconhecido',
    });
    const anonimo = await ferramenta(
      ctx,
      { conversa: novaChamada('apo').conversa, telefone: '' },
      'pedir_apoio',
      { apoio: 'cartao_idoso' },
    ).expect(200);
    expect(anonimo.body).toMatchObject({
      pedido: false,
      motivo: 'precisa_identificacao',
    });
  });

  it('painel: quantos tinham direito e não pediram, por apoio, e as consultas', async () => {
    const r = await painel();
    const por = (codigo: string) =>
      r.body.apoios.find((a: { codigo: string }) => a.codigo === codigo)
        .numeros;
    // A idosa da 1.ª consulta pediu a renda; a da 2.ª pediu o cartão.
    expect(por('apoio_renda')).toMatchObject({
      tem_direito: 2,
      pedidos: 1,
      sem_pedido: 1,
    });
    expect(por('tarifa_social_agua')).toMatchObject({
      tem_direito: 2,
      sem_pedido: 2,
      // Só a 1.ª aceitou que lhe voltassem a ligar.
      sem_pedido_contactaveis: 1,
    });
    expect(r.body.totais).toMatchObject({ consultas: 2, pedidos: 2 });
    const c = r.body.consultas.find((x: { pedidos: string[] }) =>
      x.pedidos.includes('Apoio à renda'),
    );
    expect(c.perfil).toContain('72 anos');
    expect(c.perfil).toContain('300 € a 500 €');
    expect(c.telefone).toContain('••');
    expect(c.sem_pedido).toEqual(
      expect.arrayContaining(['Tarifa social da água']),
    );
  });

  it('editar critérios: só quem gere o agente; a ferramenta usa logo os novos', async () => {
    const id = await apoioId('cartao_idoso');
    const atual = (await painel()).body.apoios.find(
      (a: { id: string }) => a.id === id,
    );
    const corpo = {
      nome: atual.nome,
      resumo: atual.resumo,
      valor: atual.valor,
      quem_pode: 'Quem tem 60 anos ou mais e mora no concelho.',
      criterios: { ...atual.criterios, idade_min: 60 },
      documentos: atual.documentos,
      como_pedir: atual.como_pedir,
      fonte: atual.fonte,
      demonstracao: true,
      ativo: true,
    };
    await ctx
      .http()
      .put(`/v1/painel/apoios/${id}`)
      .set(atendimento)
      .send(corpo)
      .expect(403);
    await ctx
      .http()
      .put(`/v1/painel/apoios/${id}`)
      .set(chefe)
      .send({ ...corpo, criterios: { idade_min: 'x' } })
      .expect(400);
    const r = await ctx
      .http()
      .put(`/v1/painel/apoios/${id}`)
      .set(chefe)
      .send(corpo)
      .expect(200);
    expect(r.body.criterios.idade_min).toBe(60);
    const t = await ferramenta(ctx, novaChamada('apo'), 'que_apoios_tenho', {
      ...IDOSA,
      idade: 62,
    }).expect(200);
    expect(t.body.tem_direito.map((x: { apoio: string }) => x.apoio)).toContain(
      'cartao_idoso',
    );
  });

  it('ligar a quem pode ter direito: campanha para quem aceitou, com o contexto na chamada', async () => {
    const id = await apoioId('tarifa_social_agua');
    const pre = await ctx
      .http()
      .post(`/v1/painel/apoios/${id}/pre-visualizar-campanha`)
      .set(atendimento)
      .send({ origem: 'consultas' })
      .expect(200);
    expect(pre.body).toMatchObject({ destinatarios: 1, a_ligar: 1 });
    expect(pre.body.mensagem).toContain('Tarifa social da água');

    await ctx
      .http()
      .post(`/v1/painel/apoios/${id}/campanha`)
      .set(tecnico)
      .send({ origem: 'consultas' })
      .expect(403);
    const c = await ctx
      .http()
      .post(`/v1/painel/apoios/${id}/campanha`)
      .set(atendimento)
      .send({ origem: 'consultas', ignorar_horario: true })
      .expect(201);
    expect(c.body).toMatchObject({ destinatarios: 1, a_ligar: 1 });

    const ch = await linha(
      ctx.db,
      `SELECT cs.id, cs.motivo, cs.telefone_e164, cs.contexto
       FROM campanha_destinatarios d JOIN chamadas_saida cs ON cs.id = d.chamada_saida_id
       WHERE d.campanha_id = $1`,
      [c.body.campanha_id],
    );
    expect(ch).toMatchObject({
      motivo: 'campanha',
      telefone_e164: telefoneIdosa,
    });
    expect(ch.contexto.link).toContain(`/apoios/${codigoConsulta}`);
    expect(ch.contexto.nota).toContain('pedir_apoio');

    // A campanha aparece na ação social, com o nome do munícipe.
    const det = await ctx
      .http()
      .get(`/v1/painel/campanhas/${c.body.campanha_id}`)
      .set(atendimento)
      .expect(200);
    expect(det.body.destinatarios).toHaveLength(1);
    expect(det.body.titulo).toBe('Apoios: Tarifa social da água');
    const p = await painel();
    expect(p.body.campanhas[0]).toMatchObject({
      id: c.body.campanha_id,
      origem: 'consultas',
      apoio: 'Tarifa social da água',
    });

    // Não volta a ligar a quem já está nesta campanha.
    await ctx
      .http()
      .post(`/v1/painel/apoios/${id}/campanha`)
      .set(atendimento)
      .send({ origem: 'consultas' })
      .expect(422);

    // Na chamada, a pessoa pede: origem 'campanha'.
    const chamada = {
      conversa: `camp-apo-${Date.now()}`,
      telefone: telefoneIdosa,
    };
    await ctx.db.query(
      `UPDATE chamadas_saida SET estado = 'a_ligar', tentativas = 1, iniciada_em = now(),
         provider_conversa_ref = $2 WHERE id = $1`,
      [ch.id, chamada.conversa],
    );
    const pedido = await ferramenta(ctx, chamada, 'pedir_apoio', {
      apoio: 'tarifa_social_agua',
    }).expect(200);
    expect(pedido.body.pedido).toBe(true);
    const pa = await linha(
      ctx.db,
      `SELECT pa.origem FROM pedidos_apoio pa JOIN apoios a ON a.id = pa.apoio_id
       WHERE a.codigo = 'tarifa_social_agua'`,
    );
    expect(pa.origem).toBe('campanha');
  });

  it('ou para a lista da ação social (diz de onde vem a lista)', async () => {
    const id = await apoioId('cartao_idoso');
    await ctx
      .http()
      .post('/v1/painel/campanhas/contactos')
      .set(chefe)
      .send({ nome: 'Rosa Inscrita', telefone: novoTelefone() })
      .expect(201);
    const c = await ctx
      .http()
      .post(`/v1/painel/apoios/${id}/campanha`)
      .set(chefe)
      .send({ origem: 'contactos_cuidado', ignorar_horario: true })
      .expect(201);
    expect(c.body.destinatarios).toBeGreaterThanOrEqual(1);
    const ch = await linha(
      ctx.db,
      `SELECT cs.contexto FROM campanha_destinatarios d
       JOIN chamadas_saida cs ON cs.id = d.chamada_saida_id WHERE d.campanha_id = $1 LIMIT 1`,
      [c.body.campanha_id],
    );
    expect(ch.contexto.nota).toContain('que_apoios_tenho');
    const acessos = await linhas(
      ctx.db,
      `SELECT acao FROM audit_log WHERE acao IN ('ligar_quem_tem_direito','pedir_apoio','mudar_apoio')`,
    );
    expect(acessos.map((a) => a.acao)).toEqual(
      expect.arrayContaining([
        'ligar_quem_tem_direito',
        'pedir_apoio',
        'mudar_apoio',
      ]),
    );
  });
});
