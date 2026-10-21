/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { hojeLisboa } from '../../src/common/dias-uteis';
import { ConsultasPublicasService } from '../../src/modules/consultas-publicas/consultas-publicas.service';
import { MunicipiosService } from '../../src/modules/municipios/municipios.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO,
  novaChamada,
  novoTelefone,
  smsPara,
} from './app';

function somar(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Consulta pública por telefone, com resultados por freguesia: o painel cria
 * e abre, o agente explica e regista (uma por pessoa, pode mudar), a página
 * pública deixa participar com o telemóvel e mostra o resultado no fim.
 */
describe('Consultas públicas (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  const hoje = hojeLisboa();
  const sufixo = Date.now();
  const AZUREM = `Azurém ${sufixo}`;
  const CREIXOMIL = `Creixomil ${sufixo}`;
  let id: string;
  let codigo: string;

  const CONSULTA = {
    titulo: 'Ciclovia na Avenida E2E',
    resumo:
      'A câmara quer fazer uma ciclovia na avenida principal. Isto tira 20 lugares de estacionamento de um dos lados.',
    documento_titulo: 'Estudo prévio da ciclovia',
    documento_url: 'https://www.cm-teste.pt/ciclovia.pdf',
    perguntas: [
      {
        texto: 'Concorda com a ciclovia?',
        opcoes: ['Concordo', 'Não concordo', 'Tenho dúvidas'],
      },
    ],
    pergunta_aberta: 'Quer deixar uma opinião ou sugestão?',
    freguesias: [AZUREM, CREIXOMIL],
    abre_em: hoje,
    fecha_em: somar(hoje, 10),
  };

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  it('permissões: atendimento não vê; vereação vê mas não cria', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    const r = await ctx
      .http()
      .get('/v1/painel/consultas')
      .set(atendimento)
      .expect(403);
    expect(r.body.erro.detalhes).toEqual({ recurso: 'indicadores' });

    const vereador = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'vereador'),
    );
    await ctx.http().get('/v1/painel/consultas').set(vereador).expect(200);
    await ctx
      .http()
      .post('/v1/painel/consultas')
      .set(vereador)
      .send(CONSULTA)
      .expect(403);
  });

  it('criar em rascunho: datas validadas, relatório 15 dias depois por omissão', async () => {
    await ctx
      .http()
      .post('/v1/painel/consultas')
      .set(chefe)
      .send({ ...CONSULTA, fecha_em: somar(hoje, -1) })
      .expect(400);

    const r = await ctx
      .http()
      .post('/v1/painel/consultas')
      .set(chefe)
      .send(CONSULTA)
      .expect(201);
    id = r.body.id;
    codigo = r.body.codigo;
    expect(codigo).toMatch(/^[A-Z0-9]{8}$/);

    const d = await ctx
      .http()
      .get(`/v1/painel/consultas/${id}`)
      .set(chefe)
      .expect(200);
    expect(d.body).toMatchObject({
      estado: 'rascunho',
      situacao: 'rascunho',
      relatorio_em: somar(hoje, 25),
      perguntas: [
        {
          id: 'p1',
          opcoes: [
            { id: 'concordo' },
            { id: 'nao_concordo' },
            { id: 'tenho_duvidas' },
          ],
        },
      ],
      link: expect.stringMatching(new RegExp(`/consulta/${codigo}$`)),
    });

    // Em rascunho não existe para fora nem para o agente.
    await ctx.http().get(`/v1/public/consultas-publicas/${codigo}`).expect(404);
    const a = await ferramenta(ctx, novaChamada('cp'), 'consultas_abertas');
    expect(
      (a.body.consultas as { codigo: string }[]).some(
        (c) => c.codigo === codigo,
      ),
    ).toBe(false);
  });

  it('abrir: o agente passa a saber a consulta', async () => {
    const r = await ctx
      .http()
      .post(`/v1/painel/consultas/${id}/abrir`)
      .set(chefe)
      .expect(200);
    expect(r.body).toMatchObject({ estado: 'aberta', situacao: 'aberta' });

    const a = await ferramenta(
      ctx,
      novaChamada('cp'),
      'consultas_abertas',
    ).expect(200);
    const c = (a.body.consultas as Record<string, unknown>[]).find(
      (x) => x.codigo === codigo,
    );
    expect(c).toMatchObject({
      titulo: CONSULTA.titulo,
      explicacao: CONSULTA.resumo,
      pergunta_aberta: CONSULTA.pergunta_aberta,
      ja_participou: false,
      onde: `freguesias de ${AZUREM}, ${CREIXOMIL}`,
    });
  });

  it('participar_consulta: pede o que falta, regista, uma por pessoa e pode mudar', async () => {
    const chamada = novaChamada('cp');
    const sem = await ferramenta(ctx, chamada, 'participar_consulta', {
      consulta: codigo,
      respostas: [],
    }).expect(200);
    expect(sem.body).toMatchObject({
      registada: false,
      motivo: 'faltam_respostas',
      em_falta: [{ pergunta: 'p1', opcoes: expect.any(Array) }],
    });

    const semFreguesia = await ferramenta(ctx, chamada, 'participar_consulta', {
      consulta: codigo,
      respostas: [{ pergunta: 'p1', opcao: 'concordo' }],
    }).expect(200);
    expect(semFreguesia.body).toMatchObject({
      registada: false,
      motivo: 'falta_freguesia',
    });

    const r = await ferramenta(ctx, chamada, 'participar_consulta', {
      consulta: codigo,
      respostas: [{ pergunta: 'p1', opcao: 'Concordo' }],
      opiniao: 'Boa ideia, mas falta estacionamento. Liguem-me: 912 345 678',
      freguesia: AZUREM.toLowerCase(),
    }).expect(200);
    expect(r.body).toMatchObject({
      registada: true,
      alterada: false,
      freguesia: AZUREM,
      dizer: expect.stringContaining('A sua opinião foi registada'),
    });
    expect(r.body.dizer).toContain('O relatório com os resultados sai a');

    // A mesma pessoa noutra chamada: substitui (não conta duas vezes).
    const outra = {
      conversa: novaChamada('cp').conversa,
      telefone: chamada.telefone,
    };
    const a = await ferramenta(ctx, outra, 'consultas_abertas').expect(200);
    expect(
      (a.body.consultas as Record<string, unknown>[]).find(
        (x) => x.codigo === codigo,
      ),
    ).toMatchObject({
      ja_participou: true,
      resposta_anterior: [{ opcao: 'Concordo' }],
    });
    const m = await ferramenta(ctx, outra, 'participar_consulta', {
      consulta: codigo,
      respostas: [{ opcao: 'não concordo' }],
    }).expect(200);
    expect(m.body).toMatchObject({
      registada: true,
      alterada: true,
      freguesia: AZUREM,
    });
    const n = await linha<{ n: number }>(
      ctx.db,
      'SELECT count(*)::int AS n FROM consulta_participacoes WHERE consulta_id = $1',
      [id],
    );
    expect(n?.n).toBe(1);
  });

  it('a freguesia deduz-se da morada', async () => {
    const r = await ferramenta(ctx, novaChamada('cp'), 'participar_consulta', {
      consulta: codigo,
      respostas: [{ pergunta: 'p1', opcao: 'tenho dúvidas' }],
      morada: `Rua da Escola 3, ${CREIXOMIL}`,
    }).expect(200);
    expect(r.body).toMatchObject({ registada: true, freguesia: CREIXOMIL });
    const p = await linha<{ freguesia_origem: string; canal: string }>(
      ctx.db,
      `SELECT freguesia_origem, canal FROM consulta_participacoes
       WHERE consulta_id = $1 AND freguesia = $2`,
      [id, CREIXOMIL],
    );
    expect(p).toEqual({ freguesia_origem: 'morada', canal: 'telefone' });
  });

  it('no chat sem identificação pede que a pessoa se identifique', async () => {
    const servico = ctx.app.get(ConsultasPublicasService);
    const municipio = await ctx.app.get(MunicipiosService).porSlug(MUNICIPIO);
    const r = await servico.participar(
      {
        municipio,
        canal: 'chat',
        conversaId: null,
        municipeId: null,
        telefone: null,
      },
      {
        consulta: codigo,
        respostas: [{ pergunta: 'p1', opcao: 'concordo' }],
        freguesia: AZUREM,
      },
    );
    expect(r).toMatchObject({
      registada: false,
      motivo: 'precisa_identificacao',
    });
  });

  it('página pública: código por SMS e participação sem login', async () => {
    const pub = await ctx
      .http()
      .get(`/v1/public/consultas-publicas/${codigo.toLowerCase()}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      titulo: CONSULTA.titulo,
      pode_participar: true,
      resultados: null,
      freguesias_sugeridas: [AZUREM, CREIXOMIL],
    });

    const telefone = novoTelefone();
    const p = await ctx
      .http()
      .post(`/v1/public/consultas-publicas/${codigo}/codigo`)
      .send({ telefone })
      .expect(200);
    const [sms] = await smsPara(ctx, telefone, 'identificacao');
    const numero = /(\d{6})/.exec(sms.corpo)?.[1];
    expect(numero).toBeDefined();

    // Código errado não regista.
    await ctx
      .http()
      .post(`/v1/public/consultas-publicas/${codigo}/participar`)
      .send({
        pedido: p.body.pedido,
        codigo: numero === '000000' ? '111111' : '000000',
        respostas: { p1: 'concordo' },
        freguesia: AZUREM,
      })
      .expect(400);

    const r = await ctx
      .http()
      .post(`/v1/public/consultas-publicas/${codigo}/participar`)
      .send({
        pedido: p.body.pedido,
        codigo: numero,
        respostas: { p1: 'concordo' },
        opiniao: 'Mais segurança para as crianças que vão de bicicleta.',
        freguesia: AZUREM,
      })
      .expect(200);
    expect(r.body.participacao).toMatchObject({
      registada: true,
      alterada: false,
    });
    expect(r.body.participacao.dizer).toContain('A sua opinião foi registada');
    const c = await linha<{ canal: string }>(
      ctx.db,
      `SELECT p.canal FROM consulta_participacoes p JOIN municipes m ON m.id = p.municipe_id
       WHERE p.consulta_id = $1 AND m.telefone_e164 = $2`,
      [id, telefone],
    );
    expect(c?.canal).toBe('pagina');

    // O código só serve uma vez.
    await ctx
      .http()
      .post(`/v1/public/consultas-publicas/${codigo}/participar`)
      .send({
        pedido: p.body.pedido,
        codigo: numero,
        respostas: { p1: 'concordo' },
        freguesia: AZUREM,
      })
      .expect(410);
  });

  it('painel: resultados por freguesia, resumo sem IA e CSV anonimizado', async () => {
    const d = await ctx
      .http()
      .get(`/v1/painel/consultas/${id}`)
      .set(chefe)
      .expect(200);
    expect(d.body.resultados.total).toBe(3);
    expect(d.body.resultados.freguesias).toEqual([
      { freguesia: AZUREM, abrangida: true, participacoes: 2 },
      { freguesia: CREIXOMIL, abrangida: true, participacoes: 1 },
    ]);
    const p1 = d.body.resultados.perguntas[0];
    expect(p1.opcoes.map((o: { n: number }) => o.n)).toEqual([1, 1, 1]);
    expect(p1.por_freguesia[0].opcoes).toEqual({
      concordo: 1,
      nao_concordo: 1,
      tenho_duvidas: 0,
    });
    expect(d.body.populacao).toBeNull();
    expect(d.body.total_opinioes).toBe(2);
    // A opinião aparece sem o número de telefone.
    expect(
      (d.body.opinioes as { opiniao: string }[]).some(
        (o) => o.opiniao.includes('[número]') && !o.opiniao.includes('912'),
      ),
    ).toBe(true);

    const s = await ctx
      .http()
      .post(`/v1/painel/consultas/${id}/resumo`)
      .set(chefe)
      .expect(200);
    expect(s.body.resumo_opinioes).toMatchObject({
      ia: false,
      opinioes: 2,
      motivo_sem_ia: expect.any(String),
      por_opcao: expect.any(Array),
    });

    const csv = await ctx
      .http()
      .get(`/v1/painel/consultas/${id}/participacoes.csv`)
      .set(chefe)
      .expect(200)
      .expect('Content-Type', /text\/csv/);
    const texto = String(csv.text ?? csv.body);
    expect(texto).toContain(
      'n;dia;canal;freguesia;Concorda com a ciclovia?;opiniao',
    );
    expect(texto).not.toMatch(/\+351/);
    expect(texto).not.toContain('912 345 678');

    const audit = await linhas<{ acao: string }>(
      ctx.db,
      `SELECT acao FROM audit_log WHERE objeto_tipo = 'consulta_publica' AND objeto_id = $1`,
      [id],
    );
    expect(audit.map((a) => a.acao)).toEqual(
      expect.arrayContaining([
        'criar',
        'abrir_consulta',
        'participar_consulta',
        'alterar_participacao',
        'resumir_opinioes',
        'exportar_participacoes',
      ]),
    );
  });

  it('não se mudam as perguntas depois de haver participações', async () => {
    const r = await ctx
      .http()
      .patch(`/v1/painel/consultas/${id}`)
      .set(chefe)
      .send({
        perguntas: [{ texto: 'Outra pergunta?', opcoes: ['Sim', 'Não'] }],
      })
      .expect(409);
    expect(r.body.erro.codigo).toBe('perguntas_com_participacoes');
    await ctx
      .http()
      .patch(`/v1/painel/consultas/${id}`)
      .set(chefe)
      .send({ titulo: 'Ciclovia na Avenida E2E (revista)' })
      .expect(200);
  });

  it('ligar às pessoas inscritas: campanha de chamadas ligada à consulta (ação social)', async () => {
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await ctx
      .http()
      .post(`/v1/painel/consultas/${id}/ligar`)
      .set(tecnico)
      .expect(403);
    await ctx
      .http()
      .post('/v1/painel/campanhas/contactos')
      .set(chefe)
      .send({
        nome: 'Pessoa Consulta',
        telefone: novoTelefone(),
        freguesia: AZUREM,
      })
      .expect(201);
    const pv = await ctx
      .http()
      .post(`/v1/painel/consultas/${id}/pre-visualizar-ligar`)
      .set(chefe)
      .expect(200);
    expect(pv.body.a_ligar).toBe(1);
    const r = await ctx
      .http()
      .post(`/v1/painel/consultas/${id}/ligar`)
      .set(chefe)
      .expect(201);
    expect(r.body.campanha).toMatchObject({ a_ligar: 1 });
    const ch = await linha<{ contexto: { o_que_mudou: string } }>(
      ctx.db,
      `SELECT cs.contexto FROM campanha_destinatarios d JOIN chamadas_saida cs ON cs.id = d.chamada_saida_id
       WHERE d.campanha_id = $1`,
      [r.body.campanha.id],
    );
    expect(ch?.contexto.o_que_mudou).toContain(codigo);
    const d = await ctx
      .http()
      .get(`/v1/painel/consultas/${id}`)
      .set(chefe)
      .expect(200);
    expect(d.body.campanhas).toHaveLength(1);
  });

  it('fechar: não se participa mais e a página mostra os resultados', async () => {
    await ctx
      .http()
      .post(`/v1/painel/consultas/${id}/fechar`)
      .set(chefe)
      .expect(200);
    const r = await ferramenta(ctx, novaChamada('cp'), 'participar_consulta', {
      consulta: codigo,
      respostas: [{ opcao: 'concordo' }],
      freguesia: AZUREM,
    }).expect(200);
    expect(r.body).toMatchObject({ registada: false, motivo: 'fechada' });
    expect(r.body.dizer).toContain('já fechou');

    const pub = await ctx
      .http()
      .get(`/v1/public/consultas-publicas/${codigo}`)
      .expect(200);
    expect(pub.body).toMatchObject({
      pode_participar: false,
      situacao: 'fechada',
      resultados: { total: 3 },
    });
    await ctx
      .http()
      .post(`/v1/public/consultas-publicas/${codigo}/codigo`)
      .send({ telefone: novoTelefone() })
      .expect(409);
  });

  it('prazo: aberta mas já passou o último dia conta como terminada', async () => {
    const c = await ctx
      .http()
      .post('/v1/painel/consultas')
      .set(chefe)
      .send({ ...CONSULTA, titulo: 'Horário do mercado E2E', freguesias: null })
      .expect(201);
    await ctx
      .http()
      .post(`/v1/painel/consultas/${c.body.id}/abrir`)
      .set(chefe)
      .expect(200);
    await ctx.db.query(
      `UPDATE consultas_publicas SET abre_em = $2, fecha_em = $3 WHERE id = $1`,
      [c.body.id, somar(hoje, -10), somar(hoje, -1)],
    );
    const r = await ferramenta(ctx, novaChamada('cp'), 'participar_consulta', {
      consulta: c.body.codigo,
      respostas: [{ opcao: 'concordo' }],
      freguesia: AZUREM,
    }).expect(200);
    expect(r.body).toMatchObject({ registada: false, motivo: 'fechada' });
    const pub = await ctx
      .http()
      .get(`/v1/public/consultas-publicas/${c.body.codigo}`)
      .expect(200);
    expect(pub.body.situacao).toBe('terminou');
    // Não se reabre com o prazo passado.
    await ctx
      .http()
      .post(`/v1/painel/consultas/${c.body.id}/fechar`)
      .set(chefe)
      .expect(200);
    const x = await ctx
      .http()
      .post(`/v1/painel/consultas/${c.body.id}/abrir`)
      .set(chefe)
      .expect(422);
    expect(x.body.erro.codigo).toBe('prazo_passado');
  });
});
