/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import {
  arrancarApp,
  Chamada,
  Contexto,
  conversaId,
  criarUtilizador,
  entrarPainel,
  esperarAte,
  ferramenta,
  linha,
  linhas,
  novaChamada,
  smsPara,
} from './app';

/**
 * Ocorrências na via pública: registo pelo agente com geocodificação,
 * deteção de duplicados (mesma categoria a < 50 m), estado pelo número,
 * mapa do painel (bbox) e resolução com SMS a todos os que reportaram.
 */
describe('Ocorrências (e2e)', () => {
  let ctx: Contexto;
  let painel: Record<string, string>;

  // Coordenadas próprias desta execução, longe de tudo o resto.
  const base = {
    lat: 41.3 + Math.random() * 0.2,
    lng: -8.4 + Math.random() * 0.2,
  };
  /** ~1 m por 0,000009° de latitude. */
  const aNorte = (metros: number) => ({
    lat: base.lat + metros * 0.000009,
    lng: base.lng,
  });

  const sufixo = randomUUID().slice(0, 8);
  const moradaA = `Rua Direita ${sufixo}, 45`;
  const moradaPerto = `Rua Direita ${sufixo}, 47`; // ~20 m
  const moradaLonge = `Rua Direita ${sufixo}, 120`; // ~110 m

  const chamadaA = novaChamada();
  const chamadaB = novaChamada();
  let original: { id: string; numero: string };
  let duplicadoId: string;

  const registar = (chamada: Chamada, corpo: object) =>
    ferramenta(ctx, chamada, 'registar_ocorrencia', corpo).expect(200);

  /** Caixa 'minLng,minLat,maxLng,maxLat' à volta de um ponto (~110 m). */
  const bbox = (c: { lat: number; lng: number }, d = 0.001) =>
    [c.lng - d, c.lat - d, c.lng + d, c.lat + d].join(',');

  beforeAll(async () => {
    ctx = await arrancarApp();
    painel = await entrarPainel(ctx);
    ctx.geo.moradas.set(moradaA, base);
    ctx.geo.moradas.set(moradaPerto, aNorte(20));
    ctx.geo.moradas.set(moradaLonge, aNorte(110));
  });
  afterAll(() => ctx.fechar());

  it('registar_ocorrencia: número OC-…, coordenadas na BD, SMS com o link da foto', async () => {
    const r = await registar(chamadaA, {
      categoria: 'Buraco na via',
      descricao: 'Buraco grande na faixa da direita, já furou um pneu.',
      morada: moradaA,
      ponto_referencia: 'em frente à farmácia',
    });
    expect(r.body).toMatchObject({
      registada: true,
      numero: expect.stringMatching(/^OC-\d{4,}$/),
      categoria: 'Buraco na via',
      duplicada: false,
      localizada_no_mapa: true,
      sms_enviado: true,
      dizer: expect.stringContaining(r.body.numero),
    });
    expect(ctx.geo.pedidos).toContain(moradaA);

    const o = await linha(
      ctx.db,
      `SELECT o.id, o.numero, o.lat, o.lng, o.estado::text AS estado, o.morada,
              o.duplicada_de, o.conversa_id, m.telefone_e164
       FROM ocorrencias o JOIN municipes m ON m.id = o.municipe_id
       WHERE o.numero = $1`,
      [r.body.numero],
    );
    expect(o).toMatchObject({
      estado: 'nova',
      duplicada_de: null,
      telefone_e164: chamadaA.telefone,
      conversa_id: await conversaId(ctx, chamadaA.conversa),
      morada: `${moradaA} (em frente à farmácia)`,
    });
    expect(o.lat).toBeCloseTo(base.lat, 6);
    expect(o.lng).toBeCloseTo(base.lng, 6);
    original = { id: o.id, numero: o.numero };

    const sms = await smsPara(ctx, chamadaA.telefone, 'ocorrencia');
    expect(sms).toHaveLength(1);
    expect(sms[0].corpo).toContain(`registámos a ocorrência ${o.numero}`);
    expect(sms[0].corpo).toMatch(/\/r\/[A-Z0-9]+/);
    expect(sms[0].relacionado).toMatchObject({ ocorrencia_id: o.id });
  });

  it('outra da mesma categoria a < 50 m é duplicado: o mesmo número, o 2.º munícipe fica registado', async () => {
    const r = await registar(chamadaB, {
      categoria: 'Buraco na via',
      descricao: 'Há um buraco enorme na estrada, perto do número 47.',
      morada: moradaPerto,
    });
    expect(r.body).toMatchObject({
      registada: true,
      numero: original.numero,
      duplicada: true,
      localizada_no_mapa: true,
      sms_enviado: true,
      dizer: expect.stringContaining('já está reportado'),
    });

    const d = await linha(
      ctx.db,
      `SELECT o.id, o.numero, o.estado::text AS estado, o.duplicada_de, m.telefone_e164
       FROM ocorrencias o JOIN municipes m ON m.id = o.municipe_id
       WHERE o.duplicada_de = $1`,
      [original.id],
    );
    expect(d).toMatchObject({
      estado: 'duplicada',
      duplicada_de: original.id,
      telefone_e164: chamadaB.telefone,
    });
    // Linha própria com número próprio; o munícipe ouve o do original.
    expect(d.numero).not.toBe(original.numero);
    duplicadoId = d.id;

    const ev = await linhas(
      ctx.db,
      `SELECT tipo, dados FROM ocorrencia_eventos WHERE ocorrencia_id = $1 ORDER BY em, id`,
      [original.id],
    );
    expect(ev.map((e) => e.tipo)).toEqual(['registada', 'duplicado_juntado']);
    expect(ev[1].dados).toMatchObject({ ocorrencia_id: d.id });

    const sms = await smsPara(ctx, chamadaB.telefone, 'ocorrencia');
    expect(sms).toHaveLength(1);
    expect(sms[0].corpo).toContain(`já estava reportado (${original.numero}`);
  });

  it('a > 50 m, ou noutra categoria no mesmo sítio, não é duplicado', async () => {
    const longe = await registar(novaChamada(), {
      categoria: 'Buraco na via',
      descricao: 'Outro buraco, mais à frente na mesma rua.',
      morada: moradaLonge,
    });
    expect(longe.body).toMatchObject({ registada: true, duplicada: false });
    expect(longe.body.numero).not.toBe(original.numero);

    const outraCategoria = await registar(novaChamada(), {
      categoria: 'Iluminação pública',
      descricao: 'O candeeiro está apagado há uma semana.',
      morada: moradaA,
    });
    expect(outraCategoria.body).toMatchObject({
      registada: true,
      categoria: 'Iluminação pública',
      duplicada: false,
    });
  });

  it('categoria que não se percebe: não regista e devolve as categorias', async () => {
    const chamada = novaChamada();
    const r = await registar(chamada, {
      categoria: 'xyzzy plugh',
      descricao: 'Uma coisa estranha qualquer.',
      morada: moradaA,
    });
    expect(r.body).toMatchObject({
      registada: false,
      motivo: 'categoria_por_identificar',
      categorias: expect.arrayContaining([
        'Buraco na via',
        'Iluminação pública',
      ]),
    });
    expect(await smsPara(ctx, chamada.telefone)).toHaveLength(0);
  });

  it('morada sem geocodificação: regista sem coordenadas; a mesma morada é duplicado', async () => {
    const morada = `Travessa Sem Mapa ${randomUUID().slice(0, 8)}`;
    const a = await registar(novaChamada(), {
      categoria: 'Buraco na via',
      descricao: 'Buraco no passeio, junto ao muro.',
      morada,
    });
    expect(a.body).toMatchObject({
      registada: true,
      duplicada: false,
      localizada_no_mapa: false,
    });
    const o = await linha(
      ctx.db,
      'SELECT id, lat, lng FROM ocorrencias WHERE numero = $1',
      [a.body.numero],
    );
    expect(o).toMatchObject({ lat: null, lng: null });
    const ev = await linha(
      ctx.db,
      `SELECT dados FROM ocorrencia_eventos WHERE ocorrencia_id = $1 AND tipo = 'registada'`,
      [o.id],
    );
    expect(ev.dados).toMatchObject({ localizada: false });

    // Sem coordenadas, junta-se só se a morada for a mesma (sem distinguir maiúsculas).
    const b = await registar(novaChamada(), {
      categoria: 'Buraco na via',
      descricao: 'O mesmo buraco no passeio.',
      morada: `  ${morada.toUpperCase()} `,
    });
    expect(b.body).toMatchObject({ duplicada: true, numero: a.body.numero });

    // E não aparece no mapa.
    const mapa = await ctx
      .http()
      .get('/v1/painel/ocorrencias')
      .query({ bbox: '-10,36,-6,43' })
      .set(painel)
      .expect(200);
    expect(mapa.body.itens.map((i: { id: string }) => i.id)).not.toContain(
      o.id,
    );
  });

  it('estado_ocorrencia pelo número (com ou sem "OC-") e pelo telefone do duplicado', async () => {
    const r = await ferramenta(ctx, novaChamada(), 'estado_ocorrencia', {
      numero: original.numero,
    }).expect(200);
    expect(r.body).toEqual({
      encontradas: 1,
      ocorrencias: [
        expect.objectContaining({
          numero: original.numero,
          categoria: 'Buraco na via',
          estado: 'nova',
          estado_explicado: expect.any(String),
          reportada_por: 2,
          reportada_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      ],
    });

    const soDigitos = await ferramenta(
      ctx,
      novaChamada(),
      'estado_ocorrencia',
      {
        numero: original.numero.replace(/\D/g, ''),
      },
    ).expect(200);
    expect(soDigitos.body.ocorrencias[0].numero).toBe(original.numero);

    // Quem reportou o duplicado pergunta sem número: responde com o original.
    const peloTelefone = await ferramenta(
      ctx,
      chamadaB,
      'estado_ocorrencia',
      {},
    ).expect(200);
    expect(peloTelefone.body.ocorrencias[0]).toMatchObject({
      numero: original.numero,
      reportada_por: 2,
    });

    const naoExiste = await ferramenta(
      ctx,
      novaChamada(),
      'estado_ocorrencia',
      {
        numero: 'OC-987654321',
      },
    ).expect(200);
    expect(naoExiste.body).toMatchObject({ encontradas: 0 });
  });

  it('painel: o bbox inclui o que está dentro e exclui o de fora; os duplicados contam no original', async () => {
    const dentro = await ctx
      .http()
      .get('/v1/painel/ocorrencias')
      .query({ bbox: bbox(base) })
      .set(painel)
      .expect(200);
    expect(dentro.body.truncado).toBe(false);
    const ids = dentro.body.itens.map((i: { id: string }) => i.id);
    expect(ids).toContain(original.id);
    expect(ids).not.toContain(duplicadoId); // não é pin
    expect(
      dentro.body.itens.find((i: { id: string }) => i.id === original.id),
    ).toMatchObject({
      numero: original.numero,
      estado: 'nova',
      categoria: 'Buraco na via',
      duplicados: 1,
      lat: expect.closeTo(base.lat, 6),
      lng: expect.closeTo(base.lng, 6),
    });

    const fora = await ctx
      .http()
      .get('/v1/painel/ocorrencias')
      .query({ bbox: bbox({ lat: base.lat + 0.05, lng: base.lng + 0.05 }) })
      .set(painel)
      .expect(200);
    expect(fora.body.itens.map((i: { id: string }) => i.id)).not.toContain(
      original.id,
    );

    const invalido = await ctx
      .http()
      .get('/v1/painel/ocorrencias')
      .query({ bbox: '1,2,3' })
      .set(painel)
      .expect(400);
    expect(invalido.body.erro.codigo).toBe('pedido_invalido');
  });

  it('painel: detalhe com os dois reportes e telefones mascarados', async () => {
    const r = await ctx
      .http()
      .get(`/v1/painel/ocorrencias/${original.id}`)
      .set(painel)
      .expect(200);
    expect(r.body).toMatchObject({
      id: original.id,
      numero: original.numero,
      reportes: 2,
      duplicados: [expect.objectContaining({ id: duplicadoId })],
    });
    expect(r.body.municipe_telefone).not.toBe(chamadaA.telefone);
    expect(r.body.duplicados[0].municipe_telefone).not.toBe(chamadaB.telefone);
  });

  it('PATCH: perfil sem "ocorrencias" → 403; alterar o duplicado → 409', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    const semPermissao = await ctx
      .http()
      .patch(`/v1/painel/ocorrencias/${original.id}`)
      .set(atendimento)
      .send({ estado: 'resolvida' })
      .expect(403);
    expect(semPermissao.body.erro).toMatchObject({
      codigo: 'sem_permissao',
      detalhes: { recurso: 'ocorrencias' },
    });

    const dup = await ctx
      .http()
      .patch(`/v1/painel/ocorrencias/${duplicadoId}`)
      .set(painel)
      .send({ estado: 'resolvida' })
      .expect(409);
    expect(dup.body.erro).toMatchObject({
      codigo: 'ocorrencia_duplicada',
      detalhes: { original_id: original.id },
    });

    const vazio = await ctx
      .http()
      .patch(`/v1/painel/ocorrencias/${original.id}`)
      .set(painel)
      .send({})
      .expect(400);
    expect(vazio.body.erro.codigo).toBe('pedido_invalido');
  });

  it('PATCH estado resolvida → SMS a todos os que reportaram, uma vez só', async () => {
    const r = await ctx
      .http()
      .patch(`/v1/painel/ocorrencias/${original.id}`)
      .set(painel)
      .send({ estado: 'resolvida' })
      .expect(200);
    expect(r.body).toMatchObject({
      id: original.id,
      estado: 'resolvida',
      resolvida_em: expect.any(String),
      avisados: 2,
    });

    // O worker do pg-boss envia os dois SMS.
    for (const telefone of [chamadaA.telefone, chamadaB.telefone]) {
      const sms = await esperarAte(async () => {
        const lista = await smsPara(ctx, telefone, 'ocorrencia');
        return lista.find(
          (s) => s.corpo.includes('foi resolvida') && s.estado === 'enviada',
        );
      });
      expect(sms.corpo).toContain(original.numero);
      expect(sms.corpo).toContain('Foi reportada por 2 pessoas');
    }

    // O duplicado fecha com o original.
    const d = await linha(
      ctx.db,
      'SELECT resolvida_em FROM ocorrencias WHERE id = $1',
      [duplicadoId],
    );
    expect(d.resolvida_em).not.toBeNull();

    // Reabrir e voltar a resolver não repete o SMS.
    await ctx
      .http()
      .patch(`/v1/painel/ocorrencias/${original.id}`)
      .set(painel)
      .send({ estado: 'com_equipa' })
      .expect(200);
    const outra = await ctx
      .http()
      .patch(`/v1/painel/ocorrencias/${original.id}`)
      .set(painel)
      .send({ estado: 'resolvida' })
      .expect(200);
    expect(outra.body.avisados).toBe(2);
    for (const telefone of [chamadaA.telefone, chamadaB.telefone]) {
      const resolvidas = (await smsPara(ctx, telefone, 'ocorrencia')).filter(
        (s) => s.corpo.includes('foi resolvida'),
      );
      expect(resolvidas).toHaveLength(1);
    }

    // Já fechada: o estado diz-se resolvida ao munícipe.
    const estado = await ferramenta(ctx, novaChamada(), 'estado_ocorrencia', {
      numero: original.numero,
    }).expect(200);
    expect(estado.body.ocorrencias[0].estado).toBe('resolvida');
  });

  it('uma ocorrência resolvida já não recebe duplicados', async () => {
    const r = await registar(novaChamada(), {
      categoria: 'Buraco na via',
      descricao: 'Voltou a abrir o buraco no mesmo sítio.',
      morada: moradaA,
    });
    expect(r.body).toMatchObject({ registada: true, duplicada: false });
    expect(r.body.numero).not.toBe(original.numero);
  });
});
