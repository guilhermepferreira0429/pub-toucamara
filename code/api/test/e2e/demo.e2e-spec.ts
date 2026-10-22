/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { PainelDadosService } from '../../src/modules/painel/painel-dados.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  esperarAte,
  linha,
  linhas,
  MUNICIPIO,
  MUNICIPIO_ID,
} from './app';

/**
 * "Preparar demo": ensaio sem mudanças, preparação idempotente (duas vezes
 * = os mesmos números), o painel e o /agora com os dados, "limpar testes"
 * esconde (e "repor" volta a mostrar) o que não é demo, permissões e a
 * variável DEMO_ATIVA.
 */
describe('Preparar demo (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  let conversaTeste: string;
  let ocorrenciaTeste: string;

  // Sem acertar a base: os outros testes contam com o seed ("Águas do
  // Concelho", "Chefe Teste"). O acerto da base testa-se à parte, no fim.
  const preparar = (corpo: object) =>
    ctx
      .http()
      .post('/v1/painel/demo/preparar')
      .set(chefe)
      .send({ acertar_base: false, ...corpo });

  /** Os números que não podem mudar numa segunda preparação. */
  const numeros = async () =>
    linha(
      ctx.db,
      `SELECT (SELECT count(*)::int FROM demo_registos WHERE municipio_id = $1) AS registos,
              (SELECT count(*)::int FROM conversas WHERE municipio_id = $1) AS conversas,
              (SELECT count(*)::int FROM ocorrencias WHERE municipio_id = $1) AS ocorrencias,
              (SELECT count(*)::int FROM processos WHERE municipio_id = $1) AS processos,
              (SELECT count(*)::int FROM licencas WHERE municipio_id = $1) AS licencas,
              (SELECT count(*)::int FROM passagens_humano p JOIN conversas c ON c.id = p.conversa_id
                WHERE c.municipio_id = $1) AS passagens,
              (SELECT count(*)::int FROM eventos WHERE municipio_id = $1) AS eventos,
              (SELECT count(*)::int FROM comunicados WHERE municipio_id = $1) AS comunicados,
              (SELECT count(*)::int FROM marcacoes mc JOIN agendas a ON a.id = mc.agenda_id
                WHERE a.municipio_id = $1) AS marcacoes`,
      [MUNICIPIO_ID],
    );

  const demoId = async (chave: string) =>
    (
      await linha<{ objeto_id: string }>(
        ctx.db,
        'SELECT objeto_id FROM demo_registos WHERE municipio_id = $1 AND chave = $2',
        [MUNICIPIO_ID, chave],
      )
    )?.objeto_id;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
    // Uma conversa e uma ocorrência "de teste" da equipa (não são da demo).
    const c = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO conversas (municipio_id, canal, provider_id, iniciada_em, resultado, resumo)
       VALUES ($1, 'telefone', $2, now() - interval '1 hour', 'resolvida', 'Chamada de teste da equipa')
       RETURNING id`,
      [MUNICIPIO_ID, `teste-${randomUUID()}`],
    );
    conversaTeste = c!.id;
    const o = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, conversa_id)
       SELECT $1, 'OC-T' || substr(md5(random()::text), 1, 6), id, 'Teste da equipa', 'Rua do Teste', $2
       FROM categorias_ocorrencia WHERE municipio_id = $1 ORDER BY nome LIMIT 1
       RETURNING id`,
      [MUNICIPIO_ID, conversaTeste],
    );
    ocorrenciaTeste = o!.id;
  });
  afterAll(async () => {
    delete process.env.DEMO_ATIVA;
    await ctx.fechar();
  });

  it('só a chefia: o técnico não entra', async () => {
    await ctx.http().get('/v1/painel/demo/estado').set(tecnico).expect(403);
    await ctx
      .http()
      .post('/v1/painel/demo/preparar')
      .set(tecnico)
      .send({ confirmar: true })
      .expect(403);
    const e = await ctx
      .http()
      .get('/v1/painel/demo/estado')
      .set(chefe)
      .expect(200);
    expect(e.body).toMatchObject({
      ativa: true,
      preparada: false,
      total_registos: 0,
    });
  });

  it('DEMO_ATIVA=false desliga as rotas (o estado diz que está desligada)', async () => {
    process.env.DEMO_ATIVA = 'false';
    try {
      const r = await preparar({ confirmar: true }).expect(404);
      expect(r.body.erro.codigo).toBe('demo_desligada');
      await ctx
        .http()
        .post('/v1/painel/demo/repor-ocultos')
        .set(chefe)
        .expect(404);
      const e = await ctx
        .http()
        .get('/v1/painel/demo/estado')
        .set(chefe)
        .expect(200);
      expect(e.body).toMatchObject({ ativa: false });
    } finally {
      delete process.env.DEMO_ATIVA;
    }
    expect(await numeros()).toMatchObject({ registos: 0 });
  });

  it('o ensaio diz o que faria e não muda nada', async () => {
    const antes = await numeros();
    const r = await preparar({ limpar_testes: true }).expect(200);
    expect(r.body).toMatchObject({ ensaio: true, ja_existem: 0 });
    expect(r.body.a_criar).toBeGreaterThan(50);
    expect(r.body.ocultar.conversas).toBeGreaterThanOrEqual(1);
    expect(r.body.ocultar.ocorrencias).toBeGreaterThanOrEqual(1);
    expect(r.body.passos.map((p: { passo: string }) => p.passo)).toContain(
      'licencas',
    );
    expect(await numeros()).toEqual(antes);
    const c = await linha(
      ctx.db,
      'SELECT oculto_em FROM conversas WHERE id = $1',
      [conversaTeste],
    );
    expect(c.oculto_em).toBeNull();
  });

  it('prepara tudo, esconde os testes, e duas vezes dá os mesmos números', async () => {
    const r = await preparar({ limpar_testes: true, confirmar: true }).expect(
      200,
    );
    expect(r.body.ensaio).toBe(false);
    // Sem S3 nos testes, o único aviso aceitável é o das fotografias.
    expect(
      r.body.avisos.filter((a: string) => !a.startsWith('fotografias')),
    ).toEqual([]);
    expect(r.body.ocultados.conversas).toBeGreaterThanOrEqual(1);
    expect(
      r.body.passos.every((p: { a_criar: number }) => p.a_criar === 0),
    ).toBe(true);
    expect(r.body.criados).toMatchObject({
      conversas: 45,
      licencas: 3,
      // 4 noutras fases + 3 das antecipações + 3 da análise por tipo de operação.
      processos: 10,
    });
    const antecipacoes = await linhas(
      ctx.db,
      `SELECT chave FROM demo_registos WHERE municipio_id = $1 AND chave LIKE 'antecipacao:%'`,
      [MUNICIPIO_ID],
    );
    expect(antecipacoes).toHaveLength(3);

    const depois1 = await numeros();
    const r2 = await preparar({ limpar_testes: true, confirmar: true }).expect(
      200,
    );
    expect(r2.body.criados).toEqual({});
    expect(
      r2.body.avisos.filter((a: string) => !a.startsWith('fotografias')),
    ).toEqual([]);
    expect(await numeros()).toEqual(depois1);

    const e = await ctx
      .http()
      .get('/v1/painel/demo/estado')
      .set(chefe)
      .expect(200);
    expect(e.body).toMatchObject({
      ativa: true,
      preparada: true,
      vezes: 2,
      total_registos: depois1.registos,
    });
    expect(e.body.ocultos.conversas).toBeGreaterThanOrEqual(1);
    const audit = await linhas(
      ctx.db,
      `SELECT acao FROM audit_log WHERE municipio_id = $1 AND objeto_tipo = 'demo'`,
      [MUNICIPIO_ID],
    );
    expect(audit.map((a) => a.acao)).toEqual(
      expect.arrayContaining(['preparar_demo', 'ocultar_testes']),
    );
  });

  it('o painel mostra os dados: visão geral, conversas, ocorrências com duplicados, licenças', async () => {
    await ctx.app.get(PainelDadosService).refrescar();
    const vg = await ctx
      .http()
      .get('/v1/painel/visao-geral')
      .set(chefe)
      .expect(200);
    expect(vg.body.o_que_perguntam.length).toBeGreaterThan(3);
    expect(vg.body.atencao.passagens.total).toBe(2);
    expect(vg.body.atencao.prazos_a_acabar.itens.length).toBeGreaterThanOrEqual(
      1,
    );

    const conv = await ctx
      .http()
      .get('/v1/painel/conversas?limite=100')
      .set(chefe)
      .expect(200);
    const ids = conv.body.itens.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(conversaTeste);
    expect(
      new Set(conv.body.itens.map((c: { canal: string }) => c.canal)),
    ).toEqual(new Set(['telefone', 'chat', 'sms', 'whatsapp']));

    const oc = await ctx
      .http()
      .get('/v1/painel/ocorrencias')
      .set(chefe)
      .expect(200);
    const original = await demoId('ocorrencia:buraco_1');
    const naLista = oc.body.itens.find(
      (o: { id: string }) => o.id === original,
    );
    expect(naLista).toMatchObject({ estado: 'nova', duplicados: 2 });
    expect(oc.body.itens.map((o: { id: string }) => o.id)).not.toContain(
      ocorrenciaTeste,
    );
    const estados = new Set(
      oc.body.itens.map((o: { estado: string }) => o.estado),
    );
    expect(estados).toEqual(new Set(['nova', 'com_equipa', 'resolvida']));

    const lic = await ctx
      .http()
      .get('/v1/painel/licencas')
      .set(chefe)
      .expect(200);
    const porId = (id: string | undefined) =>
      lic.body.licencas.find((l: { id: string }) => l.id === id);
    expect(porId(await demoId('licenca:ruido_emitida'))).toMatchObject({
      estado: 'emitida',
      pagamento: { estado: 'pago', modo_teste: true },
    });
    expect(porId(await demoId('licenca:ruido_tecnico'))).toMatchObject({
      estado: 'para_tecnico',
    });
    const esplanada = await linha(
      ctx.db,
      `SELECT estado, valida_ate - current_date AS dias FROM licencas WHERE id = $1`,
      [await demoId('licenca:esplanada')],
    );
    expect(esplanada.estado).toBe('emitida');
    expect(esplanada.dias).toBeLessThanOrEqual(7);

    const porta = await linha(
      ctx.db,
      `SELECT p.numero, p.assunto, p.demonstracao, c.provider_id
       FROM processos p LEFT JOIN conversas c ON c.id = p.conversa_origem_id WHERE p.id = $1`,
      [await demoId('processo:porta_cozinha')],
    );
    expect(porta).toMatchObject({
      assunto: 'Porta na cozinha',
      demonstracao: true,
    });
    // Numeração contínua: não fica o número do design (CP 412).
    expect(porta.numero).toMatch(/^CP \d+\/\d{4}$/);
    expect(porta.numero).not.toMatch(/^CP (DEMO-)?412\//);
    const esplanadaDecisao = await linha(
      ctx.db,
      'SELECT decisao, decidida_por FROM licencas WHERE id = $1',
      [await demoId('licenca:esplanada')],
    );
    // Cumpre as regras: não é uma exceção, nem foi aprovada pelo fornecedor.
    expect(esplanadaDecisao).toMatchObject({ decisao: 'automatica' });
    expect(porta.provider_id).toContain('porta_cozinha');

    const ls = await linha(
      ctx.db,
      `SELECT v.estado, v.origem, v.revista_por IS NOT NULL AS revista
       FROM documento_simples_versoes v WHERE v.documento_id = $1 AND v.estado = 'publicada'`,
      [await demoId('documento_simples:esplanadas')],
    );
    expect(ls).toMatchObject({
      estado: 'publicada',
      origem: 'manual',
      revista: true,
    });
  });

  it('o conhecimento prova o que se diz: respostas no ar, fontes citadas, qualidade, alteração e contradição', async () => {
    const mapa = await ctx
      .http()
      .get('/v1/painel/conhecimento/mapa')
      .set(chefe)
      .expect(200);
    expect(mapa.body.resumo.respostas_no_ar).toBeGreaterThanOrEqual(15);
    expect(mapa.body.resumo.alteracoes_por_rever).toBeGreaterThanOrEqual(1);
    expect(mapa.body.resumo.contradicoes_abertas).toBeGreaterThanOrEqual(1);
    const obras = mapa.body.temas.find(
      (t: { nome: string }) => t.nome === 'Obras e licenciamento',
    );
    expect(obras.respostas_no_ar).toBeGreaterThanOrEqual(3);

    // As conversas resolvidas da demo citam a fonte; as passadas, não.
    const citadas = await linha<{ resolvidas: number; passadas: number }>(
      ctx.db,
      `SELECT count(*) FILTER (WHERE c.resultado = 'resolvida' AND EXISTS (
                SELECT 1 FROM conversa_turnos t JOIN citacoes ci ON ci.turno_id = t.id
                WHERE t.conversa_id = c.id))::int AS resolvidas,
              count(*) FILTER (WHERE c.resultado = 'passada_funcionario' AND EXISTS (
                SELECT 1 FROM conversa_turnos t JOIN citacoes ci ON ci.turno_id = t.id
                WHERE t.conversa_id = c.id))::int AS passadas
       FROM demo_registos d JOIN conversas c ON c.id = d.objeto_id
       WHERE d.municipio_id = $1 AND d.tipo = 'conversa'`,
      [MUNICIPIO_ID],
    );
    expect(citadas!.resolvidas).toBeGreaterThan(30);
    expect(citadas!.passadas).toBe(0);

    // As execuções de demonstração, lidas na BD: o painel só as mostra quando
    // não há nenhuma medida, e a BD dos testes é partilhada (outros testes
    // correm avaliações a sério no mesmo município).
    const { rows: demoExecucoes } = await ctx.db.query<{
      taxa: number | null;
    }>(
      `SELECT r.taxa::float8 AS taxa
       FROM avaliacao.execucoes e
       JOIN avaliacao.sistemas s ON s.id = e.sistema_id
       LEFT JOIN avaliacao.resultados r ON r.execucao_id = e.id AND r.categoria IS NULL
       WHERE s.municipio_id = $1 AND s.nosso AND s.adaptador = 'tou-chat'
         AND coalesce((s.config->>'demonstracao')::boolean, false)
         AND e.estado = 'terminada' AND NOT e.amostra
       ORDER BY e.terminada_em, e.id`,
      [MUNICIPIO_ID],
    );
    expect(demoExecucoes.length).toBe(3);
    expect(demoExecucoes[0].taxa).toBeLessThan(80);
    expect(demoExecucoes[2].taxa).toBeGreaterThanOrEqual(80);

    // No painel: sem nenhuma medida, as de demonstração (assinaladas); com
    // alguma medida, só as medidas.
    const q = await ctx
      .http()
      .get('/v1/painel/conhecimento/qualidade')
      .set(chefe)
      .expect(200);
    const evolucao = q.body.evolucao as { demonstracao: boolean }[];
    const temMedidas = evolucao.some((e) => !e.demonstracao);
    expect(evolucao.every((e) => e.demonstracao === !temMedidas)).toBe(true);

    const alteracao = await linha(
      ctx.db,
      `SELECT a.estado, ar.proposta_versao_id, v.texto_voz
       FROM alteracoes a
       JOIN alteracao_respostas ar ON ar.alteracao_id = a.id
       JOIN resposta_versoes v ON v.id = ar.proposta_versao_id
       WHERE a.id = $1`,
      [await demoId('alteracao:esplanadas')],
    );
    expect(alteracao.estado).toBe('por_rever');
    expect(alteracao.texto_voz).toContain('3,50 euros');

    const contradicao = await linha(
      ctx.db,
      'SELECT estado, valor_a, valor_b FROM contradicoes WHERE id = $1',
      [await demoId('contradicao:esplanadas')],
    );
    expect(contradicao).toMatchObject({ estado: 'aberta' });

    // "Sem resposta": o total e a lista vêm da mesma tabela.
    const vg = await ctx
      .http()
      .get('/v1/painel/visao-geral')
      .set(chefe)
      .expect(200);
    expect(vg.body.atencao.sem_resposta.total).toBeGreaterThanOrEqual(
      vg.body.atencao.sem_resposta.itens.length,
    );
    const piscina = await linha(
      ctx.db,
      'SELECT estado, vezes, resposta_id FROM perguntas_sem_resposta WHERE id = $1',
      [await demoId('pergunta_sem_resposta:piscina')],
    );
    expect(piscina).toMatchObject({ estado: 'com_equipa', vezes: 2 });
    expect(piscina.resposta_id).toBe(await demoId('resposta:piscina'));

    // Os avisos enviados têm destinatários.
    const aviso = await linha<{ n: number }>(
      ctx.db,
      'SELECT count(*)::int AS n FROM avisos_zona_destinatarios WHERE aviso_id = $1',
      [await demoId('aviso:obras')],
    );
    expect(aviso!.n).toBeGreaterThan(0);
  });

  it('o /agora público mostra obras, corte de água, eventos, comunicados e a consulta', async () => {
    const f = await ctx
      .http()
      .get(`/v1/public/agora/${MUNICIPIO}?limite=100`)
      .expect(200);
    const ids = f.body.itens.map((i: { id: string }) => i.id);
    for (const chave of [
      'aviso:obras',
      'aviso:agua',
      'evento:feira',
      'comunicado:balcao',
      'consulta:toural',
    ]) {
      expect(ids).toContain(await demoId(chave));
    }
    expect(ids).not.toContain(ocorrenciaTeste);
  });

  it('os SMS para a gama de teste não saem para o operador', async () => {
    const m = await esperarAte(() =>
      linha<{ estado: string; provider_id: string }>(
        ctx.db,
        `SELECT estado, provider_id FROM mensagens_saida
         WHERE destino LIKE '+351910000%' AND estado = 'enviada' LIMIT 1`,
      ),
    );
    expect(m.provider_id).toBe('demonstracao');
  });

  it('repor volta a mostrar o que estava escondido', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/demo/repor-ocultos')
      .set(chefe)
      .expect(200);
    expect(r.body.repostos.conversas).toBeGreaterThanOrEqual(1);
    // (A lista do painel é paginada e a BD partilhada tem muitas conversas.)
    const c = await linha(
      ctx.db,
      'SELECT oculto_em FROM conversas WHERE id = $1',
      [conversaTeste],
    );
    expect(c.oculto_em).toBeNull();
    const o = await linha(
      ctx.db,
      'SELECT oculto_em FROM ocorrencias WHERE id = $1',
      [ocorrenciaTeste],
    );
    expect(o.oculto_em).toBeNull();
  });

  it('acerta a base com nomes de teste (Vimágua, a chefia) e repõe-se para os outros testes', async () => {
    const antes = await linha<{ chefe: string; agua: string }>(
      ctx.db,
      `SELECT (SELECT nome FROM utilizadores WHERE municipio_id = $1 AND nome = 'Chefe Teste' LIMIT 1) AS chefe,
              (SELECT nome FROM entidades WHERE municipio_id = $1 AND nome = 'Águas do Concelho') AS agua`,
      [MUNICIPIO_ID],
    );
    try {
      await preparar({ confirmar: true, acertar_base: true }).expect(200);
      const depois = await linha<{ agua: number; chefe: number }>(
        ctx.db,
        `SELECT (SELECT count(*)::int FROM entidades WHERE municipio_id = $1 AND nome = 'Vimágua') AS agua,
                (SELECT count(*)::int FROM utilizadores WHERE municipio_id = $1 AND nome = 'Chefe Teste') AS chefe`,
        [MUNICIPIO_ID],
      );
      if (antes?.agua) expect(depois!.agua).toBe(1);
      expect(depois!.chefe).toBe(0);
    } finally {
      // O seed volta ao que era (os outros testes contam com ele).
      if (antes?.agua) {
        await ctx.db.query(
          `UPDATE entidades SET nome = 'Águas do Concelho', descricao = 'Água e saneamento', site_url = NULL
           WHERE municipio_id = $1 AND nome = 'Vimágua'`,
          [MUNICIPIO_ID],
        );
        await ctx.db.query(
          `UPDATE entidade_contactos SET tipo = 'avarias', valor = '800 000 000',
             rotulo = 'Avarias, 24 horas', horario = '{"sempre": true}'
           WHERE id = '00000000-0000-0000-0000-0000000000c2'`,
        );
      }
      if (antes?.chefe) {
        await ctx.db.query(
          `UPDATE utilizadores SET nome = 'Chefe Teste' WHERE id = '00000000-0000-0000-0000-0000000000a9'`,
        );
      }
    }
  });
});
