/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  headersAgente,
  novaChamada,
} from './app';

/**
 * "Testar uma lei antes de a aprovar" no PDM: as regras propostas de uma
 * zona contra as perguntas já feitas nessa zona, sem gravar.
 */
describe('Ordenamento: simular regras de uma zona (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  const RESIDENCIAL = 'Rua da Simulação 3';
  // Um município só para este teste: as zonas de demonstração não mexem
  // nos outros e2e (que contam com o município de teste sem PDM).
  const MUN = randomUUID();
  const SLUG = `pdm-sim-${MUN.slice(0, 8)}`;

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

  beforeAll(async () => {
    ctx = await arrancarApp();
    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Simulação PDM')`,
      [MUN, SLUG],
    );
    chefe = await utilizador('chefe_divisao');
    tecnico = await utilizador('tecnico');
    ctx.geo.moradas.set(RESIDENCIAL, { lat: 41.45, lng: -8.305 });
    await ctx
      .http()
      .post('/v1/painel/ordenamento/demonstracao')
      .set(chefe)
      .expect(201);
  });
  afterAll(() => ctx.fechar());

  it('anexos perguntados ao agente: baixar o limite da comunicação prévia mostra quem passava a precisar de licença', async () => {
    for (const area of [8, 25]) {
      const r = await perguntar({
        morada: RESIDENCIAL,
        obra: 'anexo',
        area_m2: area,
        altura_m: 2,
      }).expect(200);
      expect(r.body.zona).toMatchObject({ codigo: 'ERC' });
    }
    const painel = await ctx
      .http()
      .get('/v1/painel/ordenamento')
      .set(chefe)
      .expect(200);
    const erc = painel.body.zonas.find(
      (z: { codigo: string }) => z.codigo === 'ERC',
    );
    const propostas = {
      ...erc.regras,
      anexo: {
        ...erc.regras.anexo,
        degraus: [
          { controlo: 'isento', area_max_m2: 10, altura_max_m: 2.2 },
          { controlo: 'comunicacao_previa', area_max_m2: 20, altura_max_m: 3 },
        ],
      },
    };
    const r = await ctx
      .http()
      .post(`/v1/painel/ordenamento/zonas/${erc.id}/simular`)
      .set(chefe)
      .send({ regras: propostas })
      .expect(200);
    expect(r.body).toMatchObject({
      zona: { codigo: 'ERC', demonstracao: true },
      total: 2,
      mudam: 1,
      deixam_de_ser_aprovados: 1,
      passam_a_ser_aprovados: 0,
      exemplos: [
        {
          antes: { decisao: 'precisa de uma comunicação prévia' },
          depois: { decisao: 'precisa de licença' },
        },
      ],
    });

    // Nada ficou gravado.
    const depois = await ctx
      .http()
      .get('/v1/painel/ordenamento')
      .set(chefe)
      .expect(200);
    expect(
      depois.body.zonas.find((z: { codigo: string }) => z.codigo === 'ERC')
        .regras,
    ).toEqual(erc.regras);

    // Regras inválidas, zona desconhecida e permissões.
    await ctx
      .http()
      .post(`/v1/painel/ordenamento/zonas/${erc.id}/simular`)
      .set(chefe)
      .send({ regras: { anexo: { degraus: [], acima: 'talvez' } } })
      .expect(400);
    await ctx
      .http()
      .post(
        '/v1/painel/ordenamento/zonas/00000000-0000-0000-0000-000000000000/simular',
      )
      .set(chefe)
      .send({ regras: propostas })
      .expect(404);
    await ctx
      .http()
      .post(`/v1/painel/ordenamento/zonas/${erc.id}/simular`)
      .set(tecnico)
      .send({ regras: propostas })
      .expect(403);
  });
});
