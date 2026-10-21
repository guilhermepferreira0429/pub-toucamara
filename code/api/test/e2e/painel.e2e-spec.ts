/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import {
  arrancarApp,
  CHEFE_ID,
  Contexto,
  criarLinkMagico,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
} from './app';

/** Painel: sessão, permissões, visão geral, equipa, agente, relatórios, conhecimento e gate. */

/*
 * Entidades, contacto e serviço próprios: os ids do seed ('0000...e1') não
 * são UUID RFC 9562 e o `z.uuid()` dos corpos recusa-os (400).
 */
const ENTIDADE_CAMARA = randomUUID();
const ENTIDADE_AGUAS = randomUUID();
const CONTACTO_AGUAS = randomUUID();
const SERVICO = randomUUID();
/** A regra do seed (Águas do Concelho), só para comparar respostas. */
const SEED_AGUAS = '00000000-0000-0000-0000-0000000000e2';

/** Palavra inventada (só letras), para a pesquisa por texto só achar o que é deste teste. */
function palavraUnica(): string {
  let s = 'zq';
  for (let i = 0; i < 8; i++) s += String.fromCharCode(97 + randomInt(0, 26));
  return s;
}

/** `.expect(estado(201))`: como `.expect(201)`, mas com o corpo no erro. */
function estado(esperado: number) {
  return (r: { status: number; body: unknown }) => {
    if (r.status !== esperado) {
      throw new Error(
        `Esperava ${esperado}, veio ${r.status}: ${JSON.stringify(r.body)}`,
      );
    }
  };
}

/** Entradas da auditoria de um objeto, por ordem. */
function auditoria(ctx: Contexto, objetoId: string, acao?: string) {
  return linhas<{
    acao: string;
    ator_id: string;
    dados: Record<string, any>;
  }>(
    ctx.db,
    `SELECT acao, ator_id, dados FROM audit_log
     WHERE objeto_id = $1 AND ($2::text IS NULL OR acao = $2)
     ORDER BY em, id`,
    [objetoId, acao ?? null],
  );
}

describe('Painel (e2e)', () => {
  let ctx: Contexto;
  /** Chefe de divisão próprio deste ficheiro (o do seed fica intacto). */
  let chefeId: string;
  let chefe: Record<string, string>;
  let atendimento: Record<string, string>;
  let interno: Record<string, string>;
  let internoId: string;
  let agenteOriginal: Record<string, any>;
  let pronunciasOriginais: { termo: string; como_se_diz: string }[];

  beforeAll(async () => {
    ctx = await arrancarApp();
    await ctx.db.query(
      `INSERT INTO entidades (id, municipio_id, nome, tipo, descricao) VALUES
         ($1, $3, 'Câmara (painel e2e)', 'camara', 'Câmara'),
         ($2, $3, 'Águas (painel e2e)', 'empresa_municipal', 'Água')`,
      [ENTIDADE_CAMARA, ENTIDADE_AGUAS, MUNICIPIO_ID],
    );
    await ctx.db.query(
      `INSERT INTO entidade_contactos (id, entidade_id, tipo, rotulo, valor, horario)
       VALUES ($1, $2, 'avarias', 'Avarias', '800 111 222', '{"sempre":true}')`,
      [CONTACTO_AGUAS, ENTIDADE_AGUAS],
    );
    await ctx.db.query(
      `INSERT INTO servicos (id, municipio_id, entidade_id, nome)
       VALUES ($1, $2, $3, 'Obras (painel e2e)')`,
      [SERVICO, MUNICIPIO_ID, ENTIDADE_CAMARA],
    );
    chefeId = await criarUtilizador(ctx, 'chefe_divisao');
    chefe = await entrarPainel(ctx, chefeId);
    atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    internoId = await criarUtilizador(ctx, 'equipa_toucamara');
    interno = await entrarPainel(ctx, internoId);
    // O agente é partilhado pelos ficheiros: guarda-se para repor no fim.
    agenteOriginal = (await linha(
      ctx.db,
      `SELECT nome, voz_id, saudacao, trata_por, idiomas, versao
       FROM agente_config WHERE municipio_id = $1`,
      [MUNICIPIO_ID],
    ))!;
    pronunciasOriginais = await linhas(
      ctx.db,
      'SELECT termo, como_se_diz FROM pronuncias WHERE municipio_id = $1',
      [MUNICIPIO_ID],
    );
  });

  afterAll(async () => {
    const a = agenteOriginal;
    await ctx.db.query(
      `UPDATE agente_config SET nome = $2, voz_id = $3, saudacao = $4,
              trata_por = $5, idiomas = $6, versao = $7
       WHERE municipio_id = $1`,
      [
        MUNICIPIO_ID,
        a.nome,
        a.voz_id,
        a.saudacao,
        a.trata_por,
        a.idiomas,
        a.versao,
      ],
    );
    await ctx.db.query('DELETE FROM pronuncias WHERE municipio_id = $1', [
      MUNICIPIO_ID,
    ]);
    for (const p of pronunciasOriginais) {
      await ctx.db.query(
        'INSERT INTO pronuncias (municipio_id, termo, como_se_diz) VALUES ($1, $2, $3)',
        [MUNICIPIO_ID, p.termo, p.como_se_diz],
      );
    }
    await ctx.fechar();
  });

  /* ---------------------------------------------------------------- */
  /* Sessão                                                            */
  /* ---------------------------------------------------------------- */

  describe('sessão (link mágico)', () => {
    it('entrar com o token → 200 e JWT; o mesmo token outra vez → 401 link_invalido', async () => {
      const token = await criarLinkMagico(ctx, CHEFE_ID);
      const r = await ctx
        .http()
        .post('/v1/painel/auth/entrar')
        .send({ token })
        .expect(200);
      expect(r.body).toEqual({
        token: expect.stringMatching(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        expira_em: expect.any(String),
        utilizador: expect.objectContaining({
          id: CHEFE_ID,
          perfil: 'chefe_divisao',
          municipioId: MUNICIPIO_ID,
        }),
      });
      // 12 h (JWT_VALIDADE_HORAS do ambiente).
      const horas = (Date.parse(r.body.expira_em) - Date.now()) / 3_600_000;
      expect(horas).toBeGreaterThan(11.9);
      expect(horas).toBeLessThanOrEqual(12);

      const usado = await linha(
        ctx.db,
        'SELECT usado_em FROM links_magicos WHERE token_hash = $1',
        [createHash('sha256').update(token).digest()],
      );
      expect(usado?.usado_em).not.toBeNull();
      const entradas = await auditoria(ctx, CHEFE_ID, 'entrar');
      expect(entradas.length).toBeGreaterThan(0);

      const outra = await ctx
        .http()
        .post('/v1/painel/auth/entrar')
        .send({ token })
        .expect(401);
      expect(outra.body.erro.codigo).toBe('link_invalido');
    });

    it('token desconhecido → 401 link_invalido; curto → 400 pedido_invalido', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/auth/entrar')
        .send({ token: randomBytes(24).toString('base64url') })
        .expect(401);
      expect(r.body.erro.codigo).toBe('link_invalido');

      const curto = await ctx
        .http()
        .post('/v1/painel/auth/entrar')
        .send({ token: 'abc' })
        .expect(400);
      expect(curto.body.erro.codigo).toBe('pedido_invalido');
    });

    it('link expirado → 401 link_invalido', async () => {
      const token = randomBytes(24).toString('base64url');
      await ctx.db.query(
        `INSERT INTO links_magicos (utilizador_id, token_hash, expira_em)
         VALUES ($1, $2, now() - interval '1 minute')`,
        [chefeId, createHash('sha256').update(token).digest()],
      );
      const r = await ctx
        .http()
        .post('/v1/painel/auth/entrar')
        .send({ token })
        .expect(401);
      expect(r.body.erro.codigo).toBe('link_invalido');
    });

    it('GET /painel/auth/eu: utilizador, município e permissões do perfil', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/auth/eu')
        .set(chefe)
        .expect(200);
      expect(r.body.utilizador).toMatchObject({
        id: chefeId,
        perfil: 'chefe_divisao',
        foto_url: null,
      });
      expect(r.body.municipio).toMatchObject({
        id: MUNICIPIO_ID,
        slug: 'teste',
      });
      expect(r.body.permissoes).toEqual({
        visao_geral: true,
        conversas: true,
        gravacoes: true,
        entrada: true,
        processos: true,
        ocorrencias_ver: true,
        ocorrencias: true,
        indicadores: true,
        conhecimento_ver: true,
        conhecimento: true,
        equipa: true,
        agente: true,
        acao_social: true,
        procedimentos_ver: true,
        procedimentos: true,
        reclamacoes: true,
        reunioes: true,
        contratacao: true,
        transparencia: true,
      });

      const a = await ctx
        .http()
        .get('/v1/painel/auth/eu')
        .set(atendimento)
        .expect(200);
      expect(a.body.permissoes).toMatchObject({
        visao_geral: true,
        processos: false,
        indicadores: false,
        conhecimento_ver: true,
        conhecimento: false,
        equipa: false,
        agente: false,
        contratacao: false,
      });
    });

    it('GET /painel/auth/eu: o município traz a linha e o horário do balcão', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/auth/eu')
        .set(atendimento)
        .expect(200);
      expect(r.body.municipio).toMatchObject({
        id: MUNICIPIO_ID,
        telefone_linha: '+351253000000',
        horario_balcao: {
          sempre: expect.any(Boolean),
          dias: {
            seg: expect.any(Array),
            ter: expect.any(Array),
            qua: expect.any(Array),
            qui: expect.any(Array),
            sex: expect.any(Array),
            sab: expect.any(Array),
            dom: expect.any(Array),
          },
        },
      });
      for (const intervalos of Object.values(
        r.body.municipio.horario_balcao.dias as Record<string, string[][]>,
      )) {
        for (const [i, f] of intervalos) {
          expect(i).toMatch(/^\d{2}:\d{2}$/);
          expect(f).toMatch(/^\d{2}:\d{2}$/);
        }
      }
    });

    it('sem sessão ou com JWT inválido → 401 nao_autenticado', async () => {
      const sem = await ctx.http().get('/v1/painel/auth/eu').expect(401);
      expect(sem.body.erro.codigo).toBe('nao_autenticado');
      const lixo = await ctx
        .http()
        .get('/v1/painel/visao-geral')
        .set('Authorization', 'Bearer nao.e.jwt')
        .expect(401);
      expect(lixo.body.erro.codigo).toBe('nao_autenticado');
      const basic = await ctx
        .http()
        .get('/v1/painel/visao-geral')
        .set('Authorization', 'Basic xyz')
        .expect(401);
      expect(basic.body.erro.codigo).toBe('nao_autenticado');
    });

    it('POST /painel/auth/link: 204 exista ou não o email; só cria link para quem existe', async () => {
      const id = await criarUtilizador(ctx, 'tecnico');
      const u = await linha<{ email: string }>(
        ctx.db,
        'SELECT email FROM utilizadores WHERE id = $1',
        [id],
      );
      const r = await ctx
        .http()
        .post('/v1/painel/auth/link')
        .send({ email: u!.email.toUpperCase() })
        .expect(204);
      expect(r.text).toBe('');
      const links = await linhas(
        ctx.db,
        'SELECT 1 FROM links_magicos WHERE utilizador_id = $1 AND usado_em IS NULL',
        [id],
      );
      expect(links).toHaveLength(1);

      const antes = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM links_magicos',
      );
      const nada = await ctx
        .http()
        .post('/v1/painel/auth/link')
        .send({ email: `ninguem-${randomUUID()}@teste.pt` })
        .expect(204);
      expect(nada.text).toBe('');
      const depois = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM links_magicos',
      );
      expect(depois?.n).toBe(antes?.n);

      const invalido = await ctx
        .http()
        .post('/v1/painel/auth/link')
        .send({ email: 'nao-e-email' })
        .expect(400);
      expect(invalido.body.erro.codigo).toBe('pedido_invalido');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Permissões                                                        */
  /* ---------------------------------------------------------------- */

  it('perfil atendimento em /painel/processos → 403 sem_permissao', async () => {
    const r = await ctx
      .http()
      .get('/v1/painel/processos')
      .set(atendimento)
      .expect(403);
    expect(r.body.erro).toEqual({
      codigo: 'sem_permissao',
      mensagem: expect.any(String),
      detalhes: { recurso: 'processos' },
    });
    const eq = await ctx
      .http()
      .get('/v1/painel/equipa')
      .set(atendimento)
      .expect(403);
    expect(eq.body.erro.detalhes).toEqual({ recurso: 'equipa' });
  });

  /* ---------------------------------------------------------------- */
  /* Visão geral e indicadores                                         */
  /* ---------------------------------------------------------------- */

  describe('visão geral e indicadores', () => {
    it('GET /painel/visao-geral: últimos 7 dias por omissão, com melhorias_portal', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/visao-geral')
        .set(chefe)
        .expect(200);
      expect(Object.keys(r.body).sort()).toEqual(
        [
          'atencao',
          'indicadores',
          'melhorias_portal',
          'o_que_perguntam',
          'periodo',
          'periodo_anterior',
          'quando_ligam',
          'trabalho_semana',
        ].sort(),
      );
      const { de, ate } = r.body.periodo;
      expect((Date.parse(ate) - Date.parse(de)) / 864e5).toBe(6);
      expect(r.body.melhorias_portal).toEqual({
        propostas: expect.any(Number),
        enviadas: expect.any(Number),
        publicadas: expect.any(Number),
        rejeitadas: expect.any(Number),
        perguntas_resolvidas: expect.any(Number),
        vezes_resolvidas: expect.any(Number),
      });
    });

    it('melhorias_portal conta as propostas do período pedido', async () => {
      const titulo = `Horário do ecocentro ${randomUUID()}`;
      await ctx.db.query(
        `INSERT INTO melhorias_portal (municipio_id, titulo, o_que_falta, sugestao, criada_em)
         VALUES ($1, $2, 'O horário ao fim de semana', 'Abre ao sábado [a confirmar pela câmara]', '2019-03-15 12:00+00')`,
        [MUNICIPIO_ID, titulo],
      );
      const r = await ctx
        .http()
        .get('/v1/painel/visao-geral?de=2019-03-15&ate=2019-03-15')
        .set(chefe)
        .expect(200);
      expect(r.body.periodo).toEqual({ de: '2019-03-15', ate: '2019-03-15' });
      expect(r.body.periodo_anterior).toEqual({
        de: '2019-03-14',
        ate: '2019-03-14',
      });
      expect(r.body.melhorias_portal.propostas).toBe(1);
    });

    it('período inválido → 400 periodo_invalido; demasiado longo → 400 periodo_demasiado_longo', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/visao-geral?de=2026-02-10&ate=2026-02-01')
        .set(chefe)
        .expect(400);
      expect(r.body.erro.codigo).toBe('periodo_invalido');
      const longo = await ctx
        .http()
        .get('/v1/painel/indicadores?de=2024-01-01&ate=2026-01-01')
        .set(chefe)
        .expect(400);
      expect(longo.body.erro.codigo).toBe('periodo_demasiado_longo');
    });

    it('GET /painel/indicadores: séries por dia e por semana', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/indicadores?de=2026-09-01&ate=2026-09-07')
        .set(chefe)
        .expect(200);
      expect(r.body).toMatchObject({
        periodo: { de: '2026-09-01', ate: '2026-09-07' },
        agrupar: 'dia',
        totais: expect.objectContaining({
          por_canal: expect.any(Object),
          sms: expect.objectContaining({ enviados: expect.any(Number) }),
          ocorrencias: expect.objectContaining({
            abertas_agora: expect.any(Number),
          }),
        }),
        processos: expect.anything(),
      });
      expect(Array.isArray(r.body.series)).toBe(true);
      expect(r.body.series).toHaveLength(7);

      const sem = await ctx
        .http()
        .get(
          '/v1/painel/indicadores?de=2026-09-01&ate=2026-09-30&agrupar=semana',
        )
        .set(chefe)
        .expect(200);
      expect(sem.body.agrupar).toBe('semana');
      // Segundas-feiras de 31/08 a 28/09.
      expect(sem.body.series).toHaveLength(5);

      const proibido = await ctx
        .http()
        .get('/v1/painel/indicadores')
        .set(atendimento)
        .expect(403);
      expect(proibido.body.erro.codigo).toBe('sem_permissao');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Equipa e RGPD                                                     */
  /* ---------------------------------------------------------------- */

  describe('equipa e acessos', () => {
    it('listar, convidar (com link mágico), alterar e desativar', async () => {
      const lista = await ctx
        .http()
        .get('/v1/painel/equipa')
        .set(chefe)
        .expect(200);
      expect(lista.body.itens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: CHEFE_ID,
            email: 'chefe@teste.pt',
            perfil: 'chefe_divisao',
            ativo: true,
          }),
        ]),
      );

      const email = `novo-${randomUUID().slice(0, 8)}@teste.pt`;
      const c = await ctx
        .http()
        .post('/v1/painel/equipa')
        .set(chefe)
        .send({
          email: email.toUpperCase(),
          nome: 'Técnica Nova',
          perfil: 'tecnico',
          servico_id: SERVICO,
        })
        .expect(estado(201));
      expect(c.body).toMatchObject({
        email,
        nome: 'Técnica Nova',
        perfil: 'tecnico',
        servico: 'Obras (painel e2e)',
        ativo: true,
      });
      const novoId = c.body.id as string;
      const u = await linha(
        ctx.db,
        'SELECT municipio_id, perfil::text AS perfil FROM utilizadores WHERE id = $1',
        [novoId],
      );
      expect(u).toEqual({ municipio_id: MUNICIPIO_ID, perfil: 'tecnico' });
      const links = await linhas(
        ctx.db,
        'SELECT 1 FROM links_magicos WHERE utilizador_id = $1',
        [novoId],
      );
      expect(links).toHaveLength(1);
      const conv = await auditoria(ctx, novoId, 'convidar');
      expect(conv).toEqual([
        expect.objectContaining({
          ator_id: chefeId,
          dados: expect.objectContaining({ email, perfil: 'tecnico' }),
        }),
      ]);

      const repetido = await ctx
        .http()
        .post('/v1/painel/equipa')
        .set(chefe)
        .send({ email, nome: 'Outra', perfil: 'tecnico' })
        .expect(409);
      expect(repetido.body.erro.codigo).toBe('email_ja_existe');

      const admin = await ctx
        .http()
        .post('/v1/painel/equipa')
        .set(chefe)
        .send({ email: `x-${email}`, nome: 'Admin', perfil: 'admin' })
        .expect(400);
      expect(admin.body.erro.codigo).toBe('pedido_invalido');

      const servicoAlheio = await ctx
        .http()
        .post('/v1/painel/equipa')
        .set(chefe)
        .send({
          email: `y-${email}`,
          nome: 'Sem serviço',
          perfil: 'tecnico',
          servico_id: randomUUID(),
        })
        .expect(422);
      expect(servicoAlheio.body.erro.codigo).toBe('servico_desconhecido');

      // A nova técnica entra e trabalha; depois de desativada, a sessão cai.
      const sessao = await entrarPainel(ctx, novoId);
      await ctx.http().get('/v1/painel/auth/eu').set(sessao).expect(200);

      const p = await ctx
        .http()
        .patch(`/v1/painel/equipa/${novoId}`)
        .set(chefe)
        .send({ perfil: 'vereador', servico_id: null })
        .expect(200);
      expect(p.body).toMatchObject({
        id: novoId,
        perfil: 'vereador',
        servico_id: null,
      });
      const alt = await auditoria(ctx, novoId, 'alterar_acesso');
      expect(alt[0].dados).toEqual({
        antes: {
          perfil: 'tecnico',
          ativo: true,
          servico_id: SERVICO,
        },
        depois: { perfil: 'vereador', ativo: true, servico_id: null },
      });

      await ctx
        .http()
        .patch(`/v1/painel/equipa/${novoId}`)
        .set(chefe)
        .send({ ativo: false })
        .expect(200);
      const fora = await ctx
        .http()
        .get('/v1/painel/auth/eu')
        .set(sessao)
        .expect(401);
      expect(fora.body.erro.codigo).toBe('nao_autenticado');
    });

    it('ninguém se desativa a si próprio → 422; corpo vazio → 400; desconhecido → 404', async () => {
      const r = await ctx
        .http()
        .patch(`/v1/painel/equipa/${chefeId}`)
        .set(chefe)
        .send({ ativo: false })
        .expect(422);
      expect(r.body.erro.codigo).toBe('nao_pode_desativar_se');
      const ainda = await linha(
        ctx.db,
        'SELECT ativo FROM utilizadores WHERE id = $1',
        [chefeId],
      );
      expect(ainda?.ativo).toBe(true);

      const vazio = await ctx
        .http()
        .patch(`/v1/painel/equipa/${chefeId}`)
        .set(chefe)
        .send({})
        .expect(400);
      expect(vazio.body.erro.codigo).toBe('pedido_invalido');

      const nao = await ctx
        .http()
        .patch(`/v1/painel/equipa/${randomUUID()}`)
        .set(chefe)
        .send({ perfil: 'tecnico' })
        .expect(404);
      expect(nao.body.erro.codigo).toBe('utilizador_nao_encontrado');
    });

    it('GET /painel/servicos: serviços com os membros ativos, para qualquer perfil', async () => {
      const tecnicoId = await criarUtilizador(ctx, 'tecnico');
      const inativoId = await criarUtilizador(ctx, 'tecnico');
      await ctx.db.query(
        'UPDATE utilizadores SET servico_id = $2 WHERE id = ANY($1::uuid[])',
        [[tecnicoId, inativoId], SERVICO],
      );
      await ctx.db.query(
        'UPDATE utilizadores SET ativo = false WHERE id = $1',
        [inativoId],
      );
      const r = await ctx
        .http()
        .get('/v1/painel/servicos')
        .set(atendimento)
        .expect(200);
      const servico = r.body.itens.find(
        (s: { id: string }) => s.id === SERVICO,
      );
      expect(servico).toMatchObject({
        nome: 'Obras (painel e2e)',
        entidade: 'Câmara (painel e2e)',
      });
      const ids = servico.tecnicos.map((t: { id: string }) => t.id);
      expect(ids).toContain(tecnicoId);
      expect(ids).not.toContain(inativoId);
      expect(
        servico.tecnicos.find((t: { id: string }) => t.id === tecnicoId),
      ).toEqual({
        id: tecnicoId,
        nome: 'Teste tecnico',
        perfil: 'tecnico',
        foto_url: null,
      });
      expect(Array.isArray(r.body.sem_servico)).toBe(true);
      await ctx.http().get('/v1/painel/servicos').expect(401);
    });

    it('GET /painel/rgpd: políticas de retenção com a última execução', async () => {
      const r = await ctx.http().get('/v1/painel/rgpd').set(chefe).expect(200);
      expect(r.body).toHaveProperty('ultima_execucao_em');
      expect(r.body.politicas.length).toBeGreaterThan(0);
      for (const p of r.body.politicas) {
        expect(p).toMatchObject({
          objeto: expect.any(String),
          acao: expect.stringMatching(/^(apagar|anonimizar)$/),
        });
        expect(p).toHaveProperty('ultima_execucao');
      }
      const proibido = await ctx
        .http()
        .get('/v1/painel/rgpd')
        .set(atendimento)
        .expect(403);
      expect(proibido.body.erro.codigo).toBe('sem_permissao');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Agente                                                            */
  /* ---------------------------------------------------------------- */

  describe('agente', () => {
    const config = {
      nome: 'Tou E2E',
      saudacao: 'Olá, está a falar com a câmara de teste.',
      trata_por: 'você',
      idiomas: ['pt-PT', 'en'],
      voz_id: null,
      voz_nome: null,
      ritmo: 'normal',
    };

    it('GET: a câmara vê mas não edita; PUT do chefe → 403 so_equipa_interna', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/agente')
        .set(chefe)
        .expect(200);
      expect(r.body).toMatchObject({
        config: expect.objectContaining({ versao: expect.any(String) }),
        pronuncias: expect.any(Array),
        regras_encaminhamento: expect.arrayContaining([
          expect.objectContaining({ entidade_id: SEED_AGUAS }),
        ]),
        pode_editar: false,
      });
      const antes = r.body.config.versao as string;

      const put = await ctx
        .http()
        .put('/v1/painel/agente')
        .set(chefe)
        .send(config)
        .expect(403);
      expect(put.body.erro.codigo).toBe('so_equipa_interna');
      const v = await linha(
        ctx.db,
        'SELECT versao FROM agente_config WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      );
      expect(v?.versao).toBe(antes);

      const at = await ctx
        .http()
        .get('/v1/painel/agente')
        .set(atendimento)
        .expect(403);
      expect(at.body.erro.codigo).toBe('sem_permissao');
    });

    it('PUT da equipa interna grava e sobe a versão (auditado)', async () => {
      const g = await ctx
        .http()
        .get('/v1/painel/agente')
        .set(interno)
        .expect(200);
      expect(g.body.pode_editar).toBe(true);

      const r = await ctx
        .http()
        .put('/v1/painel/agente')
        .set(interno)
        .send(config)
        .expect(200);
      expect(r.body).toEqual({
        ...config,
        versao: expect.stringMatching(/^\d{4}-\d{2}-\d{2}\.\d+$/),
      });
      const bd = await linha(
        ctx.db,
        `SELECT nome, saudacao, trata_por, idiomas, versao FROM agente_config
         WHERE municipio_id = $1`,
        [MUNICIPIO_ID],
      );
      expect(bd).toEqual({
        nome: config.nome,
        saudacao: config.saudacao,
        trata_por: config.trata_por,
        idiomas: config.idiomas,
        versao: r.body.versao,
      });
      const aud = await auditoria(ctx, MUNICIPIO_ID, 'alterar_agente');
      expect(aud.at(-1)).toMatchObject({
        ator_id: internoId,
        dados: { versao: r.body.versao },
      });

      // Gravar outra vez no mesmo dia: o contador sobe.
      const r2 = await ctx
        .http()
        .put('/v1/painel/agente')
        .set(interno)
        .send(config)
        .expect(200);
      const [dia, n] = (r.body.versao as string).split('.');
      expect(r2.body.versao).toBe(`${dia}.${Number(n) + 1}`);

      const mau = await ctx
        .http()
        .put('/v1/painel/agente')
        .set(interno)
        .send({ ...config, idiomas: ['português'] })
        .expect(400);
      expect(mau.body.erro.codigo).toBe('pedido_invalido');
    });

    it('pronúncias: substitui a lista inteira; termo repetido → 400 termo_repetido', async () => {
      const itens = [
        { termo: 'RJUE', como_se_diz: 'erre jota u é' },
        { termo: 'Azurém', como_se_diz: 'azurêm' },
      ];
      const r = await ctx
        .http()
        .put('/v1/painel/agente/pronuncias')
        .set(interno)
        .send({ itens })
        .expect(200);
      expect(r.body.itens).toEqual(
        [...itens].sort((a, b) => (a.termo < b.termo ? -1 : 1)),
      );
      const g = await ctx
        .http()
        .get('/v1/painel/agente/pronuncias')
        .set(chefe)
        .expect(200);
      expect(g.body.itens).toHaveLength(2);

      const rep = await ctx
        .http()
        .put('/v1/painel/agente/pronuncias')
        .set(interno)
        .send({ itens: [...itens, { termo: 'rjue', como_se_diz: 'x' }] })
        .expect(400);
      expect(rep.body.erro.codigo).toBe('termo_repetido');
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM pronuncias WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      );
      expect(n?.n).toBe(2);

      const chefeNao = await ctx
        .http()
        .put('/v1/painel/agente/pronuncias')
        .set(chefe)
        .send({ itens: [] })
        .expect(403);
      expect(chefeNao.body.erro.codigo).toBe('so_equipa_interna');
    });

    it('regras "quem trata de quê": criar, alterar, apagar; entidade alheia → 422', async () => {
      const assunto = `Contadores partidos ${randomUUID().slice(0, 8)}`;
      const versaoAntes = (await linha(
        ctx.db,
        'SELECT versao FROM agente_config WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      ))!.versao as string;

      const c = await ctx
        .http()
        .post('/v1/painel/agente/regras')
        .set(interno)
        .send({
          assunto,
          entidade_id: ENTIDADE_AGUAS,
          contacto_id: CONTACTO_AGUAS,
          prioridade: 50,
        })
        .expect(estado(201));
      expect(c.body).toMatchObject({
        assunto,
        entidade_id: ENTIDADE_AGUAS,
        entidade: 'Águas (painel e2e)',
        contacto_id: CONTACTO_AGUAS,
        contacto_valor: '800 111 222',
        prioridade: 50,
        ativo: true,
      });
      const id = c.body.id as string;
      const versaoDepois = (await linha(
        ctx.db,
        'SELECT versao FROM agente_config WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      ))!.versao as string;
      expect(versaoDepois).not.toBe(versaoAntes);

      // Mudar de entidade sem dizer o contacto: o contacto antigo cai.
      const p = await ctx
        .http()
        .patch(`/v1/painel/agente/regras/${id}`)
        .set(interno)
        .send({ entidade_id: ENTIDADE_CAMARA, ativo: false })
        .expect(200);
      expect(p.body).toMatchObject({
        id,
        entidade_id: ENTIDADE_CAMARA,
        contacto_id: null,
        ativo: false,
      });

      const contactoAlheio = await ctx
        .http()
        .patch(`/v1/painel/agente/regras/${id}`)
        .set(interno)
        .send({ contacto_id: CONTACTO_AGUAS })
        .expect(422);
      expect(contactoAlheio.body.erro.codigo).toBe('contacto_desconhecido');

      const entidadeAlheia = await ctx
        .http()
        .post('/v1/painel/agente/regras')
        .set(interno)
        .send({ assunto, entidade_id: randomUUID() })
        .expect(422);
      expect(entidadeAlheia.body.erro.codigo).toBe('entidade_desconhecida');

      await ctx
        .http()
        .delete(`/v1/painel/agente/regras/${id}`)
        .set(interno)
        .expect(204);
      const r = await linha(
        ctx.db,
        'SELECT 1 FROM regras_encaminhamento WHERE id = $1',
        [id],
      );
      expect(r).toBeUndefined();
      const acoes = (await auditoria(ctx, id)).map((a) => a.acao);
      expect(acoes).toEqual(['criar_regra', 'alterar_regra', 'apagar_regra']);

      const outra = await ctx
        .http()
        .delete(`/v1/painel/agente/regras/${id}`)
        .set(interno)
        .expect(404);
      expect(outra.body.erro.codigo).toBe('regra_nao_encontrada');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Relatórios                                                        */
  /* ---------------------------------------------------------------- */

  describe('relatórios', () => {
    it('gerar à mão, obter, listar; sem S3 não há PDF (404 sem_pdf)', async () => {
      const g = await ctx
        .http()
        .post('/v1/painel/relatorios/gerar')
        .set(chefe)
        .send({ tipo: 'semanal', de: '2019-04-01', ate: '2019-04-07' })
        .expect(200);
      expect(g.body).toMatchObject({
        id: expect.any(String),
        tipo: 'semanal',
        de: '2019-04-01',
        ate: '2019-04-07',
        enviado_em: null,
        tem_pdf: false,
        dados: expect.objectContaining({
          tipo: 'semanal',
          periodo: { de: '2019-04-01', ate: '2019-04-07' },
          melhorias_portal: expect.objectContaining({ propostas: 0 }),
        }),
      });
      const id = g.body.id as string;

      const o = await ctx
        .http()
        .get(`/v1/painel/relatorios/${id}`)
        .set(chefe)
        .expect(200);
      expect(o.body).toEqual(g.body);

      const l = await ctx
        .http()
        .get('/v1/painel/relatorios?tipo=semanal&limite=200')
        .set(chefe)
        .expect(200);
      expect(l.body.itens.map((x: { id: string }) => x.id)).toContain(id);

      // Refazer o mesmo período não duplica.
      const g2 = await ctx
        .http()
        .post('/v1/painel/relatorios/gerar')
        .set(chefe)
        .send({ tipo: 'semanal', de: '2019-04-01', ate: '2019-04-07' })
        .expect(200);
      expect(g2.body.id).toBe(id);

      // enviar: false (omissão) → nenhum email.
      const emails = await linhas(
        ctx.db,
        `SELECT 1 FROM mensagens_saida WHERE relacionado ->> 'relatorio_id' = $1`,
        [id],
      );
      expect(emails).toHaveLength(0);
      const aud = await auditoria(ctx, id, 'gerar_relatorio');
      expect(aud).toHaveLength(2);
      expect(aud[0]).toMatchObject({
        ator_id: chefeId,
        dados: { tipo: 'semanal', de: '2019-04-01', ate: '2019-04-07' },
      });

      const pdf = await ctx
        .http()
        .get(`/v1/painel/relatorios/${id}/pdf`)
        .set(chefe)
        .expect(404);
      expect(pdf.body.erro.codigo).toBe('sem_pdf');

      const nao = await ctx
        .http()
        .get(`/v1/painel/relatorios/${randomUUID()}`)
        .set(chefe)
        .expect(404);
      expect(nao.body.erro.codigo).toBe('relatorio_nao_encontrado');
    });

    it('enviar: true manda um email a cada chefia e vereação ativas', async () => {
      const g = await ctx
        .http()
        .post('/v1/painel/relatorios/gerar')
        .set(chefe)
        .send({
          tipo: 'mensal',
          de: '2019-05-01',
          ate: '2019-05-31',
          enviar: true,
        })
        .expect(200);
      expect(g.body.enviado_em).not.toBeNull();
      const destinos = await linhas<{ email: string }>(
        ctx.db,
        `SELECT email FROM utilizadores
         WHERE municipio_id = $1 AND ativo AND perfil IN ('chefe_divisao','vereador')`,
        [MUNICIPIO_ID],
      );
      const emails = await linhas<{ destino: string; estado: string }>(
        ctx.db,
        `SELECT destino, estado::text AS estado FROM mensagens_saida
         WHERE relacionado ->> 'relatorio_id' = $1`,
        [g.body.id],
      );
      expect(emails.map((e) => e.destino).sort()).toEqual(
        destinos.map((d) => d.email).sort(),
      );
      expect(new Set(emails.map((e) => e.estado))).toEqual(
        new Set(['enviada']),
      );
    });

    it('tipo desconhecido → 400; perfil atendimento → 403', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/relatorios/gerar')
        .set(chefe)
        .send({ tipo: 'anual', de: '2019-01-01', ate: '2019-01-31' })
        .expect(400);
      expect(r.body.erro.codigo).toBe('pedido_invalido');
      const p = await ctx
        .http()
        .get('/v1/painel/relatorios')
        .set(atendimento)
        .expect(403);
      expect(p.body.erro.codigo).toBe('sem_permissao');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Conhecimento: fontes e pesquisa                                   */
  /* ---------------------------------------------------------------- */

  describe('conhecimento: colar texto numa fonte', () => {
    it('os trechos ficam na BD e a procurar_conhecimento encontra-os', async () => {
      const palavra = palavraUnica();
      const url = `https://exemplo.pt/regulamento-${randomUUID()}`;
      const f = await ctx
        .http()
        .post('/v1/painel/conhecimento/fontes')
        .set(chefe)
        .send({
          entidade_id: ENTIDADE_CAMARA,
          titulo: `Regulamento de ${palavra}`,
          tipo: 'regulamento',
          url,
          leitura_automatica: false,
        })
        .expect(estado(201));
      expect(f.body).toMatchObject({
        titulo: `Regulamento de ${palavra}`,
        tipo: 'regulamento',
        url,
        leitura_automatica: false,
        ler_a_cada_horas: 24,
        entidade: 'Câmara (painel e2e)',
      });
      const fonteId = f.body.id as string;

      const repetida = await ctx
        .http()
        .post('/v1/painel/conhecimento/fontes')
        .set(chefe)
        .send({
          entidade_id: ENTIDADE_CAMARA,
          titulo: 'Outra',
          tipo: 'regulamento',
          url,
          leitura_automatica: false,
        })
        .expect(409);
      expect(repetida.body.erro.codigo).toBe('fonte_repetida');

      const texto = [
        `Artigo 1.º Objeto`,
        `O presente regulamento estabelece as regras de utilização dos ${palavra} municipais, incluindo horários, taxas e condições de acesso.`,
        ``,
        `Artigo 2.º Horário`,
        `Os ${palavra} funcionam de segunda a sábado, entre as 9h00 e as 18h00. Ao domingo os ${palavra} estão encerrados.`,
      ].join('\n');
      const c = await ctx
        .http()
        .post(`/v1/painel/conhecimento/fontes/${fonteId}/texto`)
        .set(chefe)
        .send({ texto })
        .expect(200);
      expect(c.body).toMatchObject({
        mudou: true,
        versao_id: expect.any(String),
        alteracao_id: null,
      });

      const trechos = await linhas<{ id: string; texto: string }>(
        ctx.db,
        `SELECT t.id, t.texto FROM trechos t
         JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
         WHERE fv.fonte_id = $1 ORDER BY t.ordem`,
        [fonteId],
      );
      expect(trechos.length).toBeGreaterThan(0);
      expect(trechos.map((t) => t.texto).join(' ')).toContain(
        'segunda a sábado',
      );
      const fonte = await linha(
        ctx.db,
        'SELECT estado, ultimo_hash FROM fontes WHERE id = $1',
        [fonteId],
      );
      expect(fonte).toMatchObject({ estado: 'em_dia' });
      expect(fonte?.ultimo_hash).not.toBeNull();
      const aud = await auditoria(ctx, fonteId, 'colar_texto');
      expect(aud).toHaveLength(1);

      // Sem embeddings, a pesquisa é por texto (e não precisa de job).
      const chamada = novaChamada();
      const r = await ferramenta(ctx, chamada, 'procurar_conhecimento', {
        pergunta: `A que horas abrem os ${palavra} ao sábado?`,
      }).expect(200);
      expect(r.body.sem_fonte).toBe(false);
      expect(r.body.trechos.length).toBeGreaterThan(0);
      const ids = new Set(trechos.map((t) => t.id));
      for (const t of r.body.trechos) {
        expect(ids.has(t.trecho_id)).toBe(true);
        expect(t).toMatchObject({
          titulo: `Regulamento de ${palavra}`,
          url,
          tipo_fonte: 'regulamento',
          entidade: 'Câmara (painel e2e)',
        });
      }

      // O mesmo texto outra vez não cria versão nova.
      const igual = await ctx
        .http()
        .post(`/v1/painel/conhecimento/fontes/${fonteId}/texto`)
        .set(chefe)
        .send({ texto })
        .expect(200);
      expect(igual.body).toMatchObject({
        mudou: false,
        versao_id: c.body.versao_id,
      });
    });

    it('GET /conhecimento/trechos: pesquisa os trechos em vigor para escolher fontes', async () => {
      const palavra = palavraUnica();
      const f = await ctx
        .http()
        .post('/v1/painel/conhecimento/fontes')
        .set(chefe)
        .send({
          entidade_id: ENTIDADE_CAMARA,
          titulo: `Regulamento dos ${palavra}`,
          tipo: 'regulamento',
          url: `https://exemplo.pt/trechos-${randomUUID()}`,
          leitura_automatica: false,
        })
        .expect(estado(201));
      await ctx
        .http()
        .post(`/v1/painel/conhecimento/fontes/${f.body.id}/texto`)
        .set(chefe)
        .send({
          texto: `Artigo 1.º Os ${palavra} municipais abrem às 9h00 e fecham às 18h00, de segunda a sexta-feira.`,
        })
        .expect(200);

      const r = await ctx
        .http()
        .get('/v1/painel/conhecimento/trechos')
        .query({ q: palavra, limite: 5 })
        .set(atendimento)
        .expect(200);
      expect(r.body.itens.length).toBeGreaterThan(0);
      expect(r.body.itens[0]).toMatchObject({
        trecho_id: expect.any(String),
        titulo: `Regulamento dos ${palavra}`,
        tipo_fonte: 'regulamento',
        texto: expect.stringContaining(palavra),
      });

      const nada = await ctx
        .http()
        .get('/v1/painel/conhecimento/trechos')
        .query({ q: palavraUnica() })
        .set(atendimento)
        .expect(200);
      expect(nada.body.itens).toEqual([]);
      await ctx
        .http()
        .get('/v1/painel/conhecimento/trechos')
        .query({ q: 'a' })
        .set(atendimento)
        .expect(400);
    });

    it('texto curto → 400; fonte de outro sítio → 404; atendimento não escreve (403)', async () => {
      const curto = await ctx
        .http()
        .post(`/v1/painel/conhecimento/fontes/${randomUUID()}/texto`)
        .set(chefe)
        .send({ texto: 'pouco' })
        .expect(400);
      expect(curto.body.erro.codigo).toBe('pedido_invalido');

      const nao = await ctx
        .http()
        .post(`/v1/painel/conhecimento/fontes/${randomUUID()}/texto`)
        .set(chefe)
        .send({ texto: 'x'.repeat(100) })
        .expect(404);
      expect(nao.body.erro.codigo).toBe('nao_encontrado');

      const at = await ctx
        .http()
        .post('/v1/painel/conhecimento/fontes')
        .set(atendimento)
        .send({
          entidade_id: ENTIDADE_CAMARA,
          titulo: 'X',
          tipo: 'pagina',
          url: 'https://exemplo.pt/x',
        })
        .expect(403);
      expect(at.body.erro.codigo).toBe('sem_permissao');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Qualidade e gate de publicação                                    */
  /* ---------------------------------------------------------------- */

  describe('qualidade e gate de publicação', () => {
    let sistemaId: string;
    let conjuntoId: string;
    let perguntas: string[];
    let palavra: string;

    /** Execução terminada do nosso tou-chat, com um veredicto por pergunta. */
    async function inserirExecucao(
      agenteVersao: string,
      veredictos: string[],
      terminadaEm: string,
    ): Promise<string> {
      const e = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO avaliacao.execucoes
           (sistema_id, conjunto_id, agente_versao, motivo, amostra, estado, iniciada_em, terminada_em)
         VALUES ($1, $2, $3, 'publicacao', false, 'terminada', $4::timestamptz - interval '5 minutes', $4)
         RETURNING id`,
        [sistemaId, conjuntoId, agenteVersao, terminadaEm],
      );
      for (const [i, veredicto] of veredictos.entries()) {
        const r = await linha<{ id: string }>(
          ctx.db,
          `INSERT INTO avaliacao.respostas (execucao_id, pergunta_id, texto, latencia_ms)
           VALUES ($1, $2, $3, 900) RETURNING id`,
          [e!.id, perguntas[i], `Resposta ${i + 1}`],
        );
        await ctx.db.query(
          `INSERT INTO avaliacao.avaliacoes (resposta_id, rubrica_versao, veredicto, justificacao)
           VALUES ($1, 'v1', $2, 'e2e')`,
          [r!.id, veredicto],
        );
      }
      return e!.id;
    }

    async function versaoAgente(v: string) {
      await ctx.db.query(
        'UPDATE agente_config SET versao = $2 WHERE municipio_id = $1',
        [MUNICIPIO_ID, v],
      );
    }

    async function criarResposta(): Promise<{ id: string; versaoId: string }> {
      const r = await ctx
        .http()
        .post('/v1/painel/conhecimento/respostas')
        .set(interno)
        .send({
          pergunta_tipo: `Quando abre o ${palavra}?`,
          texto_voz: `O ${palavra} abre todos os dias úteis às nove da manhã.`,
          frases: [`horário do ${palavra}`],
        })
        .expect(estado(201));
      expect(r.body).toMatchObject({
        estado: 'rascunho',
        versao_no_ar_id: null,
        versoes: [expect.objectContaining({ numero: 1, publicada_em: null })],
      });
      return { id: r.body.id, versaoId: r.body.versoes[0].id };
    }

    function publicar(
      headers: Record<string, string>,
      respostaId: string,
      corpo: object,
    ) {
      return ctx
        .http()
        .post(`/v1/painel/conhecimento/respostas/${respostaId}/publicar`)
        .set(headers)
        .send(corpo);
    }

    beforeAll(async () => {
      palavra = palavraUnica();
      // Versão própria do agente: só as execuções deste teste contam.
      await versaoAgente(`e2e-painel-${randomUUID()}`);
      const s = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, nosso)
         VALUES ($1, $2, 'tou-chat', true) RETURNING id`,
        [`Tou chat · teste · ${randomUUID()}`, MUNICIPIO_ID],
      );
      sistemaId = s!.id;
      const c = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO avaliacao.conjuntos (nome, municipio_id) VALUES ($1, $2) RETURNING id`,
        [`Perguntas e2e ${randomUUID()}`, MUNICIPIO_ID],
      );
      conjuntoId = c!.id;
      perguntas = [];
      for (let i = 1; i <= 5; i++) {
        const p = await linha<{ id: string }>(
          ctx.db,
          `INSERT INTO avaliacao.perguntas (conjunto_id, ordem, categoria, texto, comportamento)
           VALUES ($1, $2, $3, $4, 'responder') RETURNING id`,
          [conjuntoId, i, i <= 3 ? 'obras' : 'agua', `Pergunta ${i}?`],
        );
        perguntas.push(p!.id);
      }
    });

    it('criar respostas é só para a equipa interna (403 so_equipa_interna)', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/conhecimento/respostas')
        .set(chefe)
        .send({ pergunta_tipo: 'Pergunta do chefe?', texto_voz: 'Resposta.' })
        .expect(403);
      expect(r.body.erro.codigo).toBe('so_equipa_interna');
    });

    it('publicar sem execução do avaliador → 409 avaliacao_em_falta', async () => {
      const { id, versaoId } = await criarResposta();
      const versao = (await linha(
        ctx.db,
        'SELECT versao FROM agente_config WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      ))!.versao as string;

      const q = await ctx
        .http()
        .get('/v1/painel/conhecimento/qualidade')
        .set(chefe)
        .expect(200);
      expect(q.body).toMatchObject({
        limiar: 80,
        versao_atual: versao,
        publicacao: { pode_publicar: false, motivo: 'avaliacao_em_falta' },
      });

      const r = await publicar(interno, id, { versao_id: versaoId }).expect(
        409,
      );
      expect(r.body.erro).toMatchObject({
        codigo: 'avaliacao_em_falta',
        detalhes: {
          causa: expect.stringMatching(/^(sem_execucao|outra_versao)$/),
          limiar: 80,
          versao_atual: versao,
          comando: expect.stringContaining('avaliador executar'),
        },
      });
      const bd = await linha(
        ctx.db,
        'SELECT estado::text AS estado, versao_no_ar_id FROM respostas WHERE id = $1',
        [id],
      );
      expect(bd).toEqual({ estado: 'rascunho', versao_no_ar_id: null });
    });

    it('execução abaixo de 80% → 422; com 80% → publica e liga a versão à execução', async () => {
      const versao = (await linha(
        ctx.db,
        'SELECT versao FROM agente_config WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      ))!.versao as string;
      const { id, versaoId } = await criarResposta();

      // 3 em 5 = 60%.
      const fraca = await inserirExecucao(
        versao,
        ['certa', 'passada_bem', 'certa', 'errada', 'sem_resposta'],
        new Date(Date.now() - 60_000).toISOString(),
      );
      const r = await publicar(interno, id, { versao_id: versaoId }).expect(
        422,
      );
      expect(r.body.erro).toMatchObject({
        codigo: 'avaliacao_abaixo_do_limiar',
        detalhes: {
          causa: 'abaixo',
          execucao_id: fraca,
          taxa: 60,
          limiar: 80,
          versao_atual: versao,
        },
      });

      // Execução da versão anterior do agente não conta (mesmo com 100%).
      await inserirExecucao(
        `${versao}-antiga`,
        ['certa', 'certa', 'certa', 'certa', 'certa'],
        new Date(Date.now() - 30_000).toISOString(),
      );
      await publicar(interno, id, { versao_id: versaoId }).expect(422);

      // 4 em 5 = 80%, mais recente: passa.
      const boa = await inserirExecucao(
        versao,
        ['certa', 'certa', 'passada_bem', 'certa', 'errada'],
        new Date(Date.now() - 1_000).toISOString(),
      );

      const q = await ctx
        .http()
        .get('/v1/painel/conhecimento/qualidade')
        .set(chefe)
        .expect(200);
      expect(q.body.publicacao).toEqual({
        pode_publicar: true,
        motivo: null,
        causa: null,
        execucao_id: boa,
      });

      const p = await publicar(interno, id, { versao_id: versaoId }).expect(
        200,
      );
      expect(p.body).toMatchObject({
        id,
        estado: 'no_ar',
        versao_no_ar_id: versaoId,
        versoes: [
          expect.objectContaining({
            id: versaoId,
            eval_execucao_id: boa,
            publicada_em: expect.any(String),
          }),
        ],
      });
      const aud = await auditoria(ctx, id, 'publicar');
      expect(aud).toEqual([
        expect.objectContaining({
          ator_id: internoId,
          dados: { versao_id: versaoId, eval_execucao_id: boa },
        }),
      ]);

      // No ar, a resposta curada é o que a procurar_conhecimento devolve.
      const f = await ferramenta(ctx, novaChamada(), 'procurar_conhecimento', {
        pergunta: `A que horas abre o ${palavra}?`,
      }).expect(200);
      expect(f.body.respostas).toEqual([
        expect.objectContaining({
          resposta_id: id,
          texto: `O ${palavra} abre todos os dias úteis às nove da manhã.`,
        }),
      ]);
    });

    it('GET /conhecimento/qualidade: a última execução, categorias, evolução e erradas', async () => {
      const q = await ctx
        .http()
        .get('/v1/painel/conhecimento/qualidade')
        .set(atendimento)
        .expect(200);
      expect(q.body.ultima).toMatchObject({
        sistema: expect.stringContaining('Tou chat · teste'),
        total: 5,
        certas: 3,
        passadas_bem: 1,
        erradas: 1,
        taxa: 80,
        passou: true,
        perguntas: 5,
      });
      expect(
        q.body.ultima.categorias.map((c: { categoria: string }) => c.categoria),
      ).toEqual(expect.arrayContaining(['obras', 'agua']));
      expect(q.body.erradas).toEqual([
        expect.objectContaining({
          pergunta: 'Pergunta 5?',
          veredicto: 'errada',
        }),
      ]);
      const taxas = q.body.evolucao.map((e: { taxa: number }) => e.taxa);
      expect(taxas).toEqual(expect.arrayContaining([60, 80]));
      expect(q.body.voz).toBeNull();
    });

    it('forcar: chefe de divisão → 403 so_equipa_interna; equipa interna publica e fica na auditoria', async () => {
      // Nova versão do agente: as execuções anteriores deixam de contar.
      const nova = `e2e-painel-${randomUUID()}`;
      await versaoAgente(nova);
      const { id, versaoId } = await criarResposta();

      const semForcar = await publicar(interno, id, {
        versao_id: versaoId,
      }).expect(409);
      expect(semForcar.body.erro.detalhes.causa).toBe('outra_versao');

      const ch = await publicar(chefe, id, {
        versao_id: versaoId,
        forcar: true,
      }).expect(403);
      expect(ch.body.erro.codigo).toBe('so_equipa_interna');

      const p = await publicar(interno, id, {
        versao_id: versaoId,
        forcar: true,
      }).expect(200);
      expect(p.body).toMatchObject({
        estado: 'no_ar',
        versao_no_ar_id: versaoId,
        versoes: [expect.objectContaining({ eval_execucao_id: null })],
      });
      const aud = await auditoria(ctx, id);
      expect(aud.map((a) => a.acao)).toEqual(
        expect.arrayContaining(['publicar_sem_avaliacao', 'publicar']),
      );
      const forcado = aud.find((a) => a.acao === 'publicar_sem_avaliacao');
      expect(forcado).toMatchObject({
        ator_id: internoId,
        dados: {
          versao_id: versaoId,
          motivo: 'avaliacao_em_falta',
          causa: 'outra_versao',
          versao_atual: nova,
        },
      });
    });

    it('versão de outra resposta → 404 nao_encontrado (antes do gate)', async () => {
      const a = await criarResposta();
      const b = await criarResposta();
      const r = await publicar(interno, a.id, { versao_id: b.versaoId }).expect(
        404,
      );
      expect(r.body.erro.codigo).toBe('nao_encontrado');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Melhorias ao portal                                               */
  /* ---------------------------------------------------------------- */

  describe('melhorias ao portal', () => {
    it('listar (com filtro de estado), gerar sem IA → 503, resumo por período', async () => {
      const titulo = `Contactos da junta ${randomUUID()}`;
      const m = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO melhorias_portal (municipio_id, titulo, o_que_falta, sugestao, estado, enviada_em, criada_em)
         VALUES ($1, $2, 'O telefone da junta', 'Pôr o telefone na página', 'enviada',
                 '2019-06-10 10:00+00', '2019-06-09 10:00+00')
         RETURNING id`,
        [MUNICIPIO_ID, titulo],
      );

      const l = await ctx
        .http()
        .get('/v1/painel/conhecimento/melhorias?estado=enviada&limite=200')
        .set(atendimento)
        .expect(200);
      expect(l.body).toHaveProperty('proximo_cursor');
      expect(l.body.itens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: m!.id,
            titulo,
            estado: 'enviada',
            perguntas: 0,
            vezes: 0,
          }),
        ]),
      );
      for (const i of l.body.itens) expect(i.estado).toBe('enviada');

      const g = await ctx
        .http()
        .post('/v1/painel/conhecimento/melhorias/gerar')
        .set(chefe)
        .expect(503);
      expect(g.body.erro.codigo).toBe('ia_indisponivel');

      const r = await ctx
        .http()
        .get(
          '/v1/painel/conhecimento/melhorias/resumo?de=2019-06-10&ate=2019-06-10',
        )
        .set(chefe)
        .expect(200);
      expect(r.body).toEqual({
        propostas: 0,
        enviadas: 1,
        publicadas: 0,
        rejeitadas: 0,
        perguntas_resolvidas: 0,
        vezes_resolvidas: 0,
      });

      const mau = await ctx
        .http()
        .get('/v1/painel/conhecimento/melhorias/resumo?de=10-06-2019')
        .set(chefe)
        .expect(400);
      expect(mau.body.erro.codigo).toBe('pedido_invalido');

      const at = await ctx
        .http()
        .post('/v1/painel/conhecimento/melhorias/gerar')
        .set(atendimento)
        .expect(403);
      expect(at.body.erro.codigo).toBe('sem_permissao');
    });
  });
});
