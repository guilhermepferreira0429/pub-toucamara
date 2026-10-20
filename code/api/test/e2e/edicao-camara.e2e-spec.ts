/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import { WEB_URL } from './ambiente';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  linha,
  linhas,
  MUNICIPIO_ID,
  novoTelefone,
  TIPO_CP_ID,
} from './app';

/**
 * V2: a câmara (chefe de divisão) edita respostas curadas com dupla
 * verificação, transforma perguntas sem resposta em respostas, e gere os
 * seus modelos de resposta (ofícios, emails, SMS).
 */

/** Palavra inventada (só letras), para a pesquisa só achar o que é deste teste. */
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

function auditoria(ctx: Contexto, objetoId: string, acao?: string) {
  return linhas<{ acao: string; ator_id: string; dados: Record<string, any> }>(
    ctx.db,
    `SELECT acao, ator_id, dados FROM audit_log
     WHERE objeto_id = $1 AND ($2::text IS NULL OR acao = $2)
     ORDER BY em, id`,
    [objetoId, acao ?? null],
  );
}

describe('Edição pela câmara e modelos de resposta (e2e)', () => {
  let ctx: Contexto;
  let chefeId: string;
  let chefe: Record<string, string>;
  let interno: Record<string, string>;
  let tecnico: Record<string, string>;
  let atendimento: Record<string, string>;
  let versaoOriginal: string;
  let versaoAgente: string;
  let sistemaId: string;
  let conjuntoId: string;
  const perguntas: string[] = [];

  /** Execução terminada do nosso tou-chat, iniciada há `haSegundos`. */
  async function inserirExecucao(
    veredictos: string[],
    haSegundos: number,
  ): Promise<string> {
    const e = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.execucoes
         (sistema_id, conjunto_id, agente_versao, motivo, amostra, estado, iniciada_em, terminada_em)
       VALUES ($1, $2, $3, 'publicacao', false, 'terminada',
               now() - make_interval(secs => $4), now() - make_interval(secs => $4) + interval '1 second')
       RETURNING id`,
      [sistemaId, conjuntoId, versaoAgente, haSegundos],
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

  const url = (s: string) => `/v1/painel/conhecimento/${s}`;

  function publicar(
    headers: Record<string, string>,
    respostaId: string,
    corpo: object,
  ) {
    return ctx
      .http()
      .post(url(`respostas/${respostaId}/publicar`))
      .set(headers)
      .send(corpo);
  }

  function novaVersao(respostaId: string, textoVoz: string) {
    return ctx
      .http()
      .post(url(`respostas/${respostaId}/versoes`))
      .set(chefe)
      .send({ texto_voz: textoVoz })
      .expect(estado(201));
  }

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefeId = await criarUtilizador(ctx, 'chefe_divisao');
    chefe = await entrarPainel(ctx, chefeId);
    interno = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'equipa_toucamara'),
    );
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
    atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    // Versão própria do agente: só as execuções deste ficheiro contam.
    versaoOriginal = (await linha(
      ctx.db,
      'SELECT versao FROM agente_config WHERE municipio_id = $1',
      [MUNICIPIO_ID],
    ))!.versao;
    versaoAgente = `e2e-edicao-${randomUUID()}`;
    await ctx.db.query(
      'UPDATE agente_config SET versao = $2 WHERE municipio_id = $1',
      [MUNICIPIO_ID, versaoAgente],
    );
    sistemaId = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, nosso)
       VALUES ($1, $2, 'tou-chat', true) RETURNING id`,
      [`Tou chat · edição · ${randomUUID()}`, MUNICIPIO_ID],
    ))!.id;
    conjuntoId = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avaliacao.conjuntos (nome, municipio_id) VALUES ($1, $2) RETURNING id`,
      [`Perguntas edição ${randomUUID()}`, MUNICIPIO_ID],
    ))!.id;
    for (let i = 1; i <= 5; i++) {
      const p = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO avaliacao.perguntas (conjunto_id, ordem, categoria, texto, comportamento)
         VALUES ($1, $2, 'obras', $3, 'responder') RETURNING id`,
        [conjuntoId, i, `Pergunta ${i}?`],
      );
      perguntas.push(p!.id);
    }
  });

  afterAll(async () => {
    // A edição pela câmara e a versão do agente são do município partilhado.
    await ctx.db.query(
      'DELETE FROM conhecimento_definicoes WHERE municipio_id = $1',
      [MUNICIPIO_ID],
    );
    await ctx.db.query(
      'UPDATE agente_config SET versao = $2 WHERE municipio_id = $1',
      [MUNICIPIO_ID, versaoOriginal],
    );
    await ctx.fechar();
  });

  /* ---------------------------------------------------------------- */
  /* Respostas curadas escritas pela câmara                            */
  /* ---------------------------------------------------------------- */

  describe('respostas escritas pela câmara', () => {
    const palavra = palavraUnica();
    const frase1 = `O ${palavra} fica no largo da câmara.`;
    const frase2 = 'Abre às 9h e o telefone é o 253 000 111.';
    let respostaId: string;
    let v1: string;
    let v2: string;
    let v3: string;

    it('por defeito (V1) a câmara não escreve; só a equipa interna liga a edição', async () => {
      const d = await ctx.http().get(url('definicoes')).set(chefe).expect(200);
      expect(d.body.camara_edita_respostas).toBe(false);

      const c = await ctx
        .http()
        .post(url('respostas'))
        .set(chefe)
        .send({ pergunta_tipo: 'Pergunta do chefe?', texto_voz: 'Resposta.' })
        .expect(403);
      expect(c.body.erro.codigo).toBe('so_equipa_interna');

      const p = await ctx
        .http()
        .patch(url('definicoes'))
        .set(chefe)
        .send({ camara_edita_respostas: true })
        .expect(403);
      expect(p.body.erro.codigo).toBe('so_equipa_interna');
      await ctx
        .http()
        .patch(url('definicoes'))
        .set(atendimento)
        .send({ camara_edita_respostas: true })
        .expect(403);

      const ok = await ctx
        .http()
        .patch(url('definicoes'))
        .set(interno)
        .send({ camara_edita_respostas: true })
        .expect(200);
      expect(ok.body).toMatchObject({
        camara_edita_respostas: true,
        atualizado_por: 'Teste equipa_toucamara',
      });
      const aud = await auditoria(ctx, MUNICIPIO_ID, 'definicoes');
      expect(aud.at(-1)?.dados).toEqual({ camara_edita_respostas: true });
    });

    it('o chefe cria uma resposta: versão em_revisao; sem avaliação não publica', async () => {
      const r = await ctx
        .http()
        .post(url('respostas'))
        .set(chefe)
        .send({ pergunta_tipo: `Onde fica o ${palavra}?`, texto_voz: frase1 })
        .expect(estado(201));
      respostaId = r.body.id;
      v1 = r.body.versoes[0].id;
      expect(r.body).toMatchObject({
        estado: 'rascunho',
        versao_no_ar_id: null,
      });
      expect(r.body.versoes[0]).toMatchObject({
        numero: 1,
        origem: 'camara',
        estado: 'em_revisao',
        muda_factos: false,
        precisa_de: ['avaliacao'],
      });

      const p = await publicar(chefe, respostaId, { versao_id: v1 }).expect(
        409,
      );
      expect(p.body.erro).toMatchObject({
        codigo: 'avaliacao_em_falta',
        detalhes: { precisa_de: ['avaliacao'], limiar: 80 },
      });
      const aud = await auditoria(ctx, respostaId, 'criar');
      expect(aud).toEqual([
        expect.objectContaining({
          ator_id: chefeId,
          dados: { versao_id: v1, origem: 'camara' },
        }),
      ]);
    });

    it('com a avaliação ≥ 80%, o chefe publica uma versão sem factos novos', async () => {
      await inserirExecucao(
        ['certa', 'certa', 'passada_bem', 'certa', 'errada'],
        3600,
      );
      const g = await ctx
        .http()
        .get(url(`respostas/${respostaId}`))
        .set(chefe)
        .expect(200);
      expect(g.body.versoes[0].precisa_de).toEqual([]);

      const p = await publicar(chefe, respostaId, { versao_id: v1 }).expect(
        estado(200),
      );
      expect(p.body).toMatchObject({
        estado: 'no_ar',
        versao_no_ar_id: v1,
        versoes: [expect.objectContaining({ id: v1, estado: 'no_ar' })],
      });
      const aud = await auditoria(ctx, respostaId, 'publicar');
      expect(aud).toEqual([
        expect.objectContaining({
          ator_id: chefeId,
          dados: expect.objectContaining({
            versao_id: v1,
            origem: 'camara',
            muda_factos: false,
          }),
        }),
      ]);
    });

    it('uma versão que muda factos espera pela equipa interna; aprovada, publica', async () => {
      const r = await novaVersao(respostaId, `${frase1} ${frase2}`);
      v2 = r.body.versoes[0].id;
      expect(r.body.versoes[0]).toMatchObject({
        numero: 2,
        origem: 'camara',
        estado: 'em_revisao',
        muda_factos: true,
        factos: {
          adicionados: { numeros: ['9h00'], telefones: ['253000111'] },
        },
        // A avaliação que passa é anterior a esta versão.
        precisa_de: ['revisao_interna'],
      });

      const p = await publicar(chefe, respostaId, { versao_id: v2 }).expect(
        409,
      );
      expect(p.body.erro).toMatchObject({
        codigo: 'revisao_interna_em_falta',
        detalhes: {
          precisa_de: ['revisao_interna'],
          factos: { adicionados: { telefones: ['253000111'] } },
        },
      });

      const fila = await ctx
        .http()
        .get(url('revisoes'))
        .set(interno)
        .expect(200);
      expect(fila.body.itens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            versao_id: v2,
            resposta_id: respostaId,
            precisa_de: ['revisao_interna'],
            criada_por: 'Teste chefe_divisao',
          }),
        ]),
      );

      const negado = await ctx
        .http()
        .post(url(`respostas/${respostaId}/versoes/${v2}/rever`))
        .set(chefe)
        .send({ decisao: 'aprovar' })
        .expect(403);
      expect(negado.body.erro.codigo).toBe('so_equipa_interna');

      const rev = await ctx
        .http()
        .post(url(`respostas/${respostaId}/versoes/${v2}/rever`))
        .set(interno)
        .send({ decisao: 'aprovar', nota: 'Telefone confirmado no site.' })
        .expect(estado(200));
      expect(
        rev.body.versoes.find((v: { id: string }) => v.id === v2),
      ).toMatchObject({ revisao: 'aprovada', precisa_de: [] });

      await publicar(chefe, respostaId, { versao_id: v2 }).expect(estado(200));
      const bd = await linha(
        ctx.db,
        'SELECT versao_no_ar_id FROM respostas WHERE id = $1',
        [respostaId],
      );
      expect(bd.versao_no_ar_id).toBe(v2);
      expect(await auditoria(ctx, respostaId, 'rever')).toEqual([
        expect.objectContaining({
          dados: {
            versao_id: v2,
            revisao: 'aprovada',
            nota: 'Telefone confirmado no site.',
          },
        }),
      ]);
    });

    it('... ou uma avaliação iniciada depois da versão', async () => {
      const r = await novaVersao(
        respostaId,
        `${frase1} Abre às 9h e o telefone é o 253 000 222.`,
      );
      v3 = r.body.versoes[0].id;
      expect(r.body.versoes[0].precisa_de).toEqual(['revisao_interna']);

      await inserirExecucao(['certa', 'certa', 'certa', 'certa', 'certa'], 0);
      const g = await ctx
        .http()
        .get(url(`respostas/${respostaId}`))
        .set(chefe)
        .expect(200);
      expect(g.body.versoes[0]).toMatchObject({ id: v3, precisa_de: [] });
      await publicar(chefe, respostaId, { versao_id: v3 }).expect(estado(200));
    });

    it('rejeitada pela equipa: a câmara não a publica e sai da fila', async () => {
      const r = await novaVersao(respostaId, `${frase1} Fecha ao sábado.`);
      const v4 = r.body.versoes[0].id;
      await ctx
        .http()
        .post(url(`respostas/${respostaId}/versoes/${v4}/rever`))
        .set(interno)
        .send({ decisao: 'rejeitar', nota: 'Abre ao sábado.' })
        .expect(200);
      const p = await publicar(chefe, respostaId, { versao_id: v4 }).expect(
        409,
      );
      expect(p.body.erro.codigo).toBe('versao_rejeitada');
      const fila = await ctx
        .http()
        .get(url('revisoes'))
        .set(interno)
        .expect(200);
      expect(
        fila.body.itens.some((i: { versao_id: string }) => i.versao_id === v4),
      ).toBe(false);
      // Forçar continua a ser só da equipa interna.
      const f = await publicar(chefe, respostaId, {
        versao_id: v4,
        forcar: true,
      }).expect(403);
      expect(f.body.erro.codigo).toBe('so_equipa_interna');
    });

    it('histórico com diff por frase, quem e quando; reverter cria uma versão igual', async () => {
      const h = await ctx
        .http()
        .get(url(`respostas/${respostaId}/versoes`))
        .set(atendimento)
        .expect(200);
      expect(h.body.versao_no_ar_id).toBe(v3);
      expect(h.body.versoes.map((v: { numero: number }) => v.numero)).toEqual([
        4, 3, 2, 1,
      ]);
      const [h4, h3, h2] = h.body.versoes;
      expect(h4).toMatchObject({ estado: 'rejeitada', revisao: 'rejeitada' });
      expect(h3).toMatchObject({ estado: 'no_ar' });
      expect(h2).toMatchObject({
        estado: 'publicada',
        origem: 'camara',
        criada_por: {
          id: chefeId,
          nome: 'Teste chefe_divisao',
          perfil: 'chefe_divisao',
        },
        criada_em: expect.any(String),
        revista_por: { nome: 'Teste equipa_toucamara' },
        diff: {
          anterior_numero: 1,
          texto_voz: [
            { tipo: 'igual', frase: frase1 },
            { tipo: 'adicionada', depois: frase2 },
          ],
        },
      });
      expect(h3.diff.texto_voz).toEqual([
        { tipo: 'igual', frase: frase1 },
        {
          tipo: 'alterada',
          antes: frase2,
          depois: 'Abre às 9h e o telefone é o 253 000 222.',
        },
      ]);

      const r = await ctx
        .http()
        .post(url(`respostas/${respostaId}/versoes/${v1}/reverter`))
        .set(chefe)
        .expect(estado(201));
      expect(r.body.versoes[0]).toMatchObject({
        id: r.body.versao_id,
        numero: 5,
        texto_voz: frase1,
        reverte_de: v1,
        origem: 'camara',
        // Tira o horário e o telefone que estão no ar: também é mudar factos.
        muda_factos: true,
        precisa_de: ['revisao_interna'],
      });
      expect(await auditoria(ctx, respostaId, 'reverter')).toEqual([
        expect.objectContaining({
          ator_id: chefeId,
          dados: {
            versao_id: r.body.versao_id,
            reverte_de: v1,
            origem: 'camara',
          },
        }),
      ]);
      const h5 = await ctx
        .http()
        .get(url(`respostas/${respostaId}/versoes`))
        .set(chefe)
        .expect(200);
      expect(h5.body.versoes[0]).toMatchObject({
        numero: 5,
        reverte_de_numero: 1,
      });
    });

    it('versão de outra resposta / resposta inexistente → 404', async () => {
      await ctx
        .http()
        .post(url(`respostas/${respostaId}/versoes/${randomUUID()}/reverter`))
        .set(chefe)
        .expect(404);
      await ctx
        .http()
        .get(url(`respostas/${randomUUID()}/versoes`))
        .set(chefe)
        .expect(404);
    });
  });

  /* ---------------------------------------------------------------- */
  /* Perguntas sem resposta → respostas                                */
  /* ---------------------------------------------------------------- */

  describe('perguntas sem resposta transformadas em respostas', () => {
    it('cria a resposta com as frases reais, liga-a; resolvida só ao publicar', async () => {
      const palavra = palavraUnica();
      const conversa = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO conversas (municipio_id, canal) VALUES ($1, 'telefone') RETURNING id`,
        [MUNICIPIO_ID],
      );
      const ditas = [
        `Posso levar o cão ao ${palavra}?`,
        `E no ${palavra}, os cães podem entrar?`,
      ];
      const turnos: string[] = [];
      for (const [i, t] of ditas.entries()) {
        const x = await linha<{ id: string }>(
          ctx.db,
          `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto)
           VALUES ($1, $2, 'municipe', $3) RETURNING id`,
          [conversa!.id, i + 1, t],
        );
        turnos.push(x!.id);
      }
      const psr = (await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes)
         VALUES ($1, $2, 2) RETURNING id`,
        [MUNICIPIO_ID, `Podem entrar cães no ${palavra}?`],
      ))!.id;
      for (const t of turnos) {
        await ctx.db.query(
          'INSERT INTO pergunta_sem_resposta_ocorrencias (psr_id, turno_id) VALUES ($1, $2)',
          [psr, t],
        );
      }

      const r = await ctx
        .http()
        .post(url(`sem-resposta/${psr}/responder`))
        .set(chefe)
        .send({
          texto_voz: `Sim, os cães podem entrar no ${palavra} com trela.`,
        })
        .expect(estado(201));
      expect(r.body.pergunta).toMatchObject({
        id: psr,
        estado: 'nova',
        resposta_id: r.body.resposta.id,
      });
      expect(r.body.resposta).toMatchObject({
        pergunta_tipo: `Podem entrar cães no ${palavra}?`,
        estado: 'rascunho',
        versoes: [
          expect.objectContaining({ origem: 'camara', estado: 'em_revisao' }),
        ],
      });
      expect(
        r.body.resposta.frases.map((f: { frase: string }) => f.frase),
      ).toEqual(
        expect.arrayContaining([`Podem entrar cães no ${palavra}?`, ...ditas]),
      );

      const outra = await ctx
        .http()
        .post(url(`sem-resposta/${psr}/responder`))
        .set(chefe)
        .send({ texto_voz: 'Outra.' })
        .expect(409);
      expect(outra.body.erro.codigo).toBe('pergunta_ja_tem_resposta');

      // Ainda não está no ar: a pergunta continua aberta.
      expect(
        (
          await linha(
            ctx.db,
            'SELECT estado FROM perguntas_sem_resposta WHERE id = $1',
            [psr],
          )
        ).estado,
      ).toBe('nova');

      const respostaId = r.body.resposta.id;
      await publicar(chefe, respostaId, {
        versao_id: r.body.resposta.versoes[0].id,
      }).expect(estado(200));
      expect(
        (
          await linha(
            ctx.db,
            'SELECT estado FROM perguntas_sem_resposta WHERE id = $1',
            [psr],
          )
        ).estado,
      ).toBe('resolvida');
      expect((await auditoria(ctx, psr)).map((a) => a.acao)).toEqual([
        'responder',
        'resolver',
      ]);
    });

    it('pergunta inexistente → 404; com a edição desligada → 403', async () => {
      await ctx
        .http()
        .post(url(`sem-resposta/${randomUUID()}/responder`))
        .set(chefe)
        .send({ texto_voz: 'Resposta.' })
        .expect(404);
      await ctx
        .http()
        .patch(url('definicoes'))
        .set(interno)
        .send({ camara_edita_respostas: false })
        .expect(200);
      const r = await ctx
        .http()
        .post(url(`sem-resposta/${randomUUID()}/responder`))
        .set(chefe)
        .send({ texto_voz: 'Resposta.' })
        .expect(403);
      expect(r.body.erro.codigo).toBe('so_equipa_interna');
    });
  });

  /* ---------------------------------------------------------------- */
  /* Modelos de resposta                                               */
  /* ---------------------------------------------------------------- */

  describe('modelos de resposta', () => {
    const m = (s = '') => `/v1/painel/modelos${s}`;

    it('o técnico lê, só o chefe de divisão escreve; variáveis documentadas', async () => {
      await ctx.http().get(m()).set(tecnico).expect(200);
      await ctx.http().get(m()).set(atendimento).expect(403);
      await ctx
        .http()
        .post(m())
        .set(tecnico)
        .send({ canal: 'sms', nome: 'Aviso', corpo: 'Olá {nome}.' })
        .expect(403);
      const v = await ctx.http().get(m('/variaveis')).set(tecnico).expect(200);
      expect(v.body.itens.map((i: { marcador: string }) => i.marcador)).toEqual(
        [
          '{nome}',
          '{numero_processo}',
          '{tipo_processo}',
          '{morada}',
          '{prazo}',
          '{documentos_em_falta}',
          '{link}',
          '{data}',
          '{municipio}',
        ],
      );
    });

    it('variáveis validadas; rascunho → a_rever → aprovado; editar um aprovado cria versão nova', async () => {
      const nome = `Pedido de elementos ${palavraUnica()}`;
      const mau = await ctx
        .http()
        .post(m())
        .set(chefe)
        .send({ canal: 'oficio', nome, corpo: 'Exmo. Sr. {nome}, NIF {nif}.' })
        .expect(400);
      expect(mau.body.erro).toMatchObject({
        codigo: 'variaveis_invalidas',
        detalhes: { desconhecidas: ['{nif}'] },
      });

      const corpo1 =
        'Exmo(a). Sr(a). {nome},\nNo processo {numero_processo} faltam: {documentos_em_falta}. Entregue até {prazo}.';
      const c = await ctx
        .http()
        .post(m())
        .set(chefe)
        .send({ canal: 'oficio', nome, corpo: corpo1 })
        .expect(estado(201));
      const id1 = c.body.id;
      expect(c.body).toMatchObject({
        canal: 'oficio',
        estado: 'rascunho',
        versao: 1,
        familia_id: id1,
        variaveis: ['nome', 'numero_processo', 'documentos_em_falta', 'prazo'],
        sms: null,
        transicoes: ['a_rever'],
      });

      const salto = await ctx
        .http()
        .patch(m(`/${id1}`))
        .set(chefe)
        .send({ estado: 'aprovado' })
        .expect(409);
      expect(salto.body.erro).toMatchObject({
        codigo: 'transicao_invalida',
        detalhes: { de: 'rascunho', para: 'aprovado' },
      });
      await ctx
        .http()
        .patch(m(`/${id1}`))
        .set(chefe)
        .send({ estado: 'a_rever' })
        .expect(200);
      const ap = await ctx
        .http()
        .patch(m(`/${id1}`))
        .set(chefe)
        .send({ estado: 'aprovado' })
        .expect(estado(200));
      expect(ap.body).toMatchObject({
        estado: 'aprovado',
        aprovado_por: chefeId,
        aprovado_em: expect.any(String),
        nova_versao: false,
      });

      // Editar o aprovado: versão 2 em rascunho; a 1 continua aprovada.
      const e = await ctx
        .http()
        .patch(m(`/${id1}`))
        .set(chefe)
        .send({ corpo: `${corpo1}\nCom os melhores cumprimentos.` })
        .expect(estado(200));
      const id2 = e.body.id;
      expect(id2).not.toBe(id1);
      expect(e.body).toMatchObject({
        nova_versao: true,
        versao: 2,
        estado: 'rascunho',
        familia_id: id1,
      });
      expect(
        (
          await linha(
            ctx.db,
            'SELECT estado FROM modelos_resposta WHERE id = $1',
            [id1],
          )
        ).estado,
      ).toBe('aprovado');

      const dupla = await ctx
        .http()
        .patch(m(`/${id1}`))
        .set(chefe)
        .send({ nome: `${nome} (outra)` })
        .expect(409);
      expect(dupla.body.erro).toMatchObject({
        codigo: 'modelo_tem_versao_em_curso',
        detalhes: { modelo_id: id2 },
      });

      await ctx
        .http()
        .patch(m(`/${id2}`))
        .set(chefe)
        .send({ estado: 'a_rever' })
        .expect(200);
      const ap2 = await ctx
        .http()
        .patch(m(`/${id2}`))
        .set(chefe)
        .send({ estado: 'aprovado' })
        .expect(200);
      expect(
        ap2.body.versoes.map((v: { versao: number; estado: string }) => [
          v.versao,
          v.estado,
        ]),
      ).toEqual([
        [2, 'aprovado'],
        [1, 'substituido'],
      ]);

      const velho = await ctx
        .http()
        .patch(m(`/${id1}`))
        .set(chefe)
        .send({ corpo: 'Outro {nome}.' })
        .expect(409);
      expect(velho.body.erro.codigo).toBe('modelo_substituido');

      const lista = await ctx
        .http()
        .get(m(`?q=${encodeURIComponent(nome)}`))
        .set(tecnico)
        .expect(200);
      expect(lista.body.itens.map((i: { id: string }) => i.id)).toEqual([id2]);
      const subst = await ctx
        .http()
        .get(m(`?estado=substituido&q=${encodeURIComponent(nome)}`))
        .set(tecnico)
        .expect(200);
      expect(subst.body.itens.map((i: { id: string }) => i.id)).toEqual([id1]);

      expect((await auditoria(ctx, id2)).map((a) => a.acao)).toEqual([
        'nova_versao',
        'atualizar',
        'aprovar',
      ]);
    });

    it('SMS: caracteres e partes; pré-visualizar com os dados reais do processo', async () => {
      const municipe = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Maria Teste') RETURNING id`,
        [MUNICIPIO_ID, novoTelefone()],
      );
      const numero = `CP ${randomInt(100000, 999999)}/2026`;
      const processo = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada, prazo_fim)
         VALUES ($1, $2, $3, $4, 'Porta na cozinha', 'Rua do Teste, 1', '2026-11-30') RETURNING id`,
        [MUNICIPIO_ID, numero, TIPO_CP_ID, municipe!.id],
      );
      const codigo = Array.from(
        { length: 6 },
        () => 'ABCDEFGHJKMNPQRSTUVWXYZ'[randomInt(23)],
      ).join('');
      await ctx.db.query(
        `INSERT INTO links_curtos (codigo, municipio_id, destino_tipo, destino_id, expira_em)
         VALUES ($1, $2, 'processo', $3, now() + interval '1 year')`,
        [codigo, MUNICIPIO_ID, processo!.id],
      );

      const longo = await ctx
        .http()
        .post(m())
        .set(chefe)
        .send({ canal: 'sms', nome: 'Longo demais', corpo: 'x'.repeat(641) })
        .expect(400);
      expect(longo.body.erro.codigo).toBe('sms_demasiado_longo');

      const s = await ctx
        .http()
        .post(m())
        .set(chefe)
        .send({
          canal: 'sms',
          nome: `Aviso de elementos ${palavraUnica()}`,
          corpo:
            '{municipio}: o processo {numero_processo} precisa de {documentos_em_falta} ate {prazo}. Veja {link}',
        })
        .expect(estado(201));
      expect(s.body.sms).toEqual({
        codificacao: 'gsm7',
        caracteres: expect.any(Number),
        segmentos: 1,
      });

      const pv = await ctx
        .http()
        .post(m(`/${s.body.id}/pre-visualizar`))
        .set(tecnico)
        .send({ processo_id: processo!.id })
        .expect(estado(200));
      const texto = `Teste: o processo ${numero} precisa de Certidão do registo predial e Termo de responsabilidade ate 30/11/2026. Veja ${WEB_URL}/r/${codigo}`;
      expect(pv.body).toEqual({
        modelo_id: s.body.id,
        processo_id: processo!.id,
        canal: 'sms',
        estado: 'rascunho',
        texto,
        valores: {
          municipio: 'Teste',
          numero_processo: numero,
          documentos_em_falta:
            'Certidão do registo predial e Termo de responsabilidade',
          prazo: '30/11/2026',
          link: `${WEB_URL}/r/${codigo}`,
        },
        em_falta: [],
        // "ã" passa a mensagem a UCS-2.
        sms: {
          codificacao: 'ucs2',
          caracteres: texto.length,
          segmentos: Math.ceil(texto.length / 67),
        },
      });

      const o = await ctx
        .http()
        .post(m())
        .set(chefe)
        .send({
          canal: 'oficio',
          nome: `Ofício de decisão ${palavraUnica()}`,
          corpo:
            '{municipio}, {data}\n{nome}\n{morada}\nAssunto: {tipo_processo} ({numero_processo})',
        })
        .expect(201);
      const po = await ctx
        .http()
        .post(m(`/${o.body.id}/pre-visualizar`))
        .set(chefe)
        .send({ processo_id: processo!.id })
        .expect(200);
      expect(po.body.texto).toMatch(
        new RegExp(
          `^Teste, \\d{1,2} de [a-zç]+ de \\d{4}\\nMaria Teste\\nRua do Teste, 1\\nAssunto: Comunicação prévia · obras de alteração \\(${numero.replace('/', '\\/')}\\)$`,
        ),
      );
      expect(po.body.sms).toBeNull();

      await ctx
        .http()
        .post(m(`/${o.body.id}/pre-visualizar`))
        .set(chefe)
        .send({ processo_id: randomUUID() })
        .expect(404);
    });
  });
});
