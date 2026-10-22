/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import { JuntasDemoService } from '../../src/modules/juntas/juntas.demo';
import { MunicipiosService } from '../../src/modules/municipios/municipios.service';
import { SEGREDO_AGENTE } from './ambiente';
import {
  arrancarApp,
  Chamada,
  Contexto,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO,
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

/** Nome de freguesia único por execução (sem dígitos: lê-se como palavras). */
function freguesiaNova(): string {
  const letras = 'bcdfghjlmnprstv';
  const s = Array.from({ length: 6 }, (_, i) =>
    i % 2 ? 'aeiou'[randomInt(5)] : letras[randomInt(letras.length)],
  ).join('');
  return `Vila ${s[0].toUpperCase()}${s.slice(1)}`;
}

/**
 * Versão para juntas de freguesia: a junta como tenant (feature flags no
 * painel e no agente, RLS entre câmara e junta), o agente da câmara a
 * encaminhar o atestado para a junta da freguesia da morada, o atestado
 * emitido no painel da junta com PDF e SMS, e a junta de demonstração.
 */
describe('Juntas de freguesia (e2e)', () => {
  let ctx: Contexto;
  const JUNTA = randomUUID();
  const OUTRA = randomUUID();
  const SLUG = `junta-${JUNTA.slice(0, 8)}`;
  const SLUG_OUTRA = `junta-${OUTRA.slice(0, 8)}`;
  const FREGUESIA = freguesiaNova();
  const FREGUESIA_OUTRA = freguesiaNova();
  let funcionario: Record<string, string>;
  let vereador: Record<string, string>;
  let funcionarioOutra: Record<string, string>;
  let chefeCamara: Record<string, string>;

  const utilizador = async (municipioId: string, perfil: string) => {
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, municipioId, `${perfil}-${id.slice(0, 8)}@junta.pt`, `Junta ${perfil}`, perfil],
    );
    return entrarPainel(ctx, id);
  };

  /** Ferramenta no agente da junta (X-Municipio = slug da junta). */
  const naJunta = (chamada: Chamada, nome: string, corpo: object = {}) =>
    ctx
      .http()
      .post(`/v1/agent/tools/${nome}`)
      .set({
        'X-Agente-Segredo': SEGREDO_AGENTE,
        'X-Municipio': SLUG,
        'X-Conversa-Id': chamada.conversa,
        'X-Telefone': chamada.telefone,
      })
      .send(corpo);

  const dados = (o: Record<string, string>) =>
    Object.entries(o).map(([campo, valor]) => ({ campo, valor }));

  const pdf = (caminho: string, headers: Record<string, string> = {}) =>
    ctx
      .http()
      .get(caminho)
      .set(headers)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });

  beforeAll(async () => {
    ctx = await arrancarApp();
    for (const [id, slug, freg] of [
      [JUNTA, SLUG, FREGUESIA],
      [OUTRA, SLUG_OUTRA, FREGUESIA_OUTRA],
    ] as const) {
      await ctx.db.query(
        `INSERT INTO municipios (id, slug, nome, tipo, concelho_id, freguesias)
         VALUES ($1, $2, $3, 'junta', $4, $5)`,
        [id, slug, `Junta de Freguesia de ${freg}`, MUNICIPIO_ID, [freg]],
      );
      await ctx.db.query(
        `INSERT INTO agente_config (municipio_id, nome, saudacao, versao)
         VALUES ($1, 'Junta', 'Olá, fala a junta.', 'teste')`,
        [id],
      );
    }
    funcionario = await utilizador(JUNTA, 'atendimento');
    vereador = await utilizador(JUNTA, 'vereador');
    funcionarioOutra = await utilizador(OUTRA, 'chefe_divisao');
    chefeCamara = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  it('a junta é um município com tipo, ligado à câmara', async () => {
    const eu = await ctx
      .http()
      .get('/v1/painel/auth/eu')
      .set(funcionario)
      .expect(200);
    expect(eu.body.municipio).toMatchObject({ slug: SLUG, tipo: 'junta' });
    expect(eu.body.permissoes.atestados).toBe(true);

    const camara = await ctx
      .http()
      .get('/v1/painel/juntas')
      .set(chefeCamara)
      .expect(200);
    expect(camara.body.tipo).toBe('camara');
    expect(camara.body.juntas.map((j: { slug: string }) => j.slug)).toEqual(
      expect.arrayContaining([SLUG, SLUG_OUTRA]),
    );
    const junta = await ctx
      .http()
      .get('/v1/painel/juntas')
      .set(funcionario)
      .expect(200);
    expect(junta.body).toMatchObject({
      tipo: 'junta',
      freguesias: [FREGUESIA],
      concelho: { id: MUNICIPIO_ID },
    });

    const pub = await ctx.http().get(`/v1/public/juntas/${SLUG}`).expect(200);
    expect(pub.body).toMatchObject({ nome: `Junta de Freguesia de ${FREGUESIA}` });
    await ctx.http().get(`/v1/public/juntas/${MUNICIPIO}`).expect(404);
  });

  it('painel: a junta não tem licenças nem urbanismo; a câmara não tem atestados', async () => {
    for (const c of [
      '/v1/painel/licencas',
      '/v1/painel/processos',
      '/v1/painel/ordenamento',
    ]) {
      // A chefia (tem a permissão 'processos'): o 404 vem da versão junta.
      const r = await ctx.http().get(c).set(funcionarioOutra).expect(404);
      expect(r.body.erro?.codigo ?? r.body.codigo).toBe(
        'funcionalidade_indisponivel',
      );
    }
    await ctx.http().get('/v1/painel/conversas').set(funcionario).expect(200);
    await ctx.http().get('/v1/painel/atestados').set(funcionario).expect(200);
    await ctx.http().get('/v1/painel/atestados').set(chefeCamara).expect(404);
    await ctx.http().get('/v1/painel/licencas').set(chefeCamara).expect(200);
    // Permissão: o perfil vereador não trata atestados.
    await ctx.http().get('/v1/painel/atestados').set(vereador).expect(403);
  });

  it('agente da junta: o que é da câmara responde com o contacto da câmara', async () => {
    const chamada = novaChamada('junta');
    const lic = await naJunta(chamada, 'pedir_licenca', {
      tipo: 'ruido',
      dados: {},
    }).expect(200);
    expect(lic.body).toMatchObject({
      feito: false,
      motivo: 'tratado_pela_camara',
    });
    expect(lic.body.dizer).toMatch(/Câmara Municipal/);

    const escolas = await naJunta(chamada, 'pedir_servico', {
      area: 'escolas',
      acao: 'x',
      dados: [],
    }).expect(200);
    expect(escolas.body.motivo).toBe('tratado_pela_camara');

    const catalogo = await naJunta(chamada, 'outros_servicos', {}).expect(200);
    expect(catalogo.body.areas.map((a: { area: string }) => a.area)).toEqual([
      'junta',
    ]);
    const campos = await naJunta(chamada, 'outros_servicos', {
      area: 'junta',
    }).expect(200);
    expect(campos.body.acoes.map((a: { acao: string }) => a.acao)).toEqual(
      expect.arrayContaining(['pedir_atestado', 'prova_de_vida', 'estado_atestado']),
    );

    // O atendimento geral continua.
    const conh = await naJunta(chamada, 'procurar_conhecimento', {
      pergunta: 'horário da junta',
    });
    expect(conh.status).toBe(200);
    expect(conh.body.motivo).not.toBe('tratado_pela_camara');
  });

  it('agente da câmara: a área da junta aparece no catálogo da câmara', async () => {
    const r = await ferramenta(ctx, novaChamada('cat'), 'outros_servicos', {}).expect(
      200,
    );
    expect(r.body.areas.map((a: { area: string }) => a.area)).toContain('junta');
  });

  let atestadoId: string;
  let telefone: string;

  it('agente da câmara encaminha o atestado de residência para a junta da freguesia da morada', async () => {
    const chamada = novaChamada('cam');
    telefone = chamada.telefone;
    const pedido = {
      area: 'junta',
      acao: 'pedir_atestado',
      dados: dados({
        tipo: 'residencia',
        nome: 'Maria Teste Costa',
        morada: `Rua Direita, 45, ${FREGUESIA}`,
        finalidade: 'apresentar na escola',
      }),
    };
    // Sem identificação: pede o NIF.
    const sem = await ferramenta(ctx, chamada, 'pedir_servico', pedido).expect(200);
    expect(sem.body).toMatchObject({
      feito: false,
      precisa_identificacao: true,
    });

    await ferramenta(ctx, chamada, 'identificar_municipe', {
      nif: novoNif(),
      nome: 'Maria Teste Costa',
    }).expect(200);

    // Freguesia que não existe nos dados: pergunta.
    const errada = await ferramenta(ctx, chamada, 'pedir_servico', {
      ...pedido,
      dados: dados({
        tipo: 'residencia',
        nome: 'Maria Teste Costa',
        morada: 'Rua Sem Nome, 1',
        freguesia: 'Freguesia Que Não Existe',
      }),
    }).expect(200);
    expect(errada.body.motivo).toBe('freguesia_desconhecida');

    const r = await ferramenta(ctx, chamada, 'pedir_servico', pedido).expect(200);
    expect(r.body).toMatchObject({
      feito: true,
      encaminhado: true,
      junta: `Junta de Freguesia de ${FREGUESIA}`,
      freguesia: FREGUESIA,
      valores_de_demonstracao: true,
    });
    expect(r.body.numero).toMatch(/^AT \d+\/\d{4}$/);
    expect(r.body.dizer).toMatch(/já lho passei/);

    const a = await linha(
      ctx.db,
      `SELECT a.id, a.municipio_id, a.origem_municipio_id, a.estado, a.tipo, a.freguesia,
              p.municipio_id AS municipe_municipio, p.nif_hash IS NOT NULL AS tem_nif, p.nome
       FROM atestados a JOIN municipes p ON p.id = a.municipe_id
       WHERE a.numero = $1 AND a.municipio_id = $2`,
      [r.body.numero, JUNTA],
    );
    expect(a).toMatchObject({
      municipio_id: JUNTA,
      origem_municipio_id: MUNICIPIO_ID,
      estado: 'pedido',
      tipo: 'residencia',
      freguesia: FREGUESIA,
      municipe_municipio: JUNTA,
      tem_nif: true,
      nome: 'Maria Teste Costa',
    });
    atestadoId = a.id;

    const sms = await smsPara(ctx, telefone, 'atestado');
    expect(sms).toHaveLength(1);
    expect(sms[0].corpo).toContain(r.body.numero);
    expect(sms[0].corpo).toMatch(/\/atestado\/[A-Z2-9]{10}$/);

    // Fica no registo da câmara (encaminhou) e no da junta (pedido).
    const registos = await linhas(
      ctx.db,
      `SELECT municipio_id, acao FROM audit_log WHERE objeto_id = $1 ORDER BY acao`,
      [atestadoId],
    );
    expect(registos).toEqual(
      expect.arrayContaining([
        { municipio_id: MUNICIPIO_ID, acao: 'encaminhar_atestado' },
        { municipio_id: JUNTA, acao: 'pedir_atestado' },
      ]),
    );
  });

  it('RLS: o painel da junta não vê dados da câmara nem de outra junta, e vice-versa', async () => {
    // A junta vê o atestado encaminhado; a outra junta não.
    const lista = await ctx
      .http()
      .get('/v1/painel/atestados?estado=pedido')
      .set(funcionario)
      .expect(200);
    expect(lista.body.itens.map((x: { id: string }) => x.id)).toContain(
      atestadoId,
    );
    expect(lista.body.itens[0].encaminhado_por).toBeTruthy();
    await ctx
      .http()
      .get(`/v1/painel/atestados/${atestadoId}`)
      .set(funcionarioOutra)
      .expect(404);
    const outra = await ctx
      .http()
      .get('/v1/painel/atestados')
      .set(funcionarioOutra)
      .expect(200);
    expect(outra.body.itens.map((x: { id: string }) => x.id)).not.toContain(
      atestadoId,
    );

    // Conversas: a da câmara não aparece na junta, a da junta não aparece na câmara.
    const naCamara = await linha<{ id: string }>(
      ctx.db,
      `SELECT id FROM conversas WHERE municipio_id = $1 ORDER BY iniciada_em DESC LIMIT 1`,
      [MUNICIPIO_ID],
    );
    const chamada = novaChamada('jconv');
    await naJunta(chamada, 'procurar_conhecimento', {
      pergunta: 'cemitério',
    });
    const daJunta = await linha<{ id: string }>(
      ctx.db,
      'SELECT id FROM conversas WHERE provider_id = $1',
      [chamada.conversa],
    );
    expect(daJunta).toBeTruthy();
    await ctx
      .http()
      .get(`/v1/painel/conversas/${naCamara!.id}`)
      .set(funcionario)
      .expect(404);
    await ctx
      .http()
      .get(`/v1/painel/conversas/${daJunta!.id}`)
      .set(chefeCamara)
      .expect(404);
    await ctx
      .http()
      .get(`/v1/painel/conversas/${daJunta!.id}`)
      .set(funcionario)
      .expect(200);
  });

  it('a junta emite o atestado: PDF com QR, SMS com o link e página pública', async () => {
    const det = await ctx
      .http()
      .get(`/v1/painel/atestados/${atestadoId}`)
      .set(funcionario)
      .expect(200);
    expect(det.body.texto[0]).toContain('reside em Rua Direita, 45');
    // Ainda não há PDF.
    await pdf(`/v1/painel/atestados/${atestadoId}/pdf`, funcionario).expect(404);

    const r = await ctx
      .http()
      .post(`/v1/painel/atestados/${atestadoId}/emitir`)
      .set(funcionario)
      .send({ nota: 'Verificado no recenseamento' })
      .expect(200);
    expect(r.body).toMatchObject({ estado: 'emitido' });
    expect(r.body.emitido_por).toBe('Junta atendimento');
    expect(r.body.texto).toContain('Verificado no recenseamento.');

    // Outra vez: já está decidido.
    await ctx
      .http()
      .post(`/v1/painel/atestados/${atestadoId}/emitir`)
      .set(funcionario)
      .send({})
      .expect(409);

    const sms = await smsPara(ctx, telefone, 'atestado');
    expect(sms).toHaveLength(2);
    expect(sms[1].corpo).toMatch(/está pronto/);
    const codigo = /\/atestado\/([A-Z2-9]{10})$/.exec(sms[1].corpo)![1];

    const pub = await ctx
      .http()
      .get(`/v1/public/atestados/${codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      estado: 'emitido',
      titular: 'Maria C.',
      pdf: true,
      demonstracao: true,
      junta: `Junta de Freguesia de ${FREGUESIA}`,
    });
    for (const [c, h] of [
      [`/v1/public/atestados/${codigo}/pdf`, {}],
      [`/v1/painel/atestados/${atestadoId}/pdf`, funcionario],
    ] as const) {
      const f = await pdf(c, h).expect(200);
      expect(f.headers['content-type']).toContain('application/pdf');
      expect((f.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }

    const auditoria = await linha(
      ctx.db,
      `SELECT municipio_id FROM audit_log WHERE objeto_id = $1 AND acao = 'emitir_atestado'`,
      [atestadoId],
    );
    expect(auditoria).toMatchObject({ municipio_id: JUNTA });
  });

  it('agente da junta: prova de vida na própria junta, estado e recusa', async () => {
    const chamada = novaChamada('jpv');
    await naJunta(chamada, 'identificar_municipe', {
      nif: novoNif(),
      nome: 'António Teste',
    }).expect(200);
    const r = await naJunta(chamada, 'pedir_servico', {
      area: 'junta',
      acao: 'prova_de_vida',
      dados: dados({
        nome: 'António Teste',
        morada: 'Rua da Igreja, 3',
        freguesia: FREGUESIA,
        entidade_pensao: 'Caixa Geral de Aposentações',
        pode_deslocar: 'não',
      }),
    }).expect(200);
    expect(r.body).toMatchObject({
      feito: true,
      encaminhado: false,
      tipo: 'prova_vida',
    });
    expect(r.body.dizer).toMatch(/visita a casa/);

    const a = await linha(
      ctx.db,
      `SELECT id, conversa_id, origem_municipio_id, dados FROM atestados WHERE numero = $1 AND municipio_id = $2`,
      [r.body.numero, JUNTA],
    );
    expect(a.origem_municipio_id).toBeNull();
    expect(a.conversa_id).toBeTruthy();
    expect(a.dados).toMatchObject({
      entidade_pensao: 'Caixa Geral de Aposentações',
      pode_deslocar: false,
    });

    const est = await naJunta(chamada, 'pedir_servico', {
      area: 'junta',
      acao: 'estado_atestado',
      dados: [],
    }).expect(200);
    expect(est.body.encontrado).toBe(true);
    expect(est.body.dizer).toContain(r.body.numero);

    // A outra freguesia do concelho: a junta encaminha para a outra junta.
    const outra = await naJunta(chamada, 'pedir_servico', {
      area: 'junta',
      acao: 'pedir_atestado',
      dados: dados({
        tipo: 'agregado_familiar',
        nome: 'António Teste',
        morada: 'Rua Nova, 8',
        freguesia: FREGUESIA_OUTRA,
        agregado: 'Rosa Teste (mulher), Rui Teste (filho)',
      }),
    }).expect(200);
    expect(outra.body).toMatchObject({ feito: true, encaminhado: true });
    expect(outra.body.junta).toBe(`Junta de Freguesia de ${FREGUESIA_OUTRA}`);

    await ctx
      .http()
      .post(`/v1/painel/atestados/${a.id}/recusar`)
      .set(funcionario)
      .send({})
      .expect(400);
    const rec = await ctx
      .http()
      .post(`/v1/painel/atestados/${a.id}/recusar`)
      .set(funcionario)
      .send({ motivo: 'A pessoa tem de vir à junta com o cartão de cidadão.' })
      .expect(200);
    expect(rec.body.estado).toBe('recusado');
    const sms = await smsPara(ctx, chamada.telefone, 'atestado');
    expect(sms.at(-1)?.corpo).toMatch(/não pode ser passado/);
  });

  it('preparar demo cria a junta de demonstração (idempotente), com utilizadores, agente e conhecimento', async () => {
    const camara = await ctx.app.get(MunicipiosService).porId(MUNICIPIO_ID);
    const demo = ctx.app.get(JuntasDemoService);
    const r1 = await demo.preparar(camara, null);
    expect(r1).not.toBeNull();
    const r2 = await demo.preparar(camara, null);
    expect(r2!.criada).toBe(false);
    expect(r2!.junta.id).toBe(r1!.junta.id);
    expect(r2!.fontes_novas).toBe(0);
    expect(r2!.atestados_novos).toBe(0);

    const j = await linha(
      ctx.db,
      `SELECT m.slug, m.tipo, m.concelho_id, m.freguesias, m.demonstracao,
              (SELECT count(*)::int FROM utilizadores WHERE municipio_id = m.id) AS utilizadores,
              (SELECT nome FROM agente_config WHERE municipio_id = m.id) AS agente,
              (SELECT count(*)::int FROM fontes f JOIN fonte_versoes v ON v.fonte_id = f.id
                WHERE f.municipio_id = m.id AND f.demonstracao) AS fontes,
              (SELECT count(*)::int FROM atestados WHERE municipio_id = m.id) AS atestados
       FROM municipios m WHERE m.id = $1`,
      [r1!.junta.id],
    );
    expect(j).toMatchObject({
      slug: `${MUNICIPIO}-azurem`,
      tipo: 'junta',
      concelho_id: MUNICIPIO_ID,
      freguesias: ['Azurém'],
      demonstracao: true,
      utilizadores: 2,
      agente: 'Junta de Azurém',
    });
    expect(j.fontes).toBeGreaterThanOrEqual(6);
    expect(j.atestados).toBeGreaterThanOrEqual(2);

    // Uma junta não cria juntas.
    const junta = await ctx.app.get(MunicipiosService).porSlug(SLUG);
    expect(await demo.preparar(junta, null)).toBeNull();
  });
});
