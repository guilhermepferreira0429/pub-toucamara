/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import { WEB_URL } from './ambiente';
import {
  arrancarApp,
  Chamada,
  Contexto,
  criarUtilizador,
  entrarPainel,
  esperarAte,
  esperarSmsEnviado,
  ferramenta,
  linha,
  novaChamada,
  PNG_1PX,
  seguirLink,
  smsPara,
} from './app';

/**
 * Um requerimento pronto, num município só deste ficheiro, cujo tipo exige
 * um documento com id UUID v4 (os do seed, …0d7, o z.uuid() recusa).
 * Município próprio para não mexer nos tipos de processo do 'teste'.
 */
async function requerimentoComDocumento(ctx: Contexto) {
  const municipio = randomUUID();
  const entidade = randomUUID();
  const servico = randomUUID();
  const tipo = randomUUID();
  const documentoId = randomUUID();
  await ctx.db.query(
    `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Docs E2E')`,
    [municipio, `docs-${municipio.slice(0, 8)}`],
  );
  await ctx.db.query(
    `INSERT INTO entidades (id, municipio_id, nome, tipo) VALUES ($1, $2, 'Câmara', 'camara')`,
    [entidade, municipio],
  );
  await ctx.db.query(
    `INSERT INTO servicos (id, municipio_id, entidade_id, nome) VALUES ($1, $2, $3, 'Obras')`,
    [servico, municipio, entidade],
  );
  await ctx.db.query(
    `INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, servico_id, formulario)
     VALUES ($1, $2, 'CP', 'Comunicação prévia', 20, $3,
       '[{"chave":"descricao","rotulo":"Descrição","tipo":"texto","obrigatorio":true}]')`,
    [tipo, municipio, servico],
  );
  await ctx.db.query(
    `INSERT INTO tipo_processo_documentos (id, tipo_processo_id, nome, ordem)
     VALUES ($1, $2, 'Certidão do registo predial', 1)`,
    [documentoId, tipo],
  );
  const req = await linha<{ id: string; token_publico: string }>(
    ctx.db,
    `INSERT INTO requerimentos (municipio_id, tipo_processo_id, dados, estado)
     VALUES ($1, $2, '{"descricao":"Abrir uma janela"}', 'pronto')
     RETURNING id, token_publico`,
    [municipio, tipo],
  );
  return { token: req!.token_publico, requerimentoId: req!.id, documentoId };
}

/** `.expect(estado(200))`: como `.expect(200)`, mas com o corpo na mensagem de erro. */
function estado(esperado: number) {
  return (r: { status: number; body: unknown }) => {
    if (r.status !== esperado) {
      throw new Error(
        `Esperava ${esperado}, veio ${r.status}: ${JSON.stringify(r.body)}`,
      );
    }
  };
}

/** NIF português válido e aleatório (um por teste, para não colidir). */
function novoNif(): string {
  const base = `2${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const soma = [...base].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const controlo = 11 - (soma % 11);
  return `${base}${controlo >= 10 ? 0 : controlo}`;
}

/**
 * Requerimento → assinatura → processo → back-office do técnico. Um fluxo
 * encadeado: cada passo usa o estado deixado pelo anterior.
 */
describe('Requerimentos e processos (e2e)', () => {
  let ctx: Contexto;
  let painel: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    painel = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  describe('fluxo completo de uma comunicação prévia', () => {
    const chamada: Chamada = novaChamada('req');
    const nif = novoNif();
    let requerimentoId: string;
    let link: string;
    let token: string;
    let numero: string;
    let processoId: string;

    it('iniciar_requerimento (CP) devolve os campos e a primeira pergunta', async () => {
      const r = await ferramenta(ctx, chamada, 'iniciar_requerimento', {
        tipo: 'CP',
      }).expect(estado(200));
      expect(r.body).toMatchObject({
        requerimento_id: expect.any(String),
        idioma: 'pt-PT',
        tipo: { codigo: 'CP' },
        frase_do_agente: 'Vou preencher a comunicação prévia consigo.',
        proxima_pergunta: 'Qual é a morada da obra?',
        documentos_exigidos: [
          { nome: 'Certidão do registo predial', obrigatorio: true },
          { nome: 'Termo de responsabilidade', obrigatorio: true },
        ],
      });
      expect(r.body.campos.map((c: { chave: string }) => c.chave)).toEqual([
        'morada_obra',
        'descricao',
        'nif',
      ]);
      expect(r.body.nota_idioma).toBeUndefined();
      requerimentoId = r.body.requerimento_id;

      const bd = await linha(
        ctx.db,
        'SELECT estado::text, campos_em_falta FROM requerimentos WHERE id = $1',
        [requerimentoId],
      );
      expect(bd).toEqual({
        estado: 'a_preencher',
        campos_em_falta: ['morada_obra', 'descricao', 'nif'],
      });

      // Repetir na mesma conversa reaproveita o requerimento.
      const outra = await ferramenta(ctx, chamada, 'iniciar_requerimento', {
        tipo: 'CP',
      }).expect(estado(200));
      expect(outra.body.requerimento_id).toBe(requerimentoId);
    });

    it('concluir antes de preencher → 422 campos_em_falta com a próxima pergunta', async () => {
      const r = await ferramenta(
        ctx,
        chamada,
        'concluir_requerimento',
        {},
      ).expect(estado(422));
      expect(r.body.erro).toMatchObject({
        codigo: 'campos_em_falta',
        detalhes: {
          campos_em_falta: ['morada_obra', 'descricao', 'nif'],
          proxima_pergunta: 'Qual é a morada da obra?',
        },
      });
    });

    it('preencher_campo valida o NIF e guarda-o cifrado no munícipe, não no requerimento', async () => {
      const mau = await ferramenta(ctx, chamada, 'preencher_campo', {
        requerimento_id: requerimentoId,
        campos: {
          morada_obra: 'Rua Direita, 10',
          descricao: 'Abrir uma porta na fachada',
          nif: '123456780',
        },
      }).expect(estado(200));
      expect(mau.body).toMatchObject({
        requerimento_id: requerimentoId,
        estado: 'a_preencher',
        gravados: ['morada_obra', 'descricao'],
        erros: [{ chave: 'nif', mensagem: expect.any(String) }],
        campos_em_falta: ['nif'],
        proxima_pergunta: 'Qual é o seu NIF?',
      });

      const bom = await ferramenta(ctx, chamada, 'preencher_campo', {
        campos: { nif },
      }).expect(estado(200));
      expect(bom.body).toMatchObject({
        gravados: ['nif'],
        campos_em_falta: [],
        proxima_pergunta: null,
        instrucao: expect.any(String),
      });
      expect(bom.body.erros).toBeUndefined();

      const req = await linha<{ dados: Record<string, unknown>; tem: boolean }>(
        ctx.db,
        `SELECT r.dados, mu.nif_hash IS NOT NULL AS tem
         FROM requerimentos r JOIN municipes mu ON mu.id = r.municipe_id
         WHERE r.id = $1`,
        [requerimentoId],
      );
      expect(req?.dados).toEqual({
        morada_obra: 'Rua Direita, 10',
        descricao: 'Abrir uma porta na fachada',
        nif_registado: true,
      });
      expect(JSON.stringify(req?.dados)).not.toContain(nif);
      expect(req?.tem).toBe(true);
    });

    it('o requerimento não se mexe a partir de outra conversa → 403', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'preencher_campo', {
        requerimento_id: requerimentoId,
        campos: { descricao: 'Outra coisa' },
      }).expect(estado(403));
      expect(r.body.erro.codigo).toBe('requerimento_de_outra_conversa');
    });

    it('concluir_requerimento: estado pronto e SMS com o link curto', async () => {
      const r = await ferramenta(
        ctx,
        chamada,
        'concluir_requerimento',
        {},
      ).expect(estado(200));
      expect(r.body).toMatchObject({
        requerimento_id: requerimentoId,
        estado: 'pronto',
        sms_enviado: true,
        documentos_em_falta: [
          'Certidão do registo predial',
          'Termo de responsabilidade',
        ],
        o_que_dizer: expect.stringContaining('SMS'),
      });
      expect(r.body.link).toMatch(new RegExp(`^${WEB_URL}/r/[A-Z0-9]{6}$`));
      link = r.body.link;

      const sms = await esperarSmsEnviado(
        ctx,
        chamada.telefone,
        'requerimento',
      );
      expect(sms.corpo).toContain(link);
      expect(sms.corpo).toContain(
        'Falta entregar: Certidão do registo predial',
      );
      expect(sms.corpo).not.toContain('EN:');
      expect(sms.relacionado).toMatchObject({
        requerimento_id: requerimentoId,
      });

      // Concluir outra vez não repete o SMS (chave de idempotência).
      const outra = await ferramenta(
        ctx,
        chamada,
        'concluir_requerimento',
        {},
      ).expect(estado(200));
      expect(outra.body.link).toBe(link);
      expect(await smsPara(ctx, chamada.telefone, 'requerimento')).toHaveLength(
        1,
      );
    });

    it('o link curto redireciona para a página do requerimento pelo token', async () => {
      const r = await seguirLink(ctx, link);
      const bd = await linha<{ token_publico: string }>(
        ctx.db,
        'SELECT token_publico FROM requerimentos WHERE id = $1',
        [requerimentoId],
      );
      expect(r.token).toBe(bd?.token_publico);
      token = r.token;
      const aberto = await linha<{ aberturas: number }>(
        ctx.db,
        "SELECT aberturas FROM links_curtos WHERE destino_tipo = 'requerimento' AND destino_id = $1",
        [requerimentoId],
      );
      expect(aberto?.aberturas).toBeGreaterThanOrEqual(1);
    });

    it('GET /v1/public/requerimentos/:token mostra o requerimento sem NIF nem ids internos', async () => {
      const r = await ctx
        .http()
        .get(`/v1/public/requerimentos/${token}`)
        .expect(estado(200));
      expect(r.body).toMatchObject({
        municipio: 'Teste',
        estado: 'pronto',
        tipo: { codigo: 'CP' },
        campos_em_falta: [],
        pode_assinar: true,
        assinatura_disponivel: 'simulada',
        processo: null,
      });
      expect(r.body.campos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            chave: 'nif',
            valor: 'Registado (não se mostra)',
          }),
          expect.objectContaining({
            chave: 'morada_obra',
            valor: 'Rua Direita, 10',
          }),
        ]),
      );
      expect(r.body.id).toBeUndefined();
      expect(r.body.conversa_id).toBeUndefined();
      expect(JSON.stringify(r.body)).not.toContain(nif);

      const inexistente = await ctx
        .http()
        .get(`/v1/public/requerimentos/${'x'.repeat(32)}`)
        .expect(estado(404));
      expect(inexistente.body.erro.codigo).toBe('link_invalido');
    });

    it('assinar entrega o requerimento e cria o processo (à espera de documentos)', async () => {
      const r = await ctx
        .http()
        .post(`/v1/public/requerimentos/${token}/assinar`)
        .expect(estado(200));
      expect(r.body).toMatchObject({
        estado: 'entregue',
        assinatura: 'simulada',
        assinatura_simulada: true,
        ja_estava_entregue: false,
        processo: {
          numero: expect.stringMatching(/^CP \d+\/\d{4}$/),
          fase: 'documentos',
          prazo_fim: null,
          link: expect.stringMatching(new RegExp(`^${WEB_URL}/r/`)),
        },
      });
      numero = r.body.processo.numero;

      const req = await linha<{
        estado: string;
        assinatura: string;
        processo_id: string;
      }>(
        ctx.db,
        'SELECT estado::text, assinatura, processo_id FROM requerimentos WHERE id = $1',
        [requerimentoId],
      );
      expect(req).toMatchObject({
        estado: 'entregue',
        assinatura: 'simulada',
        processo_id: expect.any(String),
      });
      processoId = req!.processo_id;
      const p = await linha(
        ctx.db,
        'SELECT numero, fase::text, morada, assunto FROM processos WHERE id = $1',
        [processoId],
      );
      expect(p).toEqual({
        numero,
        fase: 'documentos',
        morada: 'Rua Direita, 10',
        assunto: 'Abrir uma porta na fachada',
      });
      const audit = await linha(
        ctx.db,
        "SELECT 1 AS ok FROM audit_log WHERE acao = 'assinar' AND objeto_id = $1",
        [requerimentoId],
      );
      expect(audit).toBeDefined();
    });

    it('assinar outra vez é idempotente: 200, ja_estava_entregue e o mesmo processo', async () => {
      // O serviço documenta "Repetir devolve o mesmo resultado": não há erro.
      const r = await ctx
        .http()
        .post(`/v1/public/requerimentos/${token}/assinar`)
        .expect(estado(200));
      expect(r.body).toMatchObject({
        estado: 'entregue',
        ja_estava_entregue: true,
        processo: { numero, fase: 'documentos' },
      });
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM processos WHERE conversa_origem_id = (SELECT conversa_id FROM requerimentos WHERE id = $1)',
        [requerimentoId],
      );
      expect(n?.n).toBe(1);
    });

    it('painel: o processo aparece na lista e no detalhe', async () => {
      const lista = await ctx
        .http()
        .get('/v1/painel/processos')
        .query({ texto: numero, limite: 200 })
        .set(painel)
        .expect(estado(200));
      const item = lista.body.itens.find(
        (i: { id: string }) => i.id === processoId,
      );
      expect(item).toMatchObject({
        numero,
        tipo: { codigo: 'CP' },
        fase: 'documentos',
        aguarda_municipe: true,
        prazo_fim: null,
        atrasado: false,
      });

      const d = await ctx
        .http()
        .get(`/v1/painel/processos/${processoId}`)
        .set(painel)
        .expect(estado(200));
      expect(d.body).toMatchObject({
        id: processoId,
        numero,
        fase: 'documentos',
        tipo: { id: expect.any(String), codigo: 'CP' },
        municipe: { tem_nif: true },
        requerimento: {
          id: requerimentoId,
          estado: 'entregue',
          assinatura_simulada: true,
          pdf_url: null,
        },
        armazenamento_disponivel: false,
        pedidos: [],
      });
      expect(d.body.documentos_resumo.faltam).toEqual([
        'Certidão do registo predial',
        'Termo de responsabilidade',
      ]);
      expect(d.body.eventos).toEqual(
        expect.arrayContaining([expect.objectContaining({ tipo: 'criado' })]),
      );
      expect(JSON.stringify(d.body)).not.toContain(nif);
    });

    it('ferramenta estado_processo devolve o processo do munícipe que liga', async () => {
      const r = await ferramenta(ctx, chamada, 'estado_processo', {
        numero,
      }).expect(estado(200));
      expect(r.body).toMatchObject({
        encontrado: true,
        processos: [
          {
            numero,
            tipo: 'Comunicação prévia · obras de alteração',
            dias_uteis_restantes: null,
            resumo: expect.any(String),
          },
        ],
      });

      // Outro número: não é desta pessoa.
      const outro = await ferramenta(ctx, chamada, 'estado_processo', {
        numero: 'CP 99999/2001',
      }).expect(estado(200));
      expect(outro.body).toMatchObject({
        encontrado: false,
        processos_da_pessoa: [numero],
      });

      // Quem liga de outro número (sem NIF nem processos) tem de se identificar.
      const estranho = await ferramenta(
        ctx,
        novaChamada(),
        'estado_processo',
        {},
      ).expect(estado(200));
      expect(estranho.body).toMatchObject({ precisa_identificacao: true });
    });

    it('pedir documento com prazo: pedido na BD, evento visível e SMS com o prazo', async () => {
      const r = await ctx
        .http()
        .post(`/v1/painel/processos/${processoId}/pedir-documento`)
        .set(painel)
        // Pelo nome: os ids do seed (…0d7) não são UUID RFC e o z.uuid() recusa-os.
        .send({
          nome: 'Certidão do registo predial',
          nota: 'Falta a certidão',
          prazo_dias_uteis: 5,
        })
        .expect(estado(200));
      expect(r.body).toMatchObject({
        evento_id: expect.any(String),
        pedido_id: expect.any(String),
        prazo: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        aviso: 'sms',
        sms_enviado: true,
      });
      const pedido = await linha(
        ctx.db,
        `SELECT descricao, tipo_documento_id, nota, to_char(prazo, 'YYYY-MM-DD') AS prazo
         FROM processo_pedidos WHERE id = $1`,
        [r.body.pedido_id],
      );
      expect(pedido).toEqual({
        descricao: 'Certidão do registo predial',
        tipo_documento_id: null,
        nota: 'Falta a certidão',
        prazo: r.body.prazo,
      });
      const sms = await esperarAte(async () =>
        (await smsPara(ctx, chamada.telefone, 'processo')).find(
          (s) =>
            s.relacionado.pedido_id === r.body.pedido_id &&
            s.estado === 'enviada',
        ),
      );
      expect(sms.corpo).toContain('Certidão do registo predial');
      expect(sms.relacionado.processo_id).toBe(processoId);

      // Documento que não é deste tipo de processo.
      const mau = await ctx
        .http()
        .post(`/v1/painel/processos/${processoId}/pedir-documento`)
        .set(painel)
        .send({ tipo_documento_id: randomUUID() })
        .expect(estado(400));
      expect(mau.body.erro.codigo).toBe('documento_desconhecido');
    });

    it('mudar a fase para apreciação começa o prazo e avisa o munícipe por SMS', async () => {
      const r = await ctx
        .http()
        .patch(`/v1/painel/processos/${processoId}`)
        .set(painel)
        .send({ fase: 'apreciacao' })
        .expect(estado(200));
      expect(r.body).toMatchObject({
        id: processoId,
        fase: 'apreciacao',
        prazo: {
          inicio: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          fim: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        },
      });
      expect(r.body.eventos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ tipo: 'fase' }),
          expect.objectContaining({ tipo: 'prazo' }),
        ]),
      );

      const aviso = await esperarAte(() =>
        linha<{ corpo: string; estado: string }>(
          ctx.db,
          `SELECT corpo, estado::text FROM mensagens_saida
           WHERE chave_idempotencia = $1 AND estado = 'enviada'`,
          [`processo_fase:${processoId}:apreciacao`],
        ),
      );
      expect(aviso.corpo).toContain('em análise');
      const evento = await linha(
        ctx.db,
        "SELECT dados->>'canal' AS canal FROM processo_eventos WHERE processo_id = $1 AND tipo = 'avisado' AND dados->>'fase' = 'apreciacao'",
        [processoId],
      );
      expect(evento).toEqual({ canal: 'sms' });
    });

    it('?aguarda_municipe=true inclui-o (há um pedido por responder)', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/processos')
        .query({ aguarda_municipe: 'true', texto: numero, limite: 200 })
        .set(painel)
        .expect(estado(200));
      const item = r.body.itens.find(
        (i: { id: string }) => i.id === processoId,
      );
      expect(item).toMatchObject({
        fase: 'apreciacao',
        aguarda_municipe: true,
        prazo_municipe: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
      for (const i of r.body.itens) expect(i.aguarda_municipe).toBe(true);
    });

    it('lista: contagem de documentos e filtros por tipo, serviço e freguesia; ficha com lat/lng e gestão documental', async () => {
      const d = await ctx
        .http()
        .get(`/v1/painel/processos/${processoId}`)
        .set(painel)
        .expect(estado(200));
      expect(d.body).toMatchObject({
        lat: null,
        lng: null,
        gestao_documental: {
          estado: expect.stringMatching(
            /^(nao_aplicavel|por_sincronizar|sincronizado|erro)$/,
          ),
          tentativas: expect.any(Number),
          gd_id: null,
          ultimo_erro: null,
        },
      });

      const listar = (query: Record<string, string>) =>
        ctx
          .http()
          .get('/v1/painel/processos')
          .query({ texto: numero, limite: 200, ...query })
          .set(painel)
          .expect(estado(200))
          .then((r) => r.body.itens as { id: string }[]);
      const [item] = (await listar({})).filter((i) => i.id === processoId);
      expect(item).toMatchObject({ documentos: { entregues: 0, exigidos: 2 } });

      const tipoId = d.body.tipo.id as string;
      expect(
        (await listar({ tipo_processo_id: tipoId })).map((i) => i.id),
      ).toContain(processoId);
      expect(await listar({ tipo_processo_id: randomUUID() })).toEqual([]);
      expect(await listar({ servico_id: randomUUID() })).toEqual([]);
      expect(await listar({ freguesia: 'Freguesia que não existe' })).toEqual(
        [],
      );
      await ctx
        .http()
        .get('/v1/painel/processos')
        .query({ servico_id: 'nao-e-uuid' })
        .set(painel)
        .expect(estado(400));
    });

    it('GET /v1/painel/processos/resumo dá os totais por separador', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/processos/resumo')
        .query({ texto: numero })
        .set(painel)
        .expect(estado(200));
      expect(r.body).toEqual({
        todos: 1,
        meus: expect.any(Number),
        atrasados: 0,
        aguarda_municipe: 1,
        a_terminar: expect.any(Number),
        a_terminar_ate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
      const geral = await ctx
        .http()
        .get('/v1/painel/processos/resumo')
        .set(painel)
        .expect(estado(200));
      expect(geral.body.todos).toBeGreaterThanOrEqual(1);
      const a = await ctx
        .http()
        .get('/v1/painel/processos')
        .query({ a_terminar: 'true', limite: 200 })
        .set(painel)
        .expect(estado(200));
      expect(Array.isArray(a.body.itens)).toBe(true);
    });

    it('foto de um documento que não é deste requerimento → 400 documento_desconhecido', async () => {
      // O 503 sem IA está no teste seguinte: os ids dos documentos do seed
      // não passam no z.uuid() da rota.
      const outro = await ctx
        .http()
        .post(`/v1/public/requerimentos/${token}/documentos/verificar`)
        .send({
          tipo_documento_id: randomUUID(),
          mime: 'image/png',
          imagem_base64: PNG_1PX,
        })
        .expect(estado(400));
      expect(outro.body.erro.codigo).toBe('documento_desconhecido');

      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM documentos WHERE requerimento_id = $1',
        [requerimentoId],
      );
      expect(n?.n).toBe(0);
    });

    it('apoio ao técnico sem IA: resumo 503, regulamento com trechos sem destaques, rascunho 503', async () => {
      const resumo = await ctx
        .http()
        .get(`/v1/painel/processos/${processoId}/resumo`)
        .set(painel)
        .expect(estado(503));
      expect(resumo.body.erro.codigo).toBe('ia_indisponivel');

      const reg = await ctx
        .http()
        .get(`/v1/painel/processos/${processoId}/regulamento`)
        .set(painel)
        .expect(estado(200));
      expect(reg.body).toMatchObject({
        processo_id: processoId,
        destacado: false,
        ia_disponivel: false,
        em_cache: false,
        gerado_em: null,
        perguntas: expect.arrayContaining([expect.any(String)]),
      });
      expect(reg.body.trechos.length).toBeGreaterThan(0);
      for (const t of reg.body.trechos) {
        expect(t).toMatchObject({
          texto: expect.any(String),
          porque_se_aplica: null,
          destaques: [],
        });
      }

      const rascunho = await ctx
        .http()
        .post(`/v1/painel/processos/${processoId}/rascunhos`)
        .set(painel)
        .send({
          tipo: 'pedido_elementos',
          documentos_pedidos: [{ texto: 'Certidão do registo predial' }],
        })
        .expect(estado(503));
      expect(rascunho.body.erro.codigo).toBe('ia_indisponivel');
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM documentos_gerados WHERE processo_id = $1',
        [processoId],
      );
      expect(n?.n).toBe(0);
    });
  });

  it('foto do documento sem IA → 503 ia_indisponivel, sem gravar nada', async () => {
    const { token, documentoId, requerimentoId } =
      await requerimentoComDocumento(ctx);
    const r = await ctx
      .http()
      .post(`/v1/public/requerimentos/${token}/documentos/verificar`)
      .send({
        tipo_documento_id: documentoId,
        mime: 'image/png',
        imagem_base64: `data:image/png;base64,${PNG_1PX}`,
      })
      .expect(estado(503));
    expect(r.body.erro.codigo).toBe('ia_indisponivel');

    // Um ficheiro que não é o que diz ser não chega à IA.
    const falso = await ctx
      .http()
      .post(`/v1/public/requerimentos/${token}/documentos/verificar`)
      .send({
        tipo_documento_id: documentoId,
        mime: 'image/jpeg',
        imagem_base64: PNG_1PX,
      })
      .expect(estado(400));
    expect(falso.body.erro.codigo).toBe('ficheiro_invalido');

    const n = await linha<{ n: number }>(
      ctx.db,
      'SELECT count(*)::int AS n FROM documentos WHERE requerimento_id = $1',
      [requerimentoId],
    );
    expect(n?.n).toBe(0);
  });

  it('noutra língua: idioma en e o SMS leva uma linha em inglês', async () => {
    const chamada = novaChamada('req-en');
    const ini = await ferramenta(ctx, chamada, 'iniciar_requerimento', {
      tipo: 'CP',
      idioma: 'en',
    }).expect(estado(200));
    expect(ini.body).toMatchObject({
      idioma: 'en',
      nota_idioma: expect.any(String),
    });
    await ferramenta(ctx, chamada, 'preencher_campo', {
      campos: {
        morada_obra: 'Rua Nova, 7',
        descricao: 'Open a new window in the kitchen',
        nif: novoNif(),
      },
    })
      .expect(estado(200))
      .expect((r) => expect(r.body.campos_em_falta).toEqual([]));
    const conc = await ferramenta(
      ctx,
      chamada,
      'concluir_requerimento',
      {},
    ).expect(estado(200));
    expect(conc.body).toMatchObject({ estado: 'pronto', sms_enviado: true });

    const sms = await esperarSmsEnviado(ctx, chamada.telefone, 'requerimento');
    expect(sms.corpo).toContain(conc.body.link);
    expect(sms.corpo).toContain(
      '\nEN: Your request is ready. Review and sign it at the link above.',
    );

    const { token } = await seguirLink(ctx, conc.body.link);
    const pub = await ctx
      .http()
      .get(`/v1/public/requerimentos/${token}`)
      .expect(estado(200));
    // Sem IA não há tradução: os valores ficam como foram ditos.
    expect(pub.body).toMatchObject({
      idioma_conversa: 'en',
      campos_originais: null,
    });
    const req = await linha(
      ctx.db,
      'SELECT idioma_conversa FROM requerimentos WHERE id = $1',
      [ini.body.requerimento_id],
    );
    expect(req).toEqual({ idioma_conversa: 'en' });
  });

  it('perfil atendimento não vê processos → 403 sem_permissao', async () => {
    const id = await criarUtilizador(ctx, 'atendimento');
    const h = await entrarPainel(ctx, id);
    const r = await ctx
      .http()
      .get('/v1/painel/processos')
      .set(h)
      .expect(estado(403));
    expect(r.body.erro.codigo).toBe('sem_permissao');
  });
});
