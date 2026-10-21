/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import type { Response } from 'superagent';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linhas,
  MUNICIPIO,
  MUNICIPIO_ID,
  novaChamada,
} from './app';

/** O corpo binário (PDF) do supertest. */
function binario(res: Response, cb: (e: Error | null, b: Buffer) => void) {
  // Em Node, a resposta do superagent é o IncomingMessage (um stream).
  const stream = res as unknown as NodeJS.ReadableStream;
  const partes: Buffer[] = [];
  stream.on('data', (p: Buffer) => partes.push(p));
  stream.on('end', () => cb(null, Buffer.concat(partes)));
}

const REUNIAO = {
  orgao: 'camara',
  tipo: 'ordinaria',
  data: '2026-03-12',
  hora: '10:00',
  local: 'Salão Nobre dos Paços do Concelho',
  ordem_do_dia: [
    { numero: 1, titulo: 'Aprovação da ata da reunião anterior' },
    {
      numero: 2,
      titulo: 'Parque de estacionamento do Largo do Toural',
      descricao: 'Abertura do concurso público para a concessão do parque.',
    },
    { numero: 3, titulo: 'Apoios às associações desportivas' },
  ],
  presencas: [
    { nome: 'Ana Costa', cargo: 'Presidente', forca_politica: 'PS' },
    { nome: 'Bruno Dias', cargo: 'Vereador', forca_politica: 'PS' },
    { nome: 'Carla Faria', cargo: 'Vereadora', forca_politica: 'PSD' },
    {
      nome: 'Eva Henriques',
      cargo: 'Vereadora',
      forca_politica: 'CDU',
      presente: false,
      falta_justificada: true,
    },
  ],
};

const TRANSCRICAO = [
  'Ana Costa: Bom dia. Declaro aberta a reunião.',
  'Ana Costa: Ponto 1. Aprovação da ata da reunião anterior. Aprovada por todos.',
  'Ana Costa: Passamos ao ponto dois, o parque de estacionamento do Toural.',
  'Bruno Dias: Propomos abrir o concurso para a concessão por vinte anos.',
  'Carla Faria: O PSD vota contra, o prazo é demasiado longo.',
  'Ponto 3',
  'Bruno Dias: Os apoios às associações desportivas mantêm-se.',
].join('\n');

/**
 * Reuniões e atas: reunião → transcrição em texto → rascunho sem IA →
 * edição (versões) → aprovação em minuta → publicação → pesquisa no painel
 * e pública → ferramenta do agente → PDF; permissões; áudio sem S3 → 503.
 */
describe('Reuniões, atas e deliberações (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let id: string;
  let urlPdf: string;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  it('cria a reunião com a ordem do dia e as presenças (numerada por órgão e ano)', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/reunioes')
      .set(chefe)
      .send(REUNIAO)
      .expect(201);
    id = r.body.id;
    expect(r.body).toMatchObject({
      orgao: 'camara',
      numero: '1/2026',
      estado: 'agendada',
      data: '2026-03-12',
      hora: '10:00',
      ata: null,
      transcricao: { estado: 'sem' },
      pode_transcrever_audio: false,
      ia_disponivel: false,
    });
    expect(r.body.ordem_do_dia[1]).toMatchObject({ numero: 2 });
    expect(r.body.presencas[3]).toMatchObject({ presente: false });

    await ctx
      .http()
      .post('/v1/painel/reunioes')
      .set(chefe)
      .send({
        ...REUNIAO,
        ordem_do_dia: [
          { numero: 1, titulo: 'A' },
          { numero: 1, titulo: 'B' },
        ],
      })
      .expect(400);

    const l = await ctx
      .http()
      .get('/v1/painel/reunioes?orgao=camara')
      .set(chefe)
      .expect(200);
    expect(l.body.itens).toEqual([
      expect.objectContaining({ id, pontos: 3, estado: 'agendada', ata: null }),
    ]);
  });

  it('áudio sem S3: 503 claro (e sem ElevenLabs também)', async () => {
    const g = await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/gravacao`)
      .set(chefe)
      .send({ mime: 'audio/mpeg' })
      .expect(503);
    expect(g.body.erro.codigo).toBe('armazenamento_indisponivel');
    expect(g.body.erro.mensagem).toContain('transcrição em texto');
    const t = await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/transcrever`)
      .set(chefe)
      .expect(503);
    expect(t.body.erro.codigo).toBe('armazenamento_indisponivel');
    await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/gravacao`)
      .set(chefe)
      .send({ mime: 'text/plain' })
      .expect(400);
  });

  it('transcrição por texto e rascunho sem IA dividido pelos pontos', async () => {
    const t = await ctx
      .http()
      .put(`/v1/painel/reunioes/${id}/transcricao`)
      .set(chefe)
      .send({ texto: TRANSCRICAO })
      .expect(200);
    expect(t.body).toMatchObject({
      estado: 'realizada',
      transcricao: { estado: 'pronta', origem: 'texto' },
    });

    const r = await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/ata/rascunho`)
      .set(chefe)
      .send({})
      .expect(200);
    expect(r.body).toMatchObject({
      versao: 1,
      origem: 'sem_ia',
      estado: 'rascunho',
      ia_falhou: false,
      demonstracao: true,
      base_legal: { demonstracao: true },
    });
    expect(r.body.base_legal.fonte).toContain('Lei n.º 75/2013');
    const c = r.body.conteudo;
    expect(c.antes_da_ordem_do_dia).toContain('Declaro aberta');
    expect(c.cabecalho).toMatchObject({
      presidente: 'Ana Costa',
      numero: '1/2026',
    });
    expect(c.cabecalho.ausentes).toEqual([
      expect.objectContaining({
        nome: 'Eva Henriques',
        falta_justificada: true,
      }),
    ]);
    expect(c.pontos).toHaveLength(3);
    expect(c.pontos[1].transcricao).toContain('vinte anos');
    expect(c.pontos[1].intervencoes.map((i: any) => i.membro)).toEqual([
      'Ana Costa',
      'Bruno Dias',
      'Carla Faria',
    ]);
    expect(c.pontos[1].votacao).toEqual([
      { forca_politica: 'PS', a_favor: 0, contra: 0, abstencoes: 0 },
      { forca_politica: 'PSD', a_favor: 0, contra: 0, abstencoes: 0 },
    ]);
    expect(r.body.pendentes.length).toBeGreaterThanOrEqual(3);

    const d = await ctx
      .http()
      .get(`/v1/painel/reunioes/${id}`)
      .set(chefe)
      .expect(200);
    expect(d.body.estado).toBe('ata_rascunho');
  });

  it('não se aprova incompleta; a edição fica em versões (e não se perde trabalho alheio)', async () => {
    const inc = await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/ata/aprovar`)
      .set(chefe)
      .send({ modo: 'minuta' })
      .expect(409);
    expect(inc.body.erro.codigo).toBe('ata_incompleta');
    expect(inc.body.erro.detalhes.pendentes).toContain(
      'Ponto 1: falta o resultado da votação.',
    );

    const atual = await ctx
      .http()
      .get(`/v1/painel/reunioes/${id}/ata`)
      .set(chefe)
      .expect(200);
    const conteudo = atual.body.conteudo;
    conteudo.pontos[0].votacao = [
      { forca_politica: 'PS', a_favor: 2, contra: 0, abstencoes: 0 },
      { forca_politica: 'PSD', a_favor: 1, contra: 0, abstencoes: 0 },
    ];
    conteudo.pontos[0].deliberacao = 'Aprovada a ata da reunião anterior.';
    conteudo.pontos[1].resumo_discussao =
      'Discutiu-se o prazo da concessão do parque de estacionamento.';
    conteudo.pontos[1].votacao = [
      { forca_politica: 'PS', a_favor: 2, contra: 0, abstencoes: 0 },
      { forca_politica: 'PSD', a_favor: 0, contra: 1, abstencoes: 0 },
    ];
    conteudo.pontos[1].deliberacao =
      'A Câmara Municipal deliberou, por maioria, abrir o concurso público para a concessão do parque de estacionamento do Largo do Toural.';
    conteudo.pontos[1].declaracoes_voto = [
      {
        membro: 'Carla Faria',
        forca_politica: 'PSD',
        texto: 'Votámos contra por causa do prazo de vinte anos.',
      },
    ];
    conteudo.pontos[2].resultado = 'sem_votacao';
    conteudo.pontos[2].votacao = [];
    conteudo.pontos[2].deliberacao =
      'A Câmara tomou conhecimento dos apoios às associações desportivas.';

    const e = await ctx
      .http()
      .put(`/v1/painel/reunioes/${id}/ata`)
      .set(chefe)
      .send({ conteudo, versao: 1, nota: 'Votações preenchidas' })
      .expect(200);
    expect(e.body.versao).toBe(2);
    expect(e.body.conteudo.pontos.map((p: any) => p.resultado)).toEqual([
      'aprovada_unanimidade',
      'aprovada_maioria',
      'sem_votacao',
    ]);
    expect(e.body.pendentes).toEqual([]);
    expect(e.body.avisos).toEqual([]);

    const velha = await ctx
      .http()
      .put(`/v1/painel/reunioes/${id}/ata`)
      .set(chefe)
      .send({ conteudo, versao: 1 })
      .expect(409);
    expect(velha.body.erro.codigo).toBe('versao_desatualizada');

    const v = await ctx
      .http()
      .get(`/v1/painel/reunioes/${id}/ata/versoes`)
      .set(chefe)
      .expect(200);
    expect(v.body.itens.map((x: any) => [x.versao, x.origem])).toEqual([
      [2, 'edicao'],
      [1, 'sem_ia'],
    ]);
    const v1 = await ctx
      .http()
      .get(`/v1/painel/reunioes/${id}/ata/versoes/1`)
      .set(chefe)
      .expect(200);
    expect(v1.body.conteudo.pontos[0].resultado).toBe('por_preencher');
  });

  it('aprova em minuta (a reunião seguinte tem de ser posterior e do mesmo órgão)', async () => {
    const anterior = await ctx
      .http()
      .post('/v1/painel/reunioes')
      .set(chefe)
      .send({ ...REUNIAO, data: '2026-02-01' })
      .expect(201);
    const mal = await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/ata/aprovar`)
      .set(chefe)
      .send({ modo: 'reuniao_seguinte', reuniao_id: anterior.body.id })
      .expect(400);
    expect(mal.body.erro.codigo).toBe('reuniao_aprovacao_invalida');
    await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/ata/aprovar`)
      .set(chefe)
      .send({ modo: 'reuniao_seguinte' })
      .expect(400);

    // Ainda não aprovada: não se publica.
    const cedo = await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/ata/publicar`)
      .set(chefe)
      .expect(409);
    expect(cedo.body.erro.codigo).toBe('ata_por_aprovar');

    const a = await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/ata/aprovar`)
      .set(chefe)
      .send({ modo: 'minuta' })
      .expect(200);
    expect(a.body).toMatchObject({
      estado: 'aprovada',
      aprovacao: { modo: 'minuta' },
    });
    expect(a.body.aprovacao.texto).toContain('em minuta');

    const editar = await ctx
      .http()
      .put(`/v1/painel/reunioes/${id}/ata`)
      .set(chefe)
      .send({ conteudo: a.body.conteudo, versao: a.body.versao })
      .expect(409);
    expect(editar.body.erro.codigo).toBe('ata_ja_aprovada');
    await ctx
      .http()
      .put(`/v1/painel/reunioes/${id}`)
      .set(chefe)
      .send({ local: 'Outro sítio' })
      .expect(409);
  });

  it('antes de publicar, nada aparece na pesquisa', async () => {
    const p = await ctx
      .http()
      .get('/v1/painel/reunioes/deliberacoes?q=estacionamento')
      .set(chefe)
      .expect(200);
    expect(p.body.itens).toEqual([]);
  });

  it('publica: as deliberações entram no índice e a ata fica com PDF público', async () => {
    const p = await ctx
      .http()
      .post(`/v1/painel/reunioes/${id}/ata/publicar`)
      .set(chefe)
      .expect(200);
    expect(p.body).toMatchObject({
      estado: 'publicada',
      deliberacoes_indexadas: 3,
    });
    urlPdf = p.body.url_pdf_publico;
    expect(urlPdf).toMatch(/\/v1\/public\/atas\/[A-Za-z0-9_-]+\/pdf$/);

    const d = await ctx
      .http()
      .get(`/v1/painel/reunioes/${id}`)
      .set(chefe)
      .expect(200);
    expect(d.body.estado).toBe('publicada');

    const auditoria = await linhas<{ acao: string }>(
      ctx.db,
      `SELECT acao FROM audit_log WHERE municipio_id = $1 AND objeto_tipo IN ('reuniao', 'ata')
       ORDER BY em`,
      [MUNICIPIO_ID],
    );
    expect(auditoria.map((x) => x.acao)).toEqual(
      expect.arrayContaining([
        'criar',
        'gravar_transcricao_reuniao',
        'gerar_rascunho_ata',
        'editar_ata',
        'aprovar_ata',
        'publicar_ata',
      ]),
    );
    const acessos = await ctx
      .http()
      .get('/v1/painel/equipa/acessos')
      .set(chefe)
      .expect(200);
    expect(JSON.stringify(acessos.body)).toContain('publicou uma ata');
  });

  it('pesquisa no painel: por texto sem acentos e com filtros', async () => {
    const q = await ctx
      .http()
      .get('/v1/painel/reunioes/deliberacoes')
      .query({ q: 'concessao do parque' })
      .set(chefe)
      .expect(200);
    expect(q.body.modo).toBe('texto');
    expect(q.body.itens[0]).toMatchObject({
      ponto: 2,
      orgao: 'camara',
      orgao_nome: 'Câmara Municipal',
      data: '2026-03-12',
      resultado: 'aprovada_maioria',
      reuniao: { numero: '1/2026', tipo: 'ordinaria' },
    });
    expect(q.body.itens[0].votacao_texto).toBe(
      'Aprovada por maioria, com 2 votos a favor (PS 2) e 1 voto contra (PSD 1).',
    );
    expect(q.body.itens[0].declaracoes_voto).toHaveLength(1);
    expect(q.body.itens[0].ata_pdf).toBe(urlPdf);

    const sem = await ctx
      .http()
      .get('/v1/painel/reunioes/deliberacoes')
      .query({ q: 'associacoes desportivas' })
      .set(chefe)
      .expect(200);
    expect(sem.body.itens[0]).toMatchObject({
      ponto: 3,
      resultado: 'sem_votacao',
    });

    const todas = await ctx
      .http()
      .get('/v1/painel/reunioes/deliberacoes')
      .set(chefe)
      .expect(200);
    expect(todas.body.itens.map((x: any) => x.ponto)).toEqual([1, 2, 3]);

    const filtros = async (query: Record<string, string>) =>
      (
        await ctx
          .http()
          .get('/v1/painel/reunioes/deliberacoes')
          .query(query)
          .set(chefe)
          .expect(200)
      ).body.itens.map((x: any) => x.ponto);
    expect(await filtros({ votacao: 'aprovada' })).toEqual([1, 2]);
    expect(await filtros({ votacao: 'aprovada_maioria' })).toEqual([2]);
    expect(await filtros({ votacao: 'rejeitada' })).toEqual([]);
    expect(await filtros({ orgao: 'assembleia' })).toEqual([]);
    expect(await filtros({ de: '2026-03-13' })).toEqual([]);
    expect(await filtros({ de: '2026-03-01', ate: '2026-03-31' })).toEqual([
      1, 2, 3,
    ]);
    await ctx
      .http()
      .get('/v1/painel/reunioes/deliberacoes?votacao=talvez')
      .set(chefe)
      .expect(400);
  });

  it('pesquisa pública (só atas publicadas) e a ata pública', async () => {
    const p = await ctx
      .http()
      .get('/v1/public/deliberacoes')
      .query({ municipio: MUNICIPIO, q: 'estacionamento Toural' })
      .expect(200);
    expect(p.body.itens[0]).toMatchObject({
      ponto: 2,
      titulo: REUNIAO.ordem_do_dia[1].titulo,
    });
    const h = await ctx
      .http()
      .get('/v1/public/deliberacoes')
      .set('X-Municipio', MUNICIPIO)
      .query({ q: 'a câmara municipal já decidiu sobre a piscina?' })
      .expect(200);
    expect(h.body.itens).toEqual([]);
    await ctx.http().get('/v1/public/deliberacoes?q=parque').expect(400);

    const codigo = urlPdf.split('/').slice(-2)[0];
    const a = await ctx.http().get(`/v1/public/atas/${codigo}`).expect(200);
    expect(a.body).toMatchObject({
      orgao: 'camara',
      numero: '1/2026',
      url_pdf: urlPdf,
    });
    expect(a.body.deliberacoes).toHaveLength(3);
    expect(JSON.stringify(a.body)).not.toContain('Declaro aberta');
    await ctx.http().get('/v1/public/atas/naoexiste123').expect(404);
  });

  it('ferramenta procurar_deliberacoes: data, órgão, link do PDF e "dizer"', async () => {
    const r = await ferramenta(
      ctx,
      novaChamada('del'),
      'procurar_deliberacoes',
      {
        assunto: 'o parque de estacionamento do Toural',
      },
    ).expect(200);
    expect(r.body.encontradas).toBeGreaterThanOrEqual(1);
    expect(r.body.deliberacoes[0]).toMatchObject({
      data: '2026-03-12',
      orgao: 'Câmara Municipal',
      ponto: 2,
      resultado: 'aprovada por maioria',
      ata_pdf: urlPdf,
    });
    expect(r.body.dizer).toContain('12 de março de 2026');
    expect(r.body.dizer).toContain('a Câmara Municipal');

    const nada = await ferramenta(
      ctx,
      novaChamada('del'),
      'procurar_deliberacoes',
      {
        assunto: 'piscina olímpica',
      },
    ).expect(200);
    expect(nada.body).toMatchObject({ encontradas: 0, sem_resultados: true });
    expect(nada.body.dizer).toContain('Não encontrei');

    const assembleia = await ferramenta(
      ctx,
      novaChamada('del'),
      'procurar_deliberacoes',
      {
        assunto: 'parque de estacionamento',
        orgao: 'assembleia',
      },
    ).expect(200);
    expect(assembleia.body.sem_resultados).toBe(true);
  });

  it('PDF da ata: no painel e na página pública', async () => {
    const p = await ctx
      .http()
      .get(`/v1/painel/reunioes/${id}/ata/pdf`)
      .set(chefe)
      .buffer(true)
      .parse(binario)
      .expect(200);
    expect(p.headers['content-type']).toContain('application/pdf');
    expect((p.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const caminho = new URL(urlPdf).pathname;
    const pub = await ctx
      .http()
      .get(caminho)
      .buffer(true)
      .parse(binario)
      .expect(200);
    expect(pub.headers['content-type']).toContain('application/pdf');
    expect(pub.headers['content-disposition']).toContain(
      'ata-camara-1-2026.pdf',
    );
    expect((pub.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('permissões: chefe, vereador e quem secretaria (atendimento); o técnico não', async () => {
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    const t = await ctx
      .http()
      .get('/v1/painel/reunioes')
      .set(tecnico)
      .expect(403);
    expect(t.body.erro.codigo).toBe('sem_permissao');
    await ctx
      .http()
      .get('/v1/painel/reunioes/deliberacoes?q=parque')
      .set(tecnico)
      .expect(403);

    for (const perfil of ['vereador', 'atendimento']) {
      const h = await entrarPainel(ctx, await criarUtilizador(ctx, perfil));
      await ctx.http().get('/v1/painel/reunioes').set(h).expect(200);
      await ctx.http().get(`/v1/painel/reunioes/${id}/ata`).set(h).expect(200);
    }
    await ctx.http().get('/v1/painel/reunioes').expect(401);
  });
});
