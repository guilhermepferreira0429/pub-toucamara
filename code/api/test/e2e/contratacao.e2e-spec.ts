/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  linhas,
  MUNICIPIO_ID,
} from './app';

/**
 * Contratação pública (V3 · n.º 8), só painel: importar o CSV do portal
 * BASE → avaliar (cabe / não cabe / limite acumulado / fracionamento) →
 * preparar o procedimento com as peças sem IA → PDF → revisão, aprovação
 * e registo da publicação no BASE. Permissões e auditoria. O assistente
 * interno responde a "cabe no ajuste direto?" com o mesmo motor.
 */
describe('Contratação pública (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  let atendimento: Record<string, string>;
  let vereador: Record<string, string>;

  // O motor usa o ano económico de hoje: os contratos ficam neste ano e no anterior.
  const ano = Number(
    new Date()
      .toLocaleDateString('sv-SE', { timeZone: 'Europe/Lisbon' })
      .slice(0, 4),
  );
  const NIF_A = '501234560'; // Jardins do Minho (válido)
  const NIF_B = '503456780'; // Papelaria Central (válido)
  const NIF_C = '508000009'; // sem contratos

  const csv = [
    'Objeto do Contrato;Tipo de Procedimento;Tipo(s) de Contrato;CPV;Entidade(s) Adjudicante(s);Entidade(s) Adjudicatária(s);Preço Contratual;Data de Celebração do Contrato',
    `Manutenção de espaços verdes do parque da cidade;Ajuste Direto Regime Geral;Aquisição de serviços;"77310000-6, Serviços de plantação";Município de Teste;Jardins do Minho, Lda (${NIF_A});"50.000,00 €";15-06-${ano - 1}`,
    `Poda de árvores em arruamentos;Ajuste Direto Regime Geral;Aquisição de serviços;77341000-2;Município de Teste;Jardins do Minho, Lda (${NIF_A});"15.000,00 €";01-01-${ano}`,
    `Limpeza das escolas básicas;Ajuste Direto Regime Geral;Aquisição de serviços;90910000-9;Município de Teste;Limpezas do Ave (${NIF_B});"40.000,00 €";01-01-${ano}`,
    `Contrato antigo;Ajuste Direto Regime Geral;Aquisição de serviços;77310000-6;Município de Teste;Jardins do Minho, Lda (${NIF_A});"90.000,00 €";01-01-${ano - 3}`,
    `Linha estragada;Ajuste Direto;Aquisição de serviços;;Município;Sem NIF;100;01-01-${ano}`,
  ].join('\n');

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
    atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    vereador = await entrarPainel(ctx, await criarUtilizador(ctx, 'vereador'));
  });
  afterAll(() => ctx.fechar());

  const base = '/v1/painel/contratacao';
  const avaliar = (corpo: Record<string, unknown>, quem = tecnico) =>
    ctx
      .http()
      .post(`${base}/avaliar`)
      .set(quem)
      .send({
        tipo: 'servicos',
        objeto: 'Serviço de consultoria',
        prazo_meses: 12,
        ...corpo,
      });

  describe('permissões', () => {
    it('atendimento e vereador não entram; técnico e chefia sim', async () => {
      for (const quem of [atendimento, vereador]) {
        const r = await avaliar({ valor_estimado_cent: 100 }, quem).expect(403);
        expect(r.body.erro.codigo).toBe('sem_permissao');
        await ctx.http().get(`${base}/procedimentos`).set(quem).expect(403);
      }
      await avaliar({ valor_estimado_cent: 100 }, tecnico).expect(200);
      await avaliar({ valor_estimado_cent: 100 }, chefe).expect(200);
    });

    it('mudar os limiares é da chefia', async () => {
      const { body } = await ctx
        .http()
        .get(`${base}/config`)
        .set(tecnico)
        .expect(200);
      await ctx
        .http()
        .put(`${base}/config`)
        .set(tecnico)
        .send(body.config)
        .expect(403);
    });
  });

  describe('configuração (valores de demonstração)', () => {
    it('sem config guardada: demonstração, 75 000 € em serviços citado do PRD', async () => {
      const r = await ctx.http().get(`${base}/config`).set(chefe).expect(200);
      expect(r.body.demonstracao).toBe(true);
      expect(r.body.guardada).toBe(false);
      expect(r.body.fonte).toBe(
        'Código dos Contratos Públicos (DL 18/2008) na versão em vigor — a confirmar pelo jurista; valores do PRD do projeto',
      );
      expect(r.body.config.tipos.servicos.ajuste_direto_cent).toBe(7_500_000);
      expect(r.body.config.tipos.servicos.fonte).toMatch(/PRD/);
      expect(r.body.config.acumulado.a_confirmar).toBe(true);
    });

    it('a chefia guarda; limiares fora de ordem → 400', async () => {
      const { body } = await ctx
        .http()
        .get(`${base}/config`)
        .set(chefe)
        .expect(200);
      const mau = structuredClone(body.config);
      mau.tipos.bens.ajuste_direto_cent = 99_000_000;
      const e = await ctx
        .http()
        .put(`${base}/config`)
        .set(chefe)
        .send(mau)
        .expect(400);
      expect(e.body.erro.codigo).toBe('pedido_invalido');
      await ctx
        .http()
        .put(`${base}/config`)
        .set(chefe)
        .send(body.config)
        .expect(200);
      const a = await linha(
        ctx.db,
        `SELECT acao, objeto_tipo FROM audit_log WHERE municipio_id = $1 AND acao = 'mudar_regras_contratacao'`,
        [MUNICIPIO_ID],
      );
      expect(a.objeto_tipo).toBe('contratacao_config');
    });
  });

  describe('registo de contratos', () => {
    it('importa o CSV do BASE: válidas entram, erros por linha', async () => {
      const r = await ctx
        .http()
        .post(`${base}/contratos/importar`)
        .set(tecnico)
        .send({ csv })
        .expect(200);
      expect(r.body).toMatchObject({ importados: 4, repetidos: 0 });
      expect(r.body.erros).toEqual([
        { linha: 6, motivo: 'sem NIF do adjudicatário.' },
      ]);
      const c = await linha(
        ctx.db,
        `SELECT adjudicatario_nome, tipo, procedimento, preco_contratual_cent::int AS cent, origem
         FROM contratos_publicos WHERE municipio_id = $1 AND objeto LIKE 'Poda%'`,
        [MUNICIPIO_ID],
      );
      expect(c).toEqual({
        adjudicatario_nome: 'Jardins do Minho, Lda',
        tipo: 'servicos',
        procedimento: 'ajuste_direto',
        cent: 1_500_000,
        origem: 'csv',
      });
    });

    it('importar outra vez não duplica', async () => {
      const r = await ctx
        .http()
        .post(`${base}/contratos/importar`)
        .set(tecnico)
        .send({ csv })
        .expect(200);
      expect(r.body).toMatchObject({ importados: 0, repetidos: 4 });
    });

    it('cria à mão; repetido → 409; NIF inválido → 400', async () => {
      const corpo = {
        adjudicatario_nif: NIF_B,
        adjudicatario_nome: 'Papelaria Central',
        objeto: 'Material de escritório',
        tipo: 'bens',
        preco_contratual_cent: 300_000,
        data_contrato: `${ano}-02-01`,
        procedimento: 'ajuste_direto_simplificado',
      };
      const r = await ctx
        .http()
        .post(`${base}/contratos`)
        .set(tecnico)
        .send(corpo)
        .expect(201);
      expect(r.body).toMatchObject({
        origem: 'manual',
        preco_contratual_cent: 300_000,
      });
      const e = await ctx
        .http()
        .post(`${base}/contratos`)
        .set(tecnico)
        .send(corpo)
        .expect(409);
      expect(e.body.erro.codigo).toBe('contrato_repetido');
      await ctx
        .http()
        .post(`${base}/contratos`)
        .set(tecnico)
        .send({ ...corpo, adjudicatario_nif: '123456780' })
        .expect(400);
    });

    it('lista por NIF e ano', async () => {
      const r = await ctx
        .http()
        .get(`${base}/contratos?nif=${NIF_A}&ano=${ano}`)
        .set(tecnico)
        .expect(200);
      expect(r.body.itens.map((x: any) => x.objeto)).toEqual([
        'Poda de árvores em arruamentos',
      ]);
      expect(r.body.itens[0].data_contrato).toBe(`${ano}-01-01`);
    });
  });

  describe('avaliar (simular sem gravar)', () => {
    it('cabe: 60 000 € de serviços a uma entidade sem contratos', async () => {
      const r = await avaliar({
        valor_estimado_cent: 6_000_000,
        entidade_adjudicataria: NIF_C,
      }).expect(200);
      expect(r.body).toMatchObject({
        cabe_ajuste_direto: true,
        recomendado: 'ajuste_direto',
        demonstracao: true,
      });
      expect(r.body.acumulado).toMatchObject({
        verificado: true,
        anteriores_cent: 0,
      });
      const ad = r.body.procedimentos.find(
        (x: any) => x.procedimento === 'ajuste_direto',
      );
      expect(ad.pecas.map((x: any) => x.codigo)).toEqual(
        expect.arrayContaining([
          'convite',
          'caderno_encargos',
          'informacao_cabimento',
          'publicacao_base',
        ]),
      );
    });

    it('não cabe: 80 000 € pede consulta prévia', async () => {
      const r = await avaliar({
        valor_estimado_cent: 8_000_000,
        entidade_adjudicataria: NIF_C,
      }).expect(200);
      expect(r.body.cabe_ajuste_direto).toBe(false);
      expect(r.body.recomendado).toBe('consulta_previa');
      expect(r.body.resumo).toMatch(/^Não cabe no ajuste direto/);
    });

    it('acumulado: a Jardins do Minho já tem 65 000 €; mais 10 000 € chega aos 75 000 €', async () => {
      const r = await avaliar({
        valor_estimado_cent: 1_000_000,
        entidade_adjudicataria: NIF_A,
        objeto: 'Corte de relva nas rotundas',
        cpv: '77310000-6',
      }).expect(200);
      expect(r.body.acumulado).toMatchObject({
        verificado: true,
        anteriores_cent: 6_500_000,
        total_cent: 7_500_000,
        anos: [ano - 2, ano - 1, ano],
      });
      expect(r.body.acumulado.contratos).toHaveLength(2); // o de há 3 anos fica de fora
      expect(r.body.cabe_ajuste_direto).toBe(false);
      expect(r.body.recomendado).toBe('consulta_previa');
      // A mesma coisa a outra entidade cabe.
      const outra = await avaliar({
        valor_estimado_cent: 1_000_000,
        entidade_adjudicataria: NIF_C,
        objeto: 'Corte de relva nas rotundas',
        cpv: '77310000-6',
      }).expect(200);
      expect(outra.body.cabe_ajuste_direto).toBe(true);
    });

    it('fracionamento: limpeza semelhante às escolas no mesmo ano', async () => {
      const r = await avaliar({
        valor_estimado_cent: 4_000_000,
        entidade_adjudicataria: NIF_C,
        objeto: 'Limpeza das escolas básicas do concelho',
      }).expect(200);
      expect(r.body.fracionamento).toMatchObject({
        alerta: true,
        soma_semelhantes_cent: 4_000_000,
        total_cent: 8_000_000,
        procedimento_pelo_total: 'consulta_previa',
      });
      expect(r.body.alertas.join(' ')).toMatch(/fracionamento/);
    });

    it('não grava nada', async () => {
      const n = await linha(
        ctx.db,
        `SELECT count(*)::int AS n FROM contratacao_procedimentos WHERE municipio_id = $1`,
        [MUNICIPIO_ID],
      );
      expect(n.n).toBe(0);
    });

    it('valida o pedido', async () => {
      const r = await avaliar({ valor_estimado_cent: -1 }).expect(400);
      expect(r.body.erro.codigo).toBe('pedido_invalido');
      await avaliar({
        valor_estimado_cent: 100,
        entidade_adjudicataria: '123',
      }).expect(400);
    });
  });

  describe('preparar um procedimento', () => {
    let id: string;
    const pedido = {
      servico_requerente: 'Divisão de Espaços Verdes',
      tipo: 'servicos',
      objeto: 'Manutenção dos jardins do centro histórico',
      fundamentacao: 'A equipa municipal não chega para a época alta.',
      valor_estimado_cent: 4_000_000,
      prazo_meses: 12,
      entidade_adjudicataria: NIF_C,
      entidade_nome: 'Verdes do Norte, Lda',
    };

    it('procedimento não admissível → 422 com o porquê', async () => {
      const r = await ctx
        .http()
        .post(`${base}/procedimentos`)
        .set(tecnico)
        .send({ ...pedido, procedimento: 'ajuste_direto_simplificado' })
        .expect(422);
      expect(r.body.erro.codigo).toBe('procedimento_nao_admissivel');
      expect(r.body.erro.mensagem).toMatch(/simplificado/);
    });

    it('grava o pedido, corre o motor e gera as peças sem IA', async () => {
      const r = await ctx
        .http()
        .post(`${base}/procedimentos`)
        .set(tecnico)
        .send(pedido)
        .expect(201);
      id = r.body.id;
      expect(r.body).toMatchObject({
        numero: `PCP 1/${ano}`,
        estado: 'rascunho',
        procedimento: 'ajuste_direto',
        valor_estimado_cent: 4_000_000,
        demonstracao: true,
        pedido_por_nome: 'Teste tecnico',
      });
      expect(r.body.motivo_sem_ia).toMatch(/não está configurado/);
      expect(r.body.avaliacao.recomendado).toBe('ajuste_direto');
      expect(r.body.pecas.map((p: any) => p.tipo)).toEqual([
        'convite',
        'caderno_encargos',
      ]);
      for (const p of r.body.pecas) {
        expect(p.modo).toBe('modelo');
        expect(p.aviso).toMatch(/Rascunho para revisão jurídica/);
        expect(p.campos_a_preencher.length).toBeGreaterThan(0);
      }
      const convite = r.body.pecas[0];
      expect(convite.secoes.map((s: any) => s.texto).join(' ')).toContain(
        'Verdes do Norte, Lda, NIF 508000009',
      );
      const a = await linha(
        ctx.db,
        `SELECT acao FROM audit_log WHERE objeto_tipo = 'procedimento_contratacao' AND objeto_id = $1`,
        [id],
      );
      expect(a.acao).toBe('criar');
    });

    it('lista e detalhe', async () => {
      const l = await ctx
        .http()
        .get(`${base}/procedimentos?estado=rascunho`)
        .set(chefe)
        .expect(200);
      expect(l.body.itens.map((x: any) => x.id)).toEqual([id]);
      await ctx
        .http()
        .get(`${base}/procedimentos/${id}`)
        .set(chefe)
        .expect(200);
      await ctx
        .http()
        .get(`${base}/procedimentos/00000000-0000-0000-0000-00000000dead`)
        .set(chefe)
        .expect(404);
    });

    it('PDF das peças, marcado como rascunho', async () => {
      for (const tipo of ['convite', 'caderno_encargos']) {
        const r = await ctx
          .http()
          .get(`${base}/procedimentos/${id}/pecas/${tipo}/pdf`)
          .set(tecnico)
          .buffer(true)
          .parse((res, cb) => {
            const partes: Buffer[] = [];
            res.on('data', (p: Buffer) => partes.push(p));
            res.on('end', () => cb(null, Buffer.concat(partes)));
          })
          .expect(200);
        expect(r.headers['content-type']).toContain('application/pdf');
        expect((r.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      }
      await ctx
        .http()
        .get(`${base}/procedimentos/${id}/pecas/outra/pdf`)
        .set(tecnico)
        .expect(400);
    });

    it('edita uma peça em rascunho', async () => {
      const r = await ctx
        .http()
        .put(`${base}/procedimentos/${id}/pecas/caderno_encargos`)
        .set(tecnico)
        .send({
          secoes: [
            {
              titulo: 'Cláusula 1.ª — Objeto',
              texto: 'Manutenção dos jardins.',
            },
            {
              titulo: 'Cláusula 2.ª — Prazo',
              texto: '[a preencher: data de início]',
            },
          ],
        })
        .expect(200);
      const c = r.body.pecas.find((p: any) => p.tipo === 'caderno_encargos');
      expect(c).toMatchObject({
        modo: 'editada',
        campos_a_preencher: ['data de início'],
      });
    });

    it('revisão → aprovação (só a chefia) → publicação no BASE', async () => {
      await ctx
        .http()
        .post(`${base}/procedimentos/${id}/estado`)
        .set(tecnico)
        .send({ estado: 'aprovado' })
        .expect(409);
      const rv = await ctx
        .http()
        .post(`${base}/procedimentos/${id}/estado`)
        .set(tecnico)
        .send({ estado: 'em_revisao', nota: 'Para o jurista ver.' })
        .expect(200);
      expect(rv.body).toMatchObject({
        estado: 'em_revisao',
        nota: 'Para o jurista ver.',
      });
      const e = await ctx
        .http()
        .post(`${base}/procedimentos/${id}/estado`)
        .set(tecnico)
        .send({ estado: 'aprovado' })
        .expect(403);
      expect(e.body.erro.codigo).toBe('sem_permissao');
      await ctx
        .http()
        .post(`${base}/procedimentos/${id}/publicar`)
        .set(chefe)
        .send({ base_numero: '123/2026' })
        .expect(409);
      const ap = await ctx
        .http()
        .post(`${base}/procedimentos/${id}/estado`)
        .set(chefe)
        .send({ estado: 'aprovado' })
        .expect(200);
      expect(ap.body).toMatchObject({
        estado: 'aprovado',
        aprovado_por_nome: expect.any(String),
      });
      // Aprovado: as peças já não se alteram.
      await ctx
        .http()
        .put(`${base}/procedimentos/${id}/pecas/convite`)
        .set(chefe)
        .send({ secoes: [{ titulo: 'x', texto: 'y' }] })
        .expect(409);

      const pb = await ctx
        .http()
        .post(`${base}/procedimentos/${id}/publicar`)
        .set(tecnico)
        .send({ base_numero: '10432/2026', preco_contratual_cent: 3_900_000 })
        .expect(200);
      expect(pb.body).toMatchObject({
        estado: 'publicado',
        base_numero: '10432/2026',
      });

      // O contrato entra no registo e passa a contar no acumulado.
      const c = await linha(
        ctx.db,
        `SELECT origem, adjudicatario_nif, adjudicatario_nome, preco_contratual_cent::int AS cent, base_numero
         FROM contratos_publicos WHERE procedimento_id = $1`,
        [id],
      );
      expect(c).toEqual({
        origem: 'procedimento',
        adjudicatario_nif: NIF_C,
        adjudicatario_nome: 'Verdes do Norte, Lda',
        cent: 3_900_000,
        base_numero: '10432/2026',
      });
      const r = await avaliar({
        valor_estimado_cent: 4_000_000,
        entidade_adjudicataria: NIF_C,
      }).expect(200);
      expect(r.body.acumulado.anteriores_cent).toBe(3_900_000);
      expect(r.body.cabe_ajuste_direto).toBe(false);

      const acoes = await linhas(
        ctx.db,
        `SELECT acao FROM audit_log WHERE objeto_tipo = 'procedimento_contratacao' AND objeto_id = $1 ORDER BY em`,
        [id],
      );
      expect(acoes.map((x) => x.acao)).toEqual([
        'criar',
        'alterar_peca_contratacao',
        'enviar_revisao_contratacao',
        'aprovar',
        'publicar',
      ]);
    });

    it('o registo de acessos tem frases para estas ações', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/equipa/acessos?limite=200')
        .set(chefe)
        .expect(200);
      const frases = JSON.stringify(r.body);
      expect(frases).toContain(
        'enviou para revisão jurídica um procedimento de contratação pública',
      );
      expect(frases).toContain(
        'importou contratos do portal BASE para o registo de contratos públicos',
      );
    });
  });

  describe('assistente interno', () => {
    it('"cabe no ajuste direto?" responde com o motor, sem IA', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/assistente/perguntar')
        .set(atendimento)
        .send({ pergunta: 'Um serviço de 80 mil euros cabe no ajuste direto?' })
        .expect(200);
      expect(r.body.estado).toBe('respondida');
      expect(r.body.resposta).toMatch(/^Não cabe no ajuste direto/);
      expect(r.body.resposta).toMatch(/Valores de demonstração/);
      expect(r.body.contratacao).toMatchObject({
        tipo: 'servicos',
        valor_estimado_cent: 8_000_000,
        cabe_ajuste_direto: false,
        recomendado: 'consulta_previa',
      });
      const sim = await ctx
        .http()
        .post('/v1/painel/assistente/perguntar')
        .set(atendimento)
        .send({
          pergunta: 'Posso fazer ajuste direto de serviços de 20 000 €?',
        })
        .expect(200);
      expect(sim.body.resposta).toMatch(/^Sim/);
    });

    it('outras perguntas seguem o caminho de sempre', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/assistente/perguntar')
        .set(atendimento)
        .send({ pergunta: 'Como trato um pedido de cartão de residente?' })
        .expect(200);
      expect(r.body.contratacao).toBeUndefined();
    });
  });
});
