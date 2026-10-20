/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import {
  arrancarApp,
  Contexto,
  conversaId,
  ferramenta,
  linha,
  MUNICIPIO,
  novaChamada,
} from './app';

/** Base: saúde, catálogo das ferramentas, guardas e formato dos erros. */
describe('Base (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  it('GET /v1/saude responde com a BD ligada e sem IA', async () => {
    const r = await ctx.http().get('/v1/saude').expect(200);
    expect(r.body).toEqual({ ok: true, bd: true, ia: false });
  });

  it('o catálogo tem todas as ferramentas, em JSON Schema', async () => {
    const r = await ctx
      .http()
      .get('/v1/agent/tools')
      .set('X-Agente-Segredo', 'segredo-e2e')
      .expect(200);
    const nomes = (r.body.ferramentas as { nome: string }[]).map((f) => f.nome);
    expect(nomes).toEqual(
      expect.arrayContaining([
        'procurar_conhecimento',
        'encaminhar',
        'identificar_municipe',
        'passar_a_humano',
        'emergencia',
        'iniciar_requerimento',
        'preencher_campo',
        'concluir_requerimento',
        'estado_processo',
        'registar_ocorrencia',
        'estado_ocorrencia',
        'simular_taxa',
        'criar_pagamento',
        'ver_vagas',
        'marcar',
        'cancelar_marcacao',
        'agendar_recolha',
        'redigir',
        'conversa_anterior',
        'nao_quero_chamadas',
        'motivo_da_chamada',
      ]),
    );
    expect(new Set(nomes).size).toBe(nomes.length);
    for (const f of r.body.ferramentas) {
      expect(f).toMatchObject({
        metodo: 'POST',
        caminho: `/v1/agent/tools/${f.nome}`,
        descricao: expect.any(String),
        entrada: expect.objectContaining({ type: 'object' }),
      });
    }
  });

  it('segredo do agente errado ou em falta → 401 nao_autenticado', async () => {
    const errado = await ctx
      .http()
      .post('/v1/agent/tools/encaminhar')
      .set({ 'X-Agente-Segredo': 'errado', 'X-Municipio': MUNICIPIO })
      .send({ assunto: 'Estou sem água' })
      .expect(401);
    expect(errado.body.erro.codigo).toBe('nao_autenticado');

    const semSegredo = await ctx.http().get('/v1/agent/tools').expect(401);
    expect(semSegredo.body.erro.codigo).toBe('nao_autenticado');
  });

  it('sem X-Municipio → 400 municipio_em_falta', async () => {
    const r = await ctx
      .http()
      .post('/v1/agent/tools/encaminhar')
      .set('X-Agente-Segredo', 'segredo-e2e')
      .send({ assunto: 'Estou sem água' })
      .expect(400);
    expect(r.body.erro.codigo).toBe('municipio_em_falta');
  });

  it('ferramenta inexistente → 404 ferramenta_desconhecida, sem criar conversa', async () => {
    const chamada = novaChamada();
    const r = await ferramenta(ctx, chamada, 'nao_existe', {}).expect(404);
    expect(r.body.erro.codigo).toBe('ferramenta_desconhecida');
    const c = await linha(
      ctx.db,
      'SELECT 1 FROM conversas WHERE provider_id = $1',
      [chamada.conversa],
    );
    expect(c).toBeUndefined();
  });

  it('erro de validação: 400 pedido_invalido com os campos', async () => {
    const r = await ferramenta(ctx, novaChamada(), 'passar_a_humano', {
      motivo: 'nao_e_motivo',
      resumo: 'curto',
    }).expect(400);
    expect(r.body).toEqual({
      erro: {
        codigo: 'pedido_invalido',
        mensagem: expect.any(String),
        detalhes: {
          campos: expect.arrayContaining([
            expect.objectContaining({ campo: 'motivo' }),
            expect.objectContaining({ campo: 'resumo' }),
          ]),
        },
      },
    });
  });

  it('Idempotency-Key: a mesma chave devolve a mesma resposta e não repete o efeito', async () => {
    const chamada = novaChamada();
    const chave = `idem-${randomUUID()}`;
    const corpo = {
      motivo: 'pedido',
      resumo: 'Quer falar com uma pessoa sobre a obra na Rua Direita.',
    };
    const pedir = () =>
      ferramenta(ctx, chamada, 'passar_a_humano', corpo).set(
        'Idempotency-Key',
        chave,
      );
    const a = await pedir().expect(200);
    const b = await pedir().expect(200);
    expect(b.body).toEqual(a.body);

    const id = await conversaId(ctx, chamada.conversa);
    const n = await linha<{ n: number }>(
      ctx.db,
      'SELECT count(*)::int AS n FROM passagens_humano WHERE conversa_id = $1',
      [id],
    );
    expect(n?.n).toBe(1);

    // A mesma chave noutra rota é recusada.
    const outra = await ferramenta(ctx, chamada, 'encaminhar', {
      assunto: 'Estou sem água',
    })
      .set('Idempotency-Key', chave)
      .expect(422);
    expect(outra.body.erro.codigo).toBe('chave_reutilizada');
  });
});
