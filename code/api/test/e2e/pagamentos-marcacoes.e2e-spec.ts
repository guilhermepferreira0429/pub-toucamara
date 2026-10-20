/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { createHmac, randomUUID } from 'crypto';
import { SEGREDO_AGENTE, SEGREDO_PAGAMENTOS, WEB_URL } from './ambiente';
import {
  arrancarApp,
  Chamada,
  Contexto,
  esperarAte,
  esperarSmsEnviado,
  ferramenta,
  linha,
  novaChamada,
  seguirLink,
  smsPara,
} from './app';

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

/** Um requerimento CP novo (numa conversa nova) para ter o que pagar. */
async function requerimentoParaPagar(
  ctx: Contexto,
): Promise<{ chamada: Chamada; requerimentoId: string }> {
  const chamada = novaChamada('pag');
  const r = await ferramenta(ctx, chamada, 'iniciar_requerimento', {
    tipo: 'CP',
  }).expect(estado(200));
  return { chamada, requerimentoId: r.body.requerimento_id };
}

/** O cabeçalho X-Assinatura, calculado como o fornecedor (HMAC-SHA256 do corpo). */
function assinatura(corpo: string, segredo = SEGREDO_PAGAMENTOS): string {
  return `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;
}

/**
 * Município só deste ficheiro (agenda aberta todos os dias 08:00–20:00 e
 * empresa de resíduos): as vagas não dependem do dia da semana nem colidem
 * com marcações de outros ficheiros na agenda do seed.
 */
async function municipioDeMarcacoes(ctx: Contexto, comResiduos = true) {
  const id = randomUUID();
  const slug = `marc-${id.slice(0, 8)}`;
  const camara = randomUUID();
  const servico = randomUUID();
  const agenda = randomUUID();
  await ctx.db.query(
    `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Marcações E2E')`,
    [id, slug],
  );
  await ctx.db.query(
    `INSERT INTO entidades (id, municipio_id, nome, tipo) VALUES ($1, $2, 'Câmara', 'camara')`,
    [camara, id],
  );
  if (comResiduos) {
    await ctx.db.query(
      `INSERT INTO entidades (municipio_id, nome, tipo, descricao)
       VALUES ($1, 'Resíduos E2E', 'empresa_municipal', 'Recolha de lixo e monos')`,
      [id],
    );
  }
  await ctx.db.query(
    `INSERT INTO servicos (id, municipio_id, entidade_id, nome) VALUES ($1, $2, $3, 'Atendimento geral')`,
    [servico, id, camara],
  );
  const todos = ['08:00-20:00'];
  await ctx.db.query(
    `INSERT INTO agendas (id, municipio_id, servico_id, nome, local, horario)
     VALUES ($1, $2, $3, 'Balcão E2E', 'Praça E2E', $4)`,
    [
      agenda,
      id,
      servico,
      JSON.stringify({
        seg: todos,
        ter: todos,
        qua: todos,
        qui: todos,
        sex: todos,
        sab: todos,
        dom: todos,
      }),
    ],
  );
  return { slug, agenda };
}

describe('Pagamentos e marcações (e2e)', () => {
  let ctx: Contexto;

  beforeAll(async () => {
    ctx = await arrancarApp();
  });
  afterAll(() => ctx.fechar());

  /* ---------------------------------------------------------------- taxas */

  describe('simular_taxa', () => {
    it('CP com m²: total = 4500 + 120 × m², com a fonte da tabela', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'simular_taxa', {
        tipo_processo: 'CP',
        quantidades: { m2: 12 },
      }).expect(estado(200));
      expect(r.body).toMatchObject({
        completa: true,
        total_cent: 4500 + 120 * 12,
        total_por_extenso: expect.any(String),
        em_falta: [],
        desconhecidas: [],
        fonte: { titulo: 'RJUE', ano: 2026 },
      });
      expect(r.body.linhas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ codigo: 'CP1', valor_cent: 4500 }),
          expect.objectContaining({
            codigo: 'CP2',
            unidade: 'm2',
            quantidade: 12,
            valor_cent: 1440,
          }),
        ]),
      );
    });

    it('sem m²: incompleta, com a pergunta a fazer', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'simular_taxa', {
        tipo_processo: 'CP',
      }).expect(estado(200));
      expect(r.body).toMatchObject({
        completa: false,
        total_cent: 4500,
        em_falta: [
          {
            codigo: 'CP2',
            unidade: 'm2',
            pergunta: 'Quantos metros quadrados?',
          },
        ],
      });
    });

    it('tipo de processo desconhecido → 404', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'simular_taxa', {
        tipo_processo: 'ZZZ',
      }).expect(estado(404));
      expect(r.body.erro.codigo).toBe('tipo_processo_desconhecido');
    });
  });

  /* ----------------------------------------------------- Multibanco (MB) */

  describe('criar_pagamento por Multibanco e página pública', () => {
    let chamada: Chamada;
    let requerimentoId: string;
    let pagamentoId: string;
    let link: string;
    let codigo: string;

    beforeAll(async () => {
      ({ chamada, requerimentoId } = await requerimentoParaPagar(ctx));
    });

    it('sem quantidades → 422 faltam_quantidades e nada é criado', async () => {
      const r = await ferramenta(ctx, chamada, 'criar_pagamento', {
        requerimento_id: requerimentoId,
      }).expect(estado(422));
      expect(r.body.erro).toMatchObject({
        codigo: 'faltam_quantidades',
        detalhes: {
          em_falta: [expect.objectContaining({ codigo: 'CP2', unidade: 'm2' })],
        },
      });
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM pagamentos WHERE requerimento_id = $1',
        [requerimentoId],
      );
      expect(n?.n).toBe(0);
    });

    it('com quantidades → referência MB de teste, link e SMS', async () => {
      const r = await ferramenta(ctx, chamada, 'criar_pagamento', {
        requerimento_id: requerimentoId,
        quantidades: { m2: 12 },
      }).expect(estado(200));
      expect(r.body).toMatchObject({
        pagamento_id: expect.any(String),
        ja_existia: false,
        modo_teste: true,
        metodo: 'multibanco',
        mbway: null,
        valor_cent: 5940,
        entidade: '99999',
        referencia: expect.stringMatching(/^\d{3} \d{3} \d{3}$/),
        pagar_ate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        estado: 'pendente',
        sms_enviado: true,
        link: expect.stringMatching(new RegExp(`^${WEB_URL}/r/[A-Z0-9]{6}$`)),
        dizer: expect.stringContaining('teste'),
      });
      pagamentoId = r.body.pagamento_id;
      link = r.body.link;

      const bd = await linha(
        ctx.db,
        `SELECT estado::text, metodo::text, valor_cent, mb_entidade, mb_referencia, modo_teste
         FROM pagamentos WHERE id = $1`,
        [pagamentoId],
      );
      expect(bd).toEqual({
        estado: 'pendente',
        metodo: 'multibanco',
        valor_cent: 5940,
        mb_entidade: '99999',
        mb_referencia: r.body.referencia.replace(/\s/g, ''),
        modo_teste: true,
      });

      const sms = await esperarSmsEnviado(ctx, chamada.telefone, 'pagamento');
      expect(sms.corpo).toContain('entidade 99999');
      expect(sms.corpo).toContain(`ref. ${r.body.referencia}`);
      expect(sms.corpo).toContain(link);

      // Repetir devolve o mesmo pagamento (o agente pode chamar outra vez).
      const outra = await ferramenta(ctx, chamada, 'criar_pagamento', {
        requerimento_id: requerimentoId,
        quantidades: { m2: 12 },
      }).expect(estado(200));
      expect(outra.body).toMatchObject({
        pagamento_id: pagamentoId,
        ja_existia: true,
      });
    });

    it('GET /v1/public/pagamentos/:codigo mostra a referência, sem dados pessoais', async () => {
      const seguido = await seguirLink(ctx, link);
      codigo = seguido.token;
      expect(seguido.destino).toBe('pagamento');
      const r = await ctx
        .http()
        .get(`/v1/public/pagamentos/${codigo}`)
        .expect(estado(200));
      expect(r.body).toMatchObject({
        municipio: 'Teste',
        valor_cent: 5940,
        metodo: 'multibanco',
        mb_entidade: '99999',
        mb_referencia: expect.stringMatching(/^\d{3} \d{3} \d{3}$/),
        estado: 'pendente',
        pago_em: null,
        modo_teste: true,
        mbway: null,
      });
      expect(JSON.stringify(r.body)).not.toContain(chamada.telefone);

      const mau = await ctx
        .http()
        .get('/v1/public/pagamentos/ZZZZZZ')
        .expect(estado(404));
      expect(mau.body.erro.codigo).toBe('link_invalido');
    });

    it('simular-pagamento → pago na BD e SMS de recibo; outra vez → 409 pagamento_fechado', async () => {
      const r = await ctx
        .http()
        .post(`/v1/public/pagamentos/${codigo}/simular-pagamento`)
        .expect(estado(200));
      expect(r.body).toMatchObject({
        estado: 'pago',
        metodo: 'multibanco',
        pago_em: expect.any(String),
      });
      const bd = await linha(
        ctx.db,
        'SELECT estado::text, metodo::text, pago_em IS NOT NULL AS tem_data FROM pagamentos WHERE id = $1',
        [pagamentoId],
      );
      expect(bd).toEqual({
        estado: 'pago',
        metodo: 'multibanco',
        tem_data: true,
      });
      const recibo = await esperarAte(() =>
        linha<{ corpo: string; destino: string }>(
          ctx.db,
          `SELECT corpo, destino FROM mensagens_saida
           WHERE chave_idempotencia = $1 AND estado = 'enviada'`,
          [`pagamento_pago:${pagamentoId}`],
        ),
      );
      expect(recibo.destino).toBe(chamada.telefone);
      expect(recibo.corpo).toContain('recebemos o pagamento');

      const outra = await ctx
        .http()
        .post(`/v1/public/pagamentos/${codigo}/simular-pagamento`)
        .expect(estado(409));
      expect(outra.body.erro.codigo).toBe('pagamento_fechado');
    });
  });

  /* --------------------------------------------------------------- MB WAY */

  it('MB WAY: pedido ao telemóvel de quem liga, aceitar → pago; aceitar outra vez → 409', async () => {
    const { chamada, requerimentoId } = await requerimentoParaPagar(ctx);
    const r = await ferramenta(ctx, chamada, 'criar_pagamento', {
      requerimento_id: requerimentoId,
      quantidades: { m2: 10 },
      metodo: 'mbway',
    }).expect(estado(200));
    expect(r.body).toMatchObject({
      metodo: 'mbway',
      valor_cent: 4500 + 1200,
      mbway: {
        estado: 'por_aceitar',
        telemovel: expect.any(String),
        validade_minutos: 5,
      },
      link: expect.stringMatching(new RegExp(`^${WEB_URL}/r/`)),
    });
    expect(r.body.mbway.telemovel).not.toBe(chamada.telefone);
    const pagamentoId: string = r.body.pagamento_id;

    const { token: codigo } = await seguirLink(ctx, r.body.link);
    const pub = await ctx
      .http()
      .get(`/v1/public/pagamentos/${codigo}`)
      .expect(estado(200));
    expect(pub.body).toMatchObject({
      metodo: 'mbway',
      estado: 'pendente',
      mbway: {
        estado: 'por_aceitar',
        pedidos_feitos: 1,
        pode_reenviar: false,
      },
    });
    expect(pub.body.mbway.segundos_restantes).toBeGreaterThan(0);

    const aceite = await ctx
      .http()
      .post(`/v1/public/pagamentos/${codigo}/mbway/aceitar`)
      .expect(estado(200));
    expect(aceite.body).toMatchObject({
      estado: 'pago',
      metodo: 'mbway',
      mbway: { estado: 'pago' },
    });
    const bd = await linha(
      ctx.db,
      `SELECT p.estado::text, p.metodo::text,
              (SELECT array_agg(estado::text) FROM pedidos_mbway WHERE pagamento_id = p.id) AS pedidos
       FROM pagamentos p WHERE p.id = $1`,
      [pagamentoId],
    );
    expect(bd).toEqual({ estado: 'pago', metodo: 'mbway', pedidos: ['pago'] });

    const outra = await ctx
      .http()
      .post(`/v1/public/pagamentos/${codigo}/mbway/aceitar`)
      .expect(estado(409));
    expect(outra.body.erro.codigo).toBe('pagamento_fechado');

    const recibo = await esperarAte(() =>
      linha<{ corpo: string }>(
        ctx.db,
        `SELECT corpo FROM mensagens_saida WHERE chave_idempotencia = $1 AND estado = 'enviada'`,
        [`pagamento_pago:${pagamentoId}`],
      ),
    );
    expect(recibo.corpo).toContain('por MB WAY');
  });

  it('pagamento Multibanco sem pedido MB WAY: aceitar → 409 sem_pedido_mbway', async () => {
    const { chamada, requerimentoId } = await requerimentoParaPagar(ctx);
    const r = await ferramenta(ctx, chamada, 'criar_pagamento', {
      requerimento_id: requerimentoId,
      quantidades: { m2: 1 },
    }).expect(estado(200));
    const { token: codigo } = await seguirLink(ctx, r.body.link);
    const aceitar = await ctx
      .http()
      .post(`/v1/public/pagamentos/${codigo}/mbway/aceitar`)
      .expect(estado(409));
    expect(aceitar.body.erro.codigo).toBe('sem_pedido_mbway');
  });

  /* -------------------------------------------------------------- webhook */

  describe('webhook de pagamentos', () => {
    let pagamentoId: string;
    let corpo: string;

    beforeAll(async () => {
      const { chamada, requerimentoId } = await requerimentoParaPagar(ctx);
      const r = await ferramenta(ctx, chamada, 'criar_pagamento', {
        requerimento_id: requerimentoId,
        quantidades: { m2: 3 },
      }).expect(estado(200));
      pagamentoId = r.body.pagamento_id;
      corpo = JSON.stringify({
        mb_referencia: r.body.referencia, // com espaços: o webhook tira-os
        mb_entidade: '99999',
        valor_cent: r.body.valor_cent,
        estado: 'pago',
      });
    });

    const enviar = (texto: string, cabecalho?: string) => {
      const pedido = ctx
        .http()
        .post('/v1/webhooks/pagamentos')
        .set('Content-Type', 'application/json');
      if (cabecalho) pedido.set('X-Assinatura', cabecalho);
      return pedido.send(texto);
    };

    it('assinatura errada ou em falta → 401 assinatura_invalida, sem mexer no pagamento', async () => {
      const errada = await enviar(
        corpo,
        assinatura(corpo, 'outro-segredo'),
      ).expect(estado(401));
      expect(errada.body.erro.codigo).toBe('assinatura_invalida');

      // Assinatura certa de outro corpo: o HMAC é sobre os bytes recebidos.
      const outroCorpo = await enviar(
        corpo.replace('"pago"', '"cancelado"'),
        assinatura(corpo),
      ).expect(estado(401));
      expect(outroCorpo.body.erro.codigo).toBe('assinatura_invalida');

      const sem = await enviar(corpo).expect(estado(401));
      expect(sem.body.erro.codigo).toBe('assinatura_invalida');

      const bd = await linha(
        ctx.db,
        'SELECT estado::text FROM pagamentos WHERE id = $1',
        [pagamentoId],
      );
      expect(bd).toEqual({ estado: 'pendente' });
    });

    it('valor diferente → 409 valor_diferente', async () => {
      const mau = JSON.stringify({ ...JSON.parse(corpo), valor_cent: 1 });
      const r = await enviar(mau, assinatura(mau)).expect(estado(409));
      expect(r.body.erro).toMatchObject({
        codigo: 'valor_diferente',
        detalhes: { recebido_cent: 1 },
      });
    });

    it('referência que não existe → 404 pagamento_desconhecido', async () => {
      const x = JSON.stringify({
        provider_ref: `nao-existe-${randomUUID()}`,
        valor_cent: 100,
        estado: 'pago',
      });
      const r = await enviar(x, assinatura(x)).expect(estado(404));
      expect(r.body.erro.codigo).toBe('pagamento_desconhecido');
    });

    it('HMAC válido → pago (Multibanco); repetir é idempotente', async () => {
      const r = await enviar(corpo, assinatura(corpo)).expect(estado(200));
      expect(r.body).toEqual({
        pagamento_id: pagamentoId,
        estado: 'pago',
        metodo: 'multibanco',
        ja_processado: false,
      });
      const bd = await linha(
        ctx.db,
        'SELECT estado::text, metodo::text, pago_em IS NOT NULL AS tem_data FROM pagamentos WHERE id = $1',
        [pagamentoId],
      );
      expect(bd).toEqual({
        estado: 'pago',
        metodo: 'multibanco',
        tem_data: true,
      });

      const outra = await enviar(corpo, assinatura(corpo)).expect(estado(200));
      expect(outra.body).toMatchObject({
        pagamento_id: pagamentoId,
        estado: 'pago',
        ja_processado: true,
      });
      const recibos = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM mensagens_saida WHERE chave_idempotencia = $1',
        [`pagamento_pago:${pagamentoId}`],
      );
      expect(recibos?.n).toBe(1);
    });
  });

  /* ----------------------------------------------------------- marcações */

  describe('marcações', () => {
    let slug: string;
    let agenda: string;
    const a = novaChamada('marc-a');
    const b = novaChamada('marc-b');
    let vagas: { inicio: string; dito: string }[];
    let marcacaoA: string;
    let marcacaoB: string;
    let tokenA: string;

    /** Ferramenta no município das marcações (não o 'teste'). */
    const tool = (chamada: Chamada, nome: string, corpo: object = {}) =>
      ctx
        .http()
        .post(`/v1/agent/tools/${nome}`)
        .set({
          'X-Agente-Segredo': SEGREDO_AGENTE,
          'X-Municipio': slug,
          'X-Conversa-Id': chamada.conversa,
          'X-Telefone': chamada.telefone,
        })
        .send(corpo);

    beforeAll(async () => {
      ({ slug, agenda } = await municipioDeMarcacoes(ctx));
    });

    it('ver_vagas devolve vagas reais da agenda (pelo serviço e pelo id)', async () => {
      const porServico = await tool(a, 'ver_vagas', {
        servico: 'atendimento',
      }).expect(estado(200));
      expect(porServico.body).toMatchObject({
        agenda: { agenda_id: agenda, nome: 'Balcão E2E', local: 'Praça E2E' },
        sem_vagas: false,
      });

      const r = await tool(a, 'ver_vagas', {
        agenda_id: agenda,
        limite: 6,
      }).expect(estado(200));
      vagas = r.body.vagas;
      expect(vagas.length).toBeGreaterThanOrEqual(3);
      for (const v of vagas) {
        expect(v).toEqual({
          inicio: expect.any(String),
          dito: expect.any(String),
        });
        expect(new Date(v.inicio).getTime()).toBeGreaterThan(Date.now());
      }

      const passado = await tool(a, 'ver_vagas', {
        agenda_id: agenda,
        dia: '2020-01-01',
      }).expect(estado(400));
      expect(passado.body.erro.codigo).toBe('dia_passado');
    });

    it('marcar → marcação na BD e SMS com o link; repetir devolve a mesma', async () => {
      const r = await tool(a, 'marcar', {
        agenda_id: agenda,
        inicio: vagas[0].inicio,
        assunto: 'Dúvidas sobre a obra',
        levar: ['Cartão de Cidadão'],
      }).expect(estado(200));
      expect(r.body).toMatchObject({
        marcacao_id: expect.any(String),
        ja_existia: false,
        agenda: 'Balcão E2E',
        local: 'Praça E2E',
        inicio: new Date(vagas[0].inicio).toISOString(),
        quando: vagas[0].dito,
        levar: ['Cartão de Cidadão'],
        sms_enviado: true,
        link: expect.stringMatching(new RegExp(`^${WEB_URL}/r/`)),
      });
      marcacaoA = r.body.marcacao_id;

      const bd = await linha(
        ctx.db,
        'SELECT estado, assunto, lower(periodo) AS inicio FROM marcacoes WHERE id = $1',
        [marcacaoA],
      );
      expect(bd).toEqual({
        estado: 'marcada',
        assunto: 'Dúvidas sobre a obra',
        inicio: new Date(vagas[0].inicio),
      });
      const sms = await esperarSmsEnviado(ctx, a.telefone, 'marcacao');
      expect(sms.corpo).toContain('marcação confirmada');
      expect(sms.corpo).toContain(r.body.link);
      expect(sms.corpo).toContain('Leve: Cartão de Cidadão');

      tokenA = (await seguirLink(ctx, r.body.link)).token;

      const outra = await tool(a, 'marcar', {
        agenda_id: agenda,
        inicio: vagas[0].inicio,
        assunto: 'Dúvidas sobre a obra',
      }).expect(estado(200));
      expect(outra.body).toMatchObject({
        marcacao_id: marcacaoA,
        ja_existia: true,
      });
    });

    it('a mesma vaga noutra conversa → 409 vaga_ocupada com alternativas', async () => {
      const r = await tool(b, 'marcar', {
        agenda_id: agenda,
        inicio: vagas[0].inicio,
        assunto: 'Outra pessoa',
      }).expect(estado(409));
      expect(r.body.erro).toMatchObject({
        codigo: 'vaga_ocupada',
        detalhes: { vagas_alternativas: expect.any(Array) },
      });
      const alternativas = r.body.erro.detalhes.vagas_alternativas.map(
        (v: { inicio: string }) => v.inicio,
      );
      expect(alternativas.length).toBeGreaterThan(0);
      expect(alternativas).not.toContain(
        new Date(vagas[0].inicio).toISOString(),
      );

      // ver_vagas já não a oferece.
      const depois = await tool(b, 'ver_vagas', {
        agenda_id: agenda,
        dia: vagas[0].inicio.slice(0, 10),
        limite: 10,
      }).expect(estado(200));
      expect(
        depois.body.vagas.map((v: { inicio: string }) => v.inicio),
      ).not.toContain(new Date(vagas[0].inicio).toISOString());

      const fora = await tool(b, 'marcar', {
        agenda_id: agenda,
        inicio: '2020-01-01T10:00:00Z',
        assunto: 'No passado',
      }).expect(estado(422));
      expect(fora.body.erro.codigo).toBe('fora_do_horario');

      const ok = await tool(b, 'marcar', {
        agenda_id: agenda,
        inicio: vagas[2].inicio,
        assunto: 'Outra pessoa',
      }).expect(estado(200));
      marcacaoB = ok.body.marcacao_id;
    });

    it('público: ver e remarcar mantêm o token; a vaga antiga fica livre', async () => {
      const ver = await ctx
        .http()
        .get(`/v1/public/marcacoes/${tokenA}`)
        .expect(estado(200));
      expect(ver.body).toMatchObject({
        municipio: 'Marcações E2E',
        agenda: 'Balcão E2E',
        estado: 'marcada',
        pode_alterar: true,
        levar: ['Cartão de Cidadão'],
      });

      const r = await ctx
        .http()
        .post(`/v1/public/marcacoes/${tokenA}/remarcar`)
        .send({ inicio: vagas[1].inicio })
        .expect(estado(200));
      expect(r.body).toMatchObject({
        estado: 'marcada',
        inicio: new Date(vagas[1].inicio).toISOString(),
      });
      const bd = await linha(
        ctx.db,
        'SELECT lower(periodo) AS inicio, token_publico FROM marcacoes WHERE id = $1',
        [marcacaoA],
      );
      expect(bd).toEqual({
        inicio: new Date(vagas[1].inicio),
        token_publico: tokenA,
      });

      // Para a vaga do B → 409 vaga_ocupada.
      const ocupada = await ctx
        .http()
        .post(`/v1/public/marcacoes/${tokenA}/remarcar`)
        .send({ inicio: vagas[2].inicio })
        .expect(estado(409));
      expect(ocupada.body.erro.codigo).toBe('vaga_ocupada');

      const desconhecido = await ctx
        .http()
        .get(`/v1/public/marcacoes/${'x'.repeat(24)}`)
        .expect(estado(404));
      expect(desconhecido.body.erro.codigo).toBe('marcacao_nao_encontrada');
    });

    it('cancelar_marcacao (ferramenta) cancela a única marcação futura e manda SMS', async () => {
      const r = await tool(a, 'cancelar_marcacao', {}).expect(estado(200));
      expect(r.body).toMatchObject({
        cancelada: true,
        tipo: 'marcacao',
        o_que: expect.stringContaining('Balcão E2E'),
      });
      const bd = await linha(
        ctx.db,
        'SELECT estado FROM marcacoes WHERE id = $1',
        [marcacaoA],
      );
      expect(bd).toEqual({ estado: 'cancelada' });
      const sms = await esperarAte(() =>
        linha<{ corpo: string }>(
          ctx.db,
          `SELECT corpo FROM mensagens_saida WHERE chave_idempotencia = $1 AND estado = 'enviada'`,
          [`cancelada:${marcacaoA}`],
        ),
      );
      expect(sms.corpo).toContain('cancelámos a sua marcação');

      const nada = await tool(a, 'cancelar_marcacao', {}).expect(estado(200));
      expect(nada.body).toMatchObject({ cancelada: false });

      // Cancelada não se remarca.
      const remarcar = await ctx
        .http()
        .post(`/v1/public/marcacoes/${tokenA}/remarcar`)
        .send({ inicio: vagas[3].inicio })
        .expect(estado(409));
      expect(remarcar.body.erro.codigo).toBe('nao_pode_alterar');
    });

    it('público: cancelar pelo link (e repetir não dá erro)', async () => {
      const link = await linha<{ codigo: string }>(
        ctx.db,
        "SELECT codigo FROM links_curtos WHERE destino_tipo = 'marcacao' AND destino_id = $1",
        [marcacaoB],
      );
      const { token } = await seguirLink(ctx, `${WEB_URL}/r/${link!.codigo}`);
      const r = await ctx
        .http()
        .post(`/v1/public/marcacoes/${token}/cancelar`)
        .expect(estado(200));
      expect(r.body).toMatchObject({
        estado: 'cancelada',
        pode_alterar: false,
      });
      const outra = await ctx
        .http()
        .post(`/v1/public/marcacoes/${token}/cancelar`)
        .expect(estado(200));
      expect(outra.body.estado).toBe('cancelada');

      const sms = await smsPara(ctx, b.telefone, 'marcacao');
      expect(sms.map((s) => s.corpo)).toEqual(
        expect.arrayContaining([expect.stringContaining('cancelámos')]),
      );
    });

    it('agendar_recolha de monos: janela, SMS, repetida devolve a mesma, cancelar pela ferramenta', async () => {
      const c = novaChamada('recolha');
      const corpo = {
        itens: [
          { item: 'sofá', qtd: 1 },
          { item: 'colchão', qtd: 2 },
        ],
        morada: 'Rua das Flores, 12, Centro',
        preferencia: 'manha',
      };
      const r = await tool(c, 'agendar_recolha', corpo).expect(estado(200));
      expect(r.body).toMatchObject({
        recolha_id: expect.any(String),
        ja_existia: false,
        entidade: 'Resíduos E2E',
        quando: expect.stringContaining('manhã'),
        morada: corpo.morada,
        itens: corpo.itens,
        sms_enviado: true,
      });
      const recolha = r.body.recolha_id as string;
      const bd = await linha<{
        estado: string;
        itens: unknown;
        futura: boolean;
      }>(
        ctx.db,
        'SELECT estado, itens, lower(janela) > now() AS futura FROM recolhas WHERE id = $1',
        [recolha],
      );
      expect(bd).toEqual({
        estado: 'marcada',
        itens: corpo.itens,
        futura: true,
      });
      const sms = await esperarSmsEnviado(ctx, c.telefone, 'recolha');
      expect(sms.corpo).toContain('sofá (1), colchão (2)');

      const outra = await tool(c, 'agendar_recolha', {
        ...corpo,
        morada: ' rua das flores, 12, centro ',
      }).expect(estado(200));
      expect(outra.body).toMatchObject({
        recolha_id: recolha,
        ja_existia: true,
      });

      // Com uma marcação e uma recolha, sem id → precisa_escolher.
      const vaga = await tool(c, 'ver_vagas', { agenda_id: agenda }).expect(
        estado(200),
      );
      const m = await tool(c, 'marcar', {
        agenda_id: agenda,
        inicio: vaga.body.vagas[vaga.body.vagas.length - 1].inicio,
        assunto: 'Entregar papéis',
      }).expect(estado(200));
      const escolher = await tool(c, 'cancelar_marcacao', {}).expect(
        estado(200),
      );
      expect(escolher.body).toMatchObject({
        cancelada: false,
        precisa_escolher: true,
      });
      expect(
        escolher.body.marcacoes.map((x: { id: string }) => x.id).sort(),
      ).toEqual([recolha, m.body.marcacao_id].sort());

      const cancelada = await tool(c, 'cancelar_marcacao', {
        id: recolha,
      }).expect(estado(200));
      expect(cancelada.body).toMatchObject({
        cancelada: true,
        tipo: 'recolha',
      });
      expect(
        await linha(ctx.db, 'SELECT estado FROM recolhas WHERE id = $1', [
          recolha,
        ]),
      ).toEqual({ estado: 'cancelada' });

      const inexistente = await tool(c, 'cancelar_marcacao', {
        id: randomUUID(),
      }).expect(estado(404));
      expect(inexistente.body.erro.codigo).toBe('marcacao_nao_encontrada');
    });

    it('sem empresa de resíduos → 422 sem_entidade_recolha', async () => {
      const outro = await municipioDeMarcacoes(ctx, false);
      const r = await ctx
        .http()
        .post('/v1/agent/tools/agendar_recolha')
        .set({
          'X-Agente-Segredo': SEGREDO_AGENTE,
          'X-Municipio': outro.slug,
          'X-Conversa-Id': `recolha-${randomUUID()}`,
          'X-Telefone': novaChamada().telefone,
        })
        .send({ itens: [{ item: 'sofá', qtd: 1 }], morada: 'Rua Sem Fim, 1' })
        .expect(estado(422));
      expect(r.body.erro.codigo).toBe('sem_entidade_recolha');
    });
  });
});
