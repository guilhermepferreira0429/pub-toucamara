/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import { hojeLisboa } from '../../src/common/dias-uteis';
import { ArmazenamentoService } from '../../src/modules/armazenamento/armazenamento.service';
import { MensagensService } from '../../src/modules/comunicacao/mensagens.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  linhas,
  MUNICIPIO_ID,
  novoTelefone,
  smsPara,
} from './app';

const AUTH = '/v1/painel/auth/app';
const BASE = '/v1/painel/equipa';

/** Os emails que a API mandaria (sem SMTP nos testes). */
function apanharEmails(ctx: Contexto) {
  const enviados: { para: string; assunto: string; texto: string }[] = [];
  const mensagens = ctx.app.get(MensagensService);
  jest.spyOn(mensagens, 'email').mockImplementation((e) => {
    enviados.push({ para: e.para, assunto: e.assunto, texto: e.texto });
    return Promise.resolve();
  });
  return enviados;
}

function codigoDe(texto: string): string {
  return /\b(\d{6})\b/.exec(texto)![1];
}

async function emailDe(ctx: Contexto, id: string): Promise<string> {
  return (await linha<{ email: string }>(
    ctx.db,
    'SELECT email FROM utilizadores WHERE id = $1',
    [id],
  ))!.email;
}

async function novoServico(ctx: Contexto): Promise<string> {
  const s = await linha<{ id: string }>(
    ctx.db,
    `INSERT INTO servicos (municipio_id, entidade_id, nome)
     VALUES ($1, '00000000-0000-0000-0000-0000000000e1', $2) RETURNING id`,
    [MUNICIPIO_ID, `Equipa de rua ${randomInt(1e9)}`],
  );
  return s!.id;
}

async function novaOcorrencia(
  ctx: Contexto,
  servicoId: string,
  dados: {
    lat: number | null;
    lng: number | null;
    estado?: string;
    telefone?: string;
    duplicadaDe?: string;
  },
): Promise<{ id: string; numero: string }> {
  const cat = await linha<{ id: string }>(
    ctx.db,
    `SELECT id FROM categorias_ocorrencia WHERE municipio_id = $1 AND nome = 'Buraco na via'`,
    [MUNICIPIO_ID],
  );
  const municipe = dados.telefone
    ? (await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Munícipe Campo') RETURNING id`,
        [MUNICIPIO_ID, dados.telefone],
      ))!.id
    : null;
  const numero = `OC-E${randomInt(1e9)}`;
  const o = await linha<{ id: string }>(
    ctx.db,
    `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng,
                              municipe_id, servico_id, estado, duplicada_de)
     VALUES ($1, $2, $3, 'Buraco grande na estrada', 'Rua do Campo, 3', $4, $5, $6, $7, $8::estado_ocorr, $9)
     RETURNING id`,
    [
      MUNICIPIO_ID,
      numero,
      cat!.id,
      dados.lat,
      dados.lng,
      municipe,
      servicoId,
      dados.estado ?? 'com_equipa',
      dados.duplicadaDe ?? null,
    ],
  );
  return { id: o!.id, numero };
}

/**
 * App da equipa de campo: entrar com código por email (sessão de telemóvel
 * revogável), as tarefas do dia por proximidade, fechar uma ocorrência com
 * nota e o reenvio idempotente da fila offline.
 */
describe('App da equipa de campo (e2e)', () => {
  let ctx: Contexto;
  let emails: ReturnType<typeof apanharEmails>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    emails = apanharEmails(ctx);
  });
  afterAll(() => ctx.fechar());

  async function entrarApp(utilizadorId: string): Promise<{
    token: string;
    sessao_id: string;
    headers: Record<string, string>;
  }> {
    const email = await emailDe(ctx, utilizadorId);
    await ctx.http().post(`${AUTH}/codigo`).send({ email }).expect(202);
    const ultimo = emails.filter((e) => e.para === email).at(-1)!;
    const r = await ctx
      .http()
      .post(`${AUTH}/entrar`)
      .send({
        email,
        codigo: codigoDe(ultimo.texto),
        dispositivo: 'Telemóvel de teste',
      })
      .expect(200);
    return {
      token: r.body.token,
      sessao_id: r.body.sessao_id,
      headers: { Authorization: `Bearer ${r.body.token}` },
    };
  }

  describe('entrar com código por email', () => {
    it('código por email (só o hash na BD) → sessão do painel com o dispositivo; auditado', async () => {
      const id = await criarUtilizador(ctx, 'tecnico');
      const email = await emailDe(ctx, id);
      const p = await ctx
        .http()
        .post(`${AUTH}/codigo`)
        .send({ email: email.toUpperCase() })
        .expect(202);
      expect(p.body).toEqual({ enviado: true, validade_minutos: 10 });
      const e = emails.filter((x) => x.para === email).at(-1)!;
      const codigo = codigoDe(e.texto);
      const guardado = await linha<{ codigo_hash: Buffer; expira: boolean }>(
        ctx.db,
        `SELECT codigo_hash, expira_em BETWEEN now() + interval '9 minutes' AND now() + interval '11 minutes' AS expira
         FROM painel_app_codigos WHERE utilizador_id = $1`,
        [id],
      );
      expect(guardado!.expira).toBe(true);
      expect(guardado!.codigo_hash.toString('utf8')).not.toContain(codigo);

      const r = await ctx
        .http()
        .post(`${AUTH}/entrar`)
        .send({ email, codigo, dispositivo: 'Samsung A52' })
        .expect(200);
      expect(r.body.utilizador).toMatchObject({ id, perfil: 'tecnico' });
      expect(r.body.municipio).toEqual({
        slug: 'teste',
        nome: expect.any(String),
      });
      const dias =
        (new Date(r.body.expira_em).getTime() - Date.now()) / 86_400_000;
      expect(dias).toBeGreaterThan(29);

      // O token serve o painel como o do link mágico.
      const eu = await ctx
        .http()
        .get('/v1/painel/auth/eu')
        .set({ Authorization: `Bearer ${r.body.token}` })
        .expect(200);
      expect(eu.body.permissoes.fiscalizacao).toBe(true);

      // O código não se usa duas vezes.
      await ctx
        .http()
        .post(`${AUTH}/entrar`)
        .send({ email, codigo })
        .expect(400);

      const s = await linha(
        ctx.db,
        'SELECT dispositivo, revogada_em FROM painel_app_sessoes WHERE id = $1',
        [r.body.sessao_id],
      );
      expect(s).toEqual({ dispositivo: 'Samsung A52', revogada_em: null });
      const a = await linha(
        ctx.db,
        `SELECT acao FROM audit_log WHERE objeto_id = $1 AND acao = 'entrar_app_equipa'`,
        [r.body.sessao_id],
      );
      expect(a).toBeTruthy();
    });

    it('email desconhecido ou sem perfil de campo: a mesma resposta e nenhum email', async () => {
      const antes = emails.length;
      await ctx
        .http()
        .post(`${AUTH}/codigo`)
        .send({ email: `ninguem-${randomInt(1e9)}@teste.pt` })
        .expect(202);
      const atendimento = await criarUtilizador(ctx, 'atendimento');
      const r = await ctx
        .http()
        .post(`${AUTH}/codigo`)
        .send({ email: await emailDe(ctx, atendimento) })
        .expect(202);
      expect(r.body).toEqual({ enviado: true, validade_minutos: 10 });
      expect(emails.length).toBe(antes);
      await ctx
        .http()
        .post(`${AUTH}/entrar`)
        .send({ email: await emailDe(ctx, atendimento), codigo: '123456' })
        .expect(400);
    });

    it('código errado conta tentativas; à 5.ª fica esgotado mesmo com o certo', async () => {
      const id = await criarUtilizador(ctx, 'tecnico');
      const email = await emailDe(ctx, id);
      await ctx.http().post(`${AUTH}/codigo`).send({ email }).expect(202);
      const certo = codigoDe(
        emails.filter((x) => x.para === email).at(-1)!.texto,
      );
      const errado = certo === '000000' ? '111111' : '000000';
      for (let i = 4; i >= 0; i--) {
        const r = await ctx
          .http()
          .post(`${AUTH}/entrar`)
          .send({ email, codigo: errado })
          .expect(400);
        expect(r.body.erro.codigo).toBe('codigo_errado');
        expect(r.body.erro.detalhes.tentativas_restantes).toBe(i);
      }
      const r = await ctx
        .http()
        .post(`${AUTH}/entrar`)
        .send({ email, codigo: certo })
        .expect(429);
      expect(r.body.erro.codigo).toBe('demasiadas_tentativas');
    });

    it('sair revoga a sessão: o mesmo token deixa de servir; o link mágico não tem "sair da app"', async () => {
      const id = await criarUtilizador(ctx, 'tecnico');
      const s = await entrarApp(id);
      const lista = await ctx
        .http()
        .get(`${AUTH}/sessoes`)
        .set(s.headers)
        .expect(200);
      expect(lista.body.itens).toEqual([
        expect.objectContaining({
          id: s.sessao_id,
          esta: true,
          dispositivo: 'Telemóvel de teste',
        }),
      ]);
      await ctx.http().post(`${AUTH}/sair`).set(s.headers).expect(200);
      const r = await ctx.http().get(`${BASE}/hoje`).set(s.headers).expect(401);
      expect(r.body.erro.codigo).toBe('nao_autenticado');
      const a = await linha(
        ctx.db,
        `SELECT revogada_por FROM painel_app_sessoes WHERE id = $1`,
        [s.sessao_id],
      );
      expect(a!.revogada_por).toBe('utilizador');

      const web = await entrarPainel(ctx, id);
      const sem = await ctx.http().post(`${AUTH}/sair`).set(web).expect(400);
      expect(sem.body.erro.codigo).toBe('sem_sessao_app');
    });

    it('a chefia termina a sessão de outra pessoa; um técnico não', async () => {
      const id = await criarUtilizador(ctx, 'tecnico');
      const s = await entrarApp(id);
      const outro = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'tecnico'),
      );
      await ctx
        .http()
        .post(`${AUTH}/sessoes/${s.sessao_id}/revogar`)
        .set(outro)
        .expect(404);
      const chefe = await entrarPainel(ctx);
      await ctx
        .http()
        .post(`${AUTH}/sessoes/${s.sessao_id}/revogar`)
        .set(chefe)
        .expect(200);
      await ctx.http().get(`${BASE}/hoje`).set(s.headers).expect(401);
    });
  });

  describe('hoje, fotos e fechar', () => {
    let servico: string;
    let tecnicoId: string;
    let tecnico: Record<string, string>;
    const hoje = hojeLisboa();

    beforeAll(async () => {
      servico = await novoServico(ctx);
      tecnicoId = await criarUtilizador(ctx, 'tecnico');
      await ctx.db.query(
        'UPDATE utilizadores SET servico_id = $2 WHERE id = $1',
        [tecnicoId, servico],
      );
      tecnico = (await entrarApp(tecnicoId)).headers;
    });

    it('as minhas visitas de hoje e as ocorrências abertas do meu serviço, por proximidade', async () => {
      const longe = await novaOcorrencia(ctx, servico, {
        lat: 41.5,
        lng: -8.29,
      });
      const perto = await novaOcorrencia(ctx, servico, {
        lat: 41.4426,
        lng: -8.2919,
      });
      const semLocal = await novaOcorrencia(ctx, servico, {
        lat: null,
        lng: null,
      });
      const fechada = await novaOcorrencia(ctx, servico, {
        lat: 41.44,
        lng: -8.29,
        estado: 'rejeitada',
      });
      const original = await novaOcorrencia(ctx, servico, {
        lat: 41.45,
        lng: -8.29,
      });
      const duplicado = await novaOcorrencia(ctx, servico, {
        lat: 41.45,
        lng: -8.29,
        duplicadaDe: original.id,
      });
      const deOutroServico = await novaOcorrencia(ctx, await novoServico(ctx), {
        lat: 41.44,
        lng: -8.29,
      });
      const v = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO fiscalizacao_visitas (municipio_id, numero, tipo, origem, estado, fiscal_id, dia, morada, lat, lng, motivo, checklist)
         VALUES ($1, $2, 'obra', 'manual', 'agendada', $3, $4, 'Rua da Visita, 1', 41.4430, -8.2920, 'Obra sem licença', '[]')
         RETURNING id`,
        [MUNICIPIO_ID, `FIS-E${randomInt(1e9)}`, tecnicoId, hoje],
      );

      const r = await ctx
        .http()
        .get(`${BASE}/hoje?lat=41.4425&lng=-8.2918`)
        .set(tecnico)
        .expect(200);
      const ids = r.body.tarefas.map((t: { id: string }) => t.id);
      expect(ids).toEqual([
        perto.id,
        v!.id,
        original.id,
        longe.id,
        semLocal.id,
      ]);
      expect(ids).not.toContain(fechada.id);
      expect(ids).not.toContain(duplicado.id);
      expect(ids).not.toContain(deOutroServico.id);
      expect(r.body.tarefas[0]).toMatchObject({
        tipo: 'ocorrencia',
        titulo: 'Buraco na via',
        estado_nome: 'Com a equipa',
        feita: false,
      });
      expect(r.body.tarefas[0].distancia_m).toBeLessThan(50);
      expect(r.body.tarefas[1]).toMatchObject({
        tipo: 'visita',
        titulo: 'Fiscalização de obra particular',
      });
      expect(r.body.tarefas[2].reportes).toBe(2);
      expect(r.body.por_fazer).toBe(5);
      expect(r.body.mostra).toEqual({ visitas: true, ocorrencias: true });
    });

    it('sem S3 a foto do depois responde 503 claro (nada fica gravado)', async () => {
      const o = await novaOcorrencia(ctx, servico, { lat: 41.44, lng: -8.29 });
      const r = await ctx
        .http()
        .post(`${BASE}/ocorrencias/${o.id}/fotos`)
        .set(tecnico)
        .send({ mime: 'image/jpeg' })
        .expect(503);
      expect(r.body.erro.codigo).toBe('armazenamento_indisponivel');
      const f = await linhas(
        ctx.db,
        'SELECT 1 FROM ocorrencia_fotos WHERE ocorrencia_id = $1',
        [o.id],
      );
      expect(f).toHaveLength(0);
    });

    it('fechar com nota → resolvida, nota no histórico, SMS a quem reportou; reenvio com a mesma Idempotency-Key não repete', async () => {
      const telefone = novoTelefone();
      const o = await novaOcorrencia(ctx, servico, {
        lat: 41.44,
        lng: -8.29,
        telefone,
      });
      const chave = randomUUID();
      const r = await ctx
        .http()
        .post(`${BASE}/ocorrencias/${o.id}/fechar`)
        .set(tecnico)
        .set('Idempotency-Key', chave)
        .send({ nota: 'Buraco tapado com betuminoso a frio.' })
        .expect(200);
      expect(r.body).toMatchObject({ estado: 'resolvida', avisados: 1 });
      expect(r.body.eventos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tipo: 'resolvida' }),
          expect.objectContaining({
            tipo: 'nota',
            dados: expect.objectContaining({
              texto: 'Buraco tapado com betuminoso a frio.',
            }),
          }),
        ]),
      );
      const de2 = await ctx
        .http()
        .post(`${BASE}/ocorrencias/${o.id}/fechar`)
        .set(tecnico)
        .set('Idempotency-Key', chave)
        .send({ nota: 'Buraco tapado com betuminoso a frio.' })
        .expect(200);
      expect(de2.body.estado).toBe('resolvida');
      const notas = await linhas(
        ctx.db,
        `SELECT 1 FROM ocorrencia_eventos WHERE ocorrencia_id = $1 AND tipo = 'nota'`,
        [o.id],
      );
      expect(notas).toHaveLength(1);
      expect(await smsPara(ctx, telefone, 'ocorrencia')).toHaveLength(1);

      // Resolvida hoje: continua na lista, como feita, no fim.
      const h = await ctx.http().get(`${BASE}/hoje`).set(tecnico).expect(200);
      const t = h.body.tarefas.find((x: { id: string }) => x.id === o.id);
      expect(t).toMatchObject({ feita: true, estado_nome: 'Resolvida' });
      expect(h.body.tarefas.at(-1).feita).toBe(true);
    });

    it('a mesma chave noutra rota → 422; fechar uma ocorrência rejeitada ou duplicada → 409; fotos de outra → 400', async () => {
      const chave = randomUUID();
      const o = await novaOcorrencia(ctx, servico, { lat: 41.44, lng: -8.29 });
      await ctx
        .http()
        .patch(`/v1/painel/ocorrencias/${o.id}`)
        .set(tecnico)
        .set('Idempotency-Key', chave)
        .send({ estado: 'com_equipa' })
        .expect(200);
      const r = await ctx
        .http()
        .post(`${BASE}/ocorrencias/${o.id}/fechar`)
        .set(tecnico)
        .set('Idempotency-Key', chave)
        .send({ nota: 'Resolvido.' })
        .expect(422);
      expect(r.body.erro.codigo).toBe('chave_reutilizada');

      const rej = await novaOcorrencia(ctx, servico, {
        lat: 41.44,
        lng: -8.29,
        estado: 'rejeitada',
      });
      await ctx
        .http()
        .post(`${BASE}/ocorrencias/${rej.id}/fechar`)
        .set(tecnico)
        .send({ nota: 'Resolvido.' })
        .expect(409);
      const dup = await novaOcorrencia(ctx, servico, {
        lat: 41.44,
        lng: -8.29,
        duplicadaDe: o.id,
      });
      await ctx
        .http()
        .post(`${BASE}/ocorrencias/${dup.id}/fechar`)
        .set(tecnico)
        .send({ nota: 'Resolvido.' })
        .expect(409);
      const e = await ctx
        .http()
        .post(`${BASE}/ocorrencias/${o.id}/fechar`)
        .set(tecnico)
        .send({ nota: 'Resolvido.', foto_ids: [randomUUID()] })
        .expect(400);
      expect(e.body.erro.codigo).toBe('foto_invalida');
    });

    it('permissões: atendimento não fecha nem junta fotos; hoje sem permissões mostra só o que pode', async () => {
      const o = await novaOcorrencia(ctx, servico, { lat: 41.44, lng: -8.29 });
      const atendimento = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'atendimento'),
      );
      await ctx
        .http()
        .post(`${BASE}/ocorrencias/${o.id}/fechar`)
        .set(atendimento)
        .send({ nota: 'Resolvido.' })
        .expect(403);
      await ctx
        .http()
        .post(`${BASE}/ocorrencias/${o.id}/fotos`)
        .set(atendimento)
        .send({ mime: 'image/jpeg' })
        .expect(403);
      const h = await ctx
        .http()
        .get(`${BASE}/hoje`)
        .set(atendimento)
        .expect(200);
      expect(h.body).toMatchObject({
        tarefas: [],
        mostra: { visitas: false, ocorrencias: false },
      });
      await ctx.http().get(`${BASE}/hoje`).expect(401);
    });
  });
});

/**
 * Com armazenamento (S3 falso): a foto do depois fica marcada 'equipa' com
 * GPS e hora, entra no fecho, e não conta no limite do munícipe; a foto da
 * visita guarda o GPS e a hora.
 */
describe('App da equipa de campo · fotos com S3 (e2e)', () => {
  let ctx: Contexto;
  let tecnicoId: string;
  let tecnico: Record<string, string>;
  let servico: string;

  const s3Falso = {
    disponivel: true,
    chave: (slug: string, pasta: string, ext: string) =>
      `${slug}/${pasta}/teste-${randomInt(1e9)}.${ext}`,
    urlEnvio: (chave: string) =>
      Promise.resolve(`https://s3.falso/${chave}?assinado`),
    urlLeitura: (chave: string) =>
      Promise.resolve(`https://s3.falso/${chave}?ler`),
    ler: () => Promise.reject(new Error('NoSuchKey')),
    guardar: () => Promise.resolve(),
    apagar: () => Promise.resolve([]),
  };

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) =>
        b.overrideProvider(ArmazenamentoService).useValue(s3Falso),
    });
    servico = await novoServico(ctx);
    tecnicoId = await criarUtilizador(ctx, 'tecnico');
    await ctx.db.query(
      'UPDATE utilizadores SET servico_id = $2 WHERE id = $1',
      [tecnicoId, servico],
    );
    tecnico = await entrarPainel(ctx, tecnicoId);
  });
  afterAll(() => ctx.fechar());

  it('foto do depois → URL assinada; fechar com ela; aparece no detalhe com origem equipa', async () => {
    const o = await novaOcorrencia(ctx, servico, { lat: 41.44, lng: -8.29 });
    const f = await ctx
      .http()
      .post(`${BASE}/ocorrencias/${o.id}/fotos`)
      .set(tecnico)
      .send({
        mime: 'image/jpeg',
        legenda: 'Depois',
        lat: 41.4401,
        lng: -8.2901,
        tirada_em: '2026-10-22T10:15:00+01:00',
      })
      .expect(201);
    expect(f.body).toMatchObject({
      metodo: 'PUT',
      url_envio: expect.stringContaining('s3.falso'),
    });
    const g = await linha(
      ctx.db,
      'SELECT origem, enviada_por, lat, lng, tirada_em IS NOT NULL AS tem_hora FROM ocorrencia_fotos WHERE id = $1',
      [f.body.foto_id],
    );
    expect(g).toEqual({
      origem: 'equipa',
      enviada_por: tecnicoId,
      lat: 41.4401,
      lng: -8.2901,
      tem_hora: true,
    });

    const r = await ctx
      .http()
      .post(`${BASE}/ocorrencias/${o.id}/fechar`)
      .set(tecnico)
      .send({ nota: 'Tapado.', foto_ids: [f.body.foto_id] })
      .expect(200);
    expect(r.body.fotos).toEqual([
      expect.objectContaining({
        id: f.body.foto_id,
        origem: 'equipa',
        legenda: 'Depois',
      }),
    ]);
  });

  it('a foto do depois não tira lugar às do munícipe; limite próprio de 5', async () => {
    const o = await novaOcorrencia(ctx, servico, { lat: 41.44, lng: -8.29 });
    for (let i = 0; i < 5; i++) {
      await ctx
        .http()
        .post(`${BASE}/ocorrencias/${o.id}/fotos`)
        .set(tecnico)
        .send({ mime: 'image/png' })
        .expect(201);
    }
    const r = await ctx
      .http()
      .post(`${BASE}/ocorrencias/${o.id}/fotos`)
      .set(tecnico)
      .send({ mime: 'image/png' })
      .expect(409);
    expect(r.body.erro.codigo).toBe('limite_fotos');
  });

  it('foto da visita guarda o GPS e a hora', async () => {
    const v = await ctx
      .http()
      .post('/v1/painel/fiscalizacao/visitas')
      .set(tecnico)
      .send({
        origem: 'manual',
        tipo: 'obra',
        motivo: 'Obra denunciada',
        morada: 'Rua das Fotos, 1',
        lat: 41.44,
        lng: -8.29,
      })
      .expect(201);
    const f = await ctx
      .http()
      .post(`${BASE}/visitas/${v.body.id}/fotos`)
      .set(tecnico)
      .set('Idempotency-Key', randomUUID())
      .send({
        mime: 'image/jpeg',
        lat: 41.4402,
        lng: -8.2902,
        tirada_em: '2026-10-22T09:00:00Z',
      })
      .expect(201);
    const g = await linha(
      ctx.db,
      'SELECT lat, lng, tirada_em FROM fiscalizacao_fotos WHERE id = $1',
      [f.body.foto_id],
    );
    expect(g).toEqual({
      lat: 41.4402,
      lng: -8.2902,
      tirada_em: new Date('2026-10-22T09:00:00Z'),
    });
  });
});
