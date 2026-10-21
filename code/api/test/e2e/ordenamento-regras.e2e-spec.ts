/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  headersAgente,
  linha,
  linhas,
  novaChamada,
} from './app';

/**
 * Mudar as regras de uma zona do PDM: grava, o agente passa logo a
 * responder com elas, fica na auditoria; e as perguntas de demonstração
 * para a simulação ter dados.
 */
describe('Ordenamento: gravar as regras de uma zona (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  const MORADA = 'Rua das Regras Novas 7';
  const MUN = randomUUID();
  const SLUG = `pdm-reg-${MUN.slice(0, 8)}`;

  async function utilizador(perfil: string) {
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        MUN,
        `${perfil}-${id.slice(0, 8)}@teste.pt`,
        `Teste ${perfil}`,
        perfil,
      ],
    );
    return entrarPainel(ctx, id);
  }

  const perguntar = (corpo: object) =>
    ctx
      .http()
      .post('/v1/agent/tools/o_que_posso_fazer')
      .set({ ...headersAgente(novaChamada('pdm')), 'X-Municipio': SLUG })
      .send(corpo);

  const painel = async () =>
    (await ctx.http().get('/v1/painel/ordenamento').set(chefe).expect(200))
      .body;
  const zonaDe = (p: any, codigo: string) =>
    p.zonas.find((z: { codigo: string }) => z.codigo === codigo);

  beforeAll(async () => {
    ctx = await arrancarApp();
    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Regras PDM')`,
      [MUN, SLUG],
    );
    chefe = await utilizador('chefe_divisao');
    tecnico = await utilizador('tecnico');
    ctx.geo.moradas.set(MORADA, { lat: 41.45, lng: -8.305 });
  });
  afterAll(() => ctx.fechar());

  it('sem zonas não há perguntas de demonstração', async () => {
    await ctx
      .http()
      .post('/v1/painel/ordenamento/consultas/demonstracao')
      .set(chefe)
      .expect(409);
    await ctx
      .http()
      .post('/v1/painel/ordenamento/demonstracao')
      .set(chefe)
      .expect(201);
  });

  it('grava as regras do anexo e o agente usa-as logo; fica na auditoria', async () => {
    // Antes: anexo de 25 m² no residencial é comunicação prévia.
    const antes = await perguntar({
      morada: MORADA,
      obra: 'anexo',
      area_m2: 25,
      altura_m: 2,
    }).expect(200);
    expect(antes.body).toMatchObject({
      controlo: 'comunicacao_previa',
      zona: { codigo: 'ERC' },
    });

    const erc = zonaDe(await painel(), 'ERC');
    expect(erc.perguntas).toEqual({ total: 1, demonstracao: 0 });
    const regras = {
      ...erc.regras,
      anexo: {
        degraus: [
          { controlo: 'isento', area_max_m2: 10, altura_max_m: 2.2 },
          { controlo: 'comunicacao_previa', area_max_m2: 20, altura_max_m: 3 },
        ],
        acima: 'licenca',
        notas: ['Limite baixado para 20 m² (teste).'],
      },
    };
    const r = await ctx
      .http()
      .put(`/v1/painel/ordenamento/zonas/${erc.id}/regras`)
      .set(chefe)
      .send({ regras, descricao: 'Bairros à volta do centro.' })
      .expect(200);
    expect(r.body).toMatchObject({
      codigo: 'ERC',
      nome: erc.nome,
      descricao: 'Bairros à volta do centro.',
      demonstracao: true,
      regras: { anexo: { degraus: [{}, { area_max_m2: 20 }] } },
    });

    // O agente responde já com a regra nova.
    const depois = await perguntar({
      morada: MORADA,
      obra: 'anexo',
      area_m2: 25,
      altura_m: 2,
    }).expect(200);
    expect(depois.body).toMatchObject({
      controlo: 'licenca',
      notas: ['Limite baixado para 20 m² (teste).'],
    });
    expect(zonaDe(await painel(), 'ERC').regras.anexo.degraus[1]).toEqual({
      controlo: 'comunicacao_previa',
      area_max_m2: 20,
      altura_max_m: 3,
    });

    const a = await linha(
      ctx.db,
      `SELECT dados FROM audit_log
       WHERE municipio_id = $1 AND acao = 'mudar_regras_zona' AND objeto_id = $2`,
      [MUN, erc.id],
    );
    expect(a.dados).toMatchObject({
      codigo: 'ERC',
      antes: {
        regras: { anexo: { degraus: [{}, { area_max_m2: 30 }] } },
        descricao: erc.descricao,
      },
      depois: {
        regras: { anexo: { degraus: [{}, { area_max_m2: 20 }] } },
        descricao: 'Bairros à volta do centro.',
      },
    });
    expect(a.dados.antes.nome).toBeUndefined();

    // Desligar a marca de demonstração quando os valores forem os do PDM.
    const real = await ctx
      .http()
      .put(`/v1/painel/ordenamento/zonas/${erc.id}/regras`)
      .set(chefe)
      .send({
        regras,
        demonstracao: false,
        fonte: { titulo: 'PDM de Guimarães, art. 20.º' },
      })
      .expect(200);
    expect(real.body).toMatchObject({
      demonstracao: false,
      fonte: { titulo: 'PDM de Guimarães, art. 20.º', artigo: null, url: null },
    });
  });

  it('regras inválidas (400), zona desconhecida (404) e permissões (403)', async () => {
    const erc = zonaDe(await painel(), 'ERC');
    await ctx
      .http()
      .put(`/v1/painel/ordenamento/zonas/${erc.id}/regras`)
      .set(chefe)
      .send({ regras: { anexo: { degraus: [], acima: 'talvez' } } })
      .expect(400);
    await ctx
      .http()
      .put(`/v1/painel/ordenamento/zonas/${erc.id}/regras`)
      .set(chefe)
      .send({ regras: { garagem: { degraus: [], acima: 'licenca' } } })
      .expect(400);
    await ctx
      .http()
      .put(
        '/v1/painel/ordenamento/zonas/00000000-0000-0000-0000-000000000000/regras',
      )
      .set(chefe)
      .send({ regras: erc.regras })
      .expect(404);
    await ctx
      .http()
      .put(`/v1/painel/ordenamento/zonas/${erc.id}/regras`)
      .set(tecnico)
      .send({ regras: erc.regras })
      .expect(403);
    await ctx
      .http()
      .post('/v1/painel/ordenamento/consultas/demonstracao')
      .set(tecnico)
      .expect(403);
  });

  it('perguntas de demonstração: dentro das zonas, marcadas, só uma vez, e a simulação usa-as', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/ordenamento/consultas/demonstracao')
      .set(chefe)
      .expect(201);
    expect(r.body.criadas).toBeGreaterThan(50);
    expect(r.body.ja_havia).toBe(0);

    // Só uma vez.
    const outra = await ctx
      .http()
      .post('/v1/painel/ordenamento/consultas/demonstracao')
      .set(chefe)
      .expect(201);
    expect(outra.body).toEqual({ criadas: 0, ja_havia: r.body.criadas });

    const p = await painel();
    const total = p.zonas.reduce(
      (s: number, z: any) => s + z.perguntas.demonstracao,
      0,
    );
    expect(total).toBe(r.body.criadas);
    for (const codigo of ['CH', 'ERC', 'EA', 'EF']) {
      expect(zonaDe(p, codigo).perguntas.demonstracao).toBeGreaterThan(0);
    }
    expect(
      p.consultas.filter((q: any) => q.demonstracao).length,
    ).toBeGreaterThan(0);

    // A resposta guardada é a das regras em vigor, marcada demonstração.
    const lista = await linhas<{ resultado: any; zona: string }>(
      ctx.db,
      `SELECT q.resultado, z.codigo AS zona FROM consultas_pdm q JOIN zonas_pdm z ON z.id = q.zona_id
       WHERE q.municipio_id = $1 AND q.resultado->>'demonstracao' = 'true'`,
      [MUN],
    );
    expect(lista.length).toBe(r.body.criadas);
    for (const l of lista) expect(l.resultado.zona.codigo).toBe(l.zona);

    // Simular: as perguntas de demonstração contam e há mudanças.
    const erc = zonaDe(p, 'ERC');
    const sim = await ctx
      .http()
      .post(`/v1/painel/ordenamento/zonas/${erc.id}/simular`)
      .set(chefe)
      .send({
        regras: {
          ...erc.regras,
          anexo: { degraus: [], acima: 'licenca', notas: [] },
          muro: { degraus: [], acima: 'licenca', notas: [] },
        },
      })
      .expect(200);
    expect(sim.body.total).toBe(erc.perguntas.total);
    expect(sim.body.pedidos_de_demonstracao).toBe(erc.perguntas.demonstracao);
    expect(sim.body.deixam_de_ser_aprovados).toBeGreaterThan(0);
    expect(sim.body.exemplos[0].demonstracao).toBe(true);
  });
});
