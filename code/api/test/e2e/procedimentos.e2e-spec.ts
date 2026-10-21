/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import {
  arrancarApp,
  CHEFE_ID,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
} from './app';

/**
 * Procedimentos internos (a memória da câmara): CRUD com versões e
 * permissões, a entrevista de quem se vai reformar sem IA (guião fixo →
 * rascunho montado das respostas), o assistente interno sem IA (com as
 * fontes citadas) e as perguntas sem resposta (procedimentos em falta).
 */
describe('Procedimentos internos (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let atendimento: Record<string, string>;
  let atendimentoId: string;
  let vereador: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    atendimentoId = await criarUtilizador(ctx, 'atendimento');
    atendimento = await entrarPainel(ctx, atendimentoId);
    vereador = await entrarPainel(ctx, await criarUtilizador(ctx, 'vereador'));
  });
  afterAll(() => ctx.fechar());

  const base = '/v1/painel/procedimentos';
  const conteudo = {
    titulo: 'Como tratar um pedido de cartão de residente',
    area: 'Estacionamento',
    resumo: 'Cartão para moradores estacionarem na zona do centro histórico.',
    passos: [
      'Pedir o comprovativo de morada',
      'Confirmar a matrícula no IMT',
      'Emitir o cartão',
    ],
    onde_esta: [
      { o_que: 'Minuta do cartão', onde: 'Pasta Mobilidade/Cartões' },
    ],
    contactos: [
      { nome: 'Sr. Almeida', papel: 'Mobilidade', contacto: 'ext. 310' },
    ],
    excecoes: ['Carro em leasing: aceitar a declaração da empresa'],
    erros_comuns: ['Esquecer a data de validade'],
    notas: '',
  };

  describe('CRUD, versões e permissões', () => {
    let id: string;

    it('chefe cria um rascunho (versão 1, com auditoria)', async () => {
      const r = await ctx
        .http()
        .post(base)
        .set(chefe)
        .send(conteudo)
        .expect(201);
      expect(r.body).toMatchObject({ estado: 'rascunho', versao: 1 });
      id = r.body.id;
      const a = await linha(
        ctx.db,
        `SELECT acao FROM audit_log WHERE objeto_tipo = 'procedimento' AND objeto_id = $1`,
        [id],
      );
      expect(a).toEqual({ acao: 'criar' });
    });

    it('valida o conteúdo (400)', async () => {
      await ctx.http().post(base).set(chefe).send({ titulo: 'x' }).expect(400);
    });

    it('alterar e publicar: cada gravação é uma versão', async () => {
      await ctx
        .http()
        .put(`${base}/${id}`)
        .set(chefe)
        .send({
          ...conteudo,
          notas: 'Ao sábado não há atendimento.',
          nota: 'acrescentei notas',
        })
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({ versao: 2, estado: 'rascunho' }),
        );
      await ctx
        .http()
        .post(`${base}/${id}/publicar`)
        .set(chefe)
        .expect(200)
        .expect((r) =>
          expect(r.body).toMatchObject({ versao: 3, estado: 'publicado' }),
        );
      await ctx.http().post(`${base}/${id}/publicar`).set(chefe).expect(409);

      const d = await ctx.http().get(`${base}/${id}`).set(chefe).expect(200);
      expect(d.body).toMatchObject({
        titulo: conteudo.titulo,
        estado: 'publicado',
        versao: 3,
        notas: 'Ao sábado não há atendimento.',
        autor_nome: 'Chefe Teste',
        publicado_por_nome: 'Chefe Teste',
      });
      expect(d.body.versoes.map((v: { versao: number }) => v.versao)).toEqual([
        3, 2, 1,
      ]);
      expect(d.body.versoes[1].nota).toBe('acrescentei notas');

      const v1 = await ctx
        .http()
        .get(`${base}/${id}/versoes/1`)
        .set(chefe)
        .expect(200);
      expect(v1.body.conteudo.notas).toBe('');
      await ctx.http().get(`${base}/${id}/versoes/99`).set(chefe).expect(404);
    });

    it('listar por estado e procurar por texto (sem acentos)', async () => {
      const l = await ctx
        .http()
        .get(`${base}?estado=publicado`)
        .set(atendimento)
        .expect(200);
      expect(l.body.itens.map((p: { id: string }) => p.id)).toContain(id);
      expect(l.body.contagens.publicado).toBeGreaterThanOrEqual(1);
      const q = await ctx
        .http()
        .get(`${base}?q=matricula`)
        .set(atendimento)
        .expect(200);
      expect(q.body.itens[0]).toMatchObject({ id, titulo: conteudo.titulo });
      expect(q.body.itens[0].trechos[0].texto).toContain('matrícula');
    });

    it('todos os perfis do painel leem (vereador incluído)', async () => {
      await ctx.http().get(`${base}/${id}`).set(vereador).expect(200);
      await ctx
        .http()
        .get('/v1/painel/assistente/lacunas')
        .set(vereador)
        .expect(200);
    });

    it('atendimento escreve o seu rascunho mas não publica nem altera o que é publicado', async () => {
      const r = await ctx
        .http()
        .post(base)
        .set(atendimento)
        .send({ ...conteudo, titulo: 'Rascunho do atendimento' })
        .expect(201);
      await ctx
        .http()
        .put(`${base}/${r.body.id}`)
        .set(atendimento)
        .send({ ...conteudo, titulo: 'Rascunho do atendimento (v2)' })
        .expect(200);
      const p = await ctx
        .http()
        .post(`${base}/${r.body.id}/publicar`)
        .set(atendimento)
        .expect(403);
      expect(p.body.erro.detalhes).toEqual({ recurso: 'procedimentos' });
      await ctx
        .http()
        .put(`${base}/${id}`)
        .set(atendimento)
        .send(conteudo)
        .expect(403);
      // O rascunho de outra pessoa também não.
      const deChefe = await ctx
        .http()
        .post(base)
        .set(chefe)
        .send(conteudo)
        .expect(201);
      await ctx
        .http()
        .put(`${base}/${deChefe.body.id}`)
        .set(atendimento)
        .send(conteudo)
        .expect(403);
    });

    it('arquivar sai da lista por omissão', async () => {
      const r = await ctx
        .http()
        .post(base)
        .set(chefe)
        .send({ ...conteudo, titulo: 'Para arquivar' })
        .expect(201);
      await ctx
        .http()
        .post(`${base}/${r.body.id}/arquivar`)
        .set(atendimento)
        .expect(403);
      await ctx
        .http()
        .post(`${base}/${r.body.id}/arquivar`)
        .set(chefe)
        .expect(200);
      const l = await ctx.http().get(base).set(chefe).expect(200);
      expect(l.body.itens.map((p: { id: string }) => p.id)).not.toContain(
        r.body.id,
      );
    });

    it('nunca sai para o munícipe: a pesquisa do agente não vê procedimentos', async () => {
      const r = await ferramenta(
        ctx,
        novaChamada('proc'),
        'procurar_conhecimento',
        {
          pergunta: 'cartão de residente matrícula IMT Sr. Almeida',
        },
      ).expect(200);
      expect(JSON.stringify(r.body)).not.toContain('Almeida');
    });
  });

  describe('entrevista de quem se vai reformar (sem IA)', () => {
    let entrevistaId: string;
    let procedimentoId: string;

    const respostas: Record<string, string> = {
      o_que:
        'É a licença para pôr esplanadas, andaimes ou contentores no passeio.',
      passos:
        '1. Receber o pedido no balcão\n2. Confirmar a planta de localização\n3. Pedir parecer à fiscalização\n4. Emitir a guia de pagamento',
      onde: 'Minutas: pasta Obras/Ocupação\nPlantas: SIG interno',
      contactos: 'D. Rosa, Fiscalização, ext. 214',
      excecoes:
        'Quando falta o seguro, pedir por email antes de emitir; Festas da freguesia: isenção pela junta',
      erros: 'Esquecer a caução nos andaimes',
    };

    it('começa pelo guião fixo, uma pergunta de cada vez', async () => {
      const r = await ctx
        .http()
        .post(`${base}/entrevistas`)
        .set(atendimento)
        .send({ area: 'Ocupação da via pública' })
        .expect(201);
      entrevistaId = r.body.id;
      expect(r.body).toMatchObject({
        modo: 'guiao',
        estado: 'em_curso',
        entrevistado_id: atendimentoId,
        pode_concluir: false,
        pergunta_atual: { chave: 'o_que', ordem: 1 },
      });
      expect(r.body.pergunta_atual.pergunta).toContain(
        'Ocupação da via pública',
      );
    });

    it('só o entrevistado (ou a chefia) responde', async () => {
      const outro = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'tecnico'),
      );
      await ctx
        .http()
        .post(`${base}/entrevistas/${entrevistaId}/responder`)
        .set(outro)
        .send({ resposta: 'intromissão' })
        .expect(403);
    });

    it('responde a todas (uma por voz, a última saltada) e acaba o guião', async () => {
      let atual = 'o_que';
      for (let i = 0; i < 7; i++) {
        const corpo =
          atual === 'notas'
            ? { saltar: true }
            : { resposta: respostas[atual], por_voz: atual === 'passos' };
        const r = await ctx
          .http()
          .post(`${base}/entrevistas/${entrevistaId}/responder`)
          .set(atendimento)
          .send(corpo)
          .expect(200);
        expect(r.body.turnos).toHaveLength(Math.min(i + 2, 7));
        if (i < 6) {
          atual = r.body.pergunta_atual.chave;
        } else {
          expect(r.body.pergunta_atual).toBeNull();
          expect(r.body.pode_concluir).toBe(true);
        }
      }
      await ctx
        .http()
        .post(`${base}/entrevistas/${entrevistaId}/responder`)
        .set(atendimento)
        .send({ resposta: 'mais uma' })
        .expect(409);
      const voz = await linha(
        ctx.db,
        `SELECT por_voz FROM entrevista_turnos WHERE entrevista_id = $1 AND chave = 'passos'`,
        [entrevistaId],
      );
      expect(voz).toEqual({ por_voz: true });
    });

    it('concluir escreve o rascunho montado das respostas (autor: o entrevistado)', async () => {
      const r = await ctx
        .http()
        .post(`${base}/entrevistas/${entrevistaId}/concluir`)
        .set(atendimento)
        .expect(200);
      expect(r.body).toMatchObject({
        ia: false,
        motivo_sem_ia: expect.stringContaining('não está configurado'),
      });
      procedimentoId = r.body.procedimento_id;
      const p = await ctx
        .http()
        .get(`${base}/${procedimentoId}`)
        .set(chefe)
        .expect(200);
      expect(p.body).toMatchObject({
        titulo: 'Como tratar: Ocupação da via pública',
        area: 'Ocupação da via pública',
        estado: 'rascunho',
        origem: 'entrevista',
        entrevista_id: entrevistaId,
        autor_id: atendimentoId,
        resumo: respostas.o_que,
        passos: [
          'Receber o pedido no balcão',
          'Confirmar a planta de localização',
          'Pedir parecer à fiscalização',
          'Emitir a guia de pagamento',
        ],
        onde_esta: [
          { o_que: 'Minutas', onde: 'pasta Obras/Ocupação' },
          { o_que: 'Plantas', onde: 'SIG interno' },
        ],
        contactos: [
          { nome: 'D. Rosa', papel: 'Fiscalização', contacto: 'ext. 214' },
        ],
        excecoes: [
          'Quando falta o seguro, pedir por email antes de emitir',
          'Festas da freguesia: isenção pela junta',
        ],
        erros_comuns: ['Esquecer a caução nos andaimes'],
        notas: '',
      });
      const e = await ctx
        .http()
        .get(`${base}/entrevistas/${entrevistaId}`)
        .set(atendimento)
        .expect(200);
      expect(e.body).toMatchObject({
        estado: 'concluida',
        procedimento_id: procedimentoId,
        pergunta_atual: null,
      });
      await ctx
        .http()
        .post(`${base}/entrevistas/${entrevistaId}/concluir`)
        .set(atendimento)
        .expect(409);

      const acoes = await linhas(
        ctx.db,
        `SELECT acao FROM audit_log WHERE objeto_tipo = 'entrevista' AND objeto_id = $1 ORDER BY em`,
        [entrevistaId],
      );
      expect(acoes.map((a) => a.acao)).toEqual([
        'iniciar_entrevista',
        'concluir_entrevista',
      ]);
    });

    it('a chefia revê e publica', async () => {
      await ctx
        .http()
        .post(`${base}/${procedimentoId}/publicar`)
        .set(chefe)
        .expect(200);
    });

    it('concluir sem nenhuma resposta não deixa (409) e cancelar fecha', async () => {
      const r = await ctx
        .http()
        .post(`${base}/entrevistas`)
        .set(atendimento)
        .send({ area: 'Cemitérios' })
        .expect(201);
      await ctx
        .http()
        .post(`${base}/entrevistas/${r.body.id}/concluir`)
        .set(atendimento)
        .expect(409);
      await ctx
        .http()
        .post(`${base}/entrevistas/${r.body.id}/cancelar`)
        .set(atendimento)
        .expect(200);
      const l = await ctx
        .http()
        .get(`${base}/entrevistas`)
        .set(chefe)
        .expect(200);
      expect(l.body.itens.map((x: { id: string }) => x.id)).not.toContain(
        r.body.id,
      );
    });
  });

  describe('assistente interno (sem IA)', () => {
    let lacunaId: string;

    it('responde com os procedimentos e trechos encontrados, citando a fonte', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/assistente/perguntar')
        .set(atendimento)
        .send({
          pergunta:
            'Como trato um pedido de esplanada no passeio quando falta o seguro?',
        })
        .expect(200);
      expect(r.body).toMatchObject({
        modo: 'sem_ia',
        ia: false,
        resposta: null,
        estado: 'respondida',
        motivo_sem_ia: expect.stringContaining('não está configurado'),
        perguntar_a: [],
      });
      const p = r.body.fontes[0];
      expect(p).toMatchObject({
        tipo: 'procedimento',
        etiqueta: 'P1',
        titulo: 'Como tratar: Ocupação da via pública',
        autor_nome: 'Teste atendimento',
        versao: expect.any(Number),
      });
      // Os trechos que tocam na pergunta (o que é, e a exceção do seguro).
      expect(p.trechos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            seccao: 'excecoes',
            nome_seccao: 'Exceções',
            texto: expect.stringContaining('seguro'),
          }),
        ]),
      );
      const g = await linha(
        ctx.db,
        `SELECT estado, modo, fontes FROM assistente_perguntas WHERE id = $1`,
        [r.body.id],
      );
      expect(g).toMatchObject({ estado: 'respondida', modo: 'sem_ia' });
      expect(g.fontes[0]).toMatchObject({
        tipo: 'procedimento',
        etiqueta: 'P1',
      });
    });

    it('junta o conhecimento oficial (a mesma pesquisa do agente)', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/assistente/perguntar')
        .set(atendimento)
        .send({
          pergunta: 'Abrir uma porta na fachada precisa de comunicação prévia?',
        })
        .expect(200);
      const c = r.body.fontes.find(
        (f: { tipo: string }) => f.tipo === 'conhecimento',
      );
      expect(c).toMatchObject({
        etiqueta: expect.stringMatching(/^C\d$/),
        referencia: expect.stringMatching(/art\./),
        url: expect.any(String),
      });
    });

    it('sem resposta: diz a quem perguntar e fica na lista de procedimentos em falta', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/assistente/perguntar')
        .set(atendimento)
        .send({ pergunta: 'zzqx plimplom kkwrt?' })
        .expect(200);
      expect(r.body).toMatchObject({ estado: 'sem_resposta', fontes: [] });
      expect(r.body.perguntar_a).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            utilizador_id: CHEFE_ID,
            motivo: 'chefe de divisão',
          }),
        ]),
      );
      lacunaId = r.body.id;

      const l = await ctx
        .http()
        .get('/v1/painel/assistente/lacunas')
        .set(chefe)
        .expect(200);
      expect(l.body.itens[0]).toMatchObject({
        id: lacunaId,
        pergunta: 'zzqx plimplom kkwrt?',
        perguntou_nome: 'Teste atendimento',
      });
      const h = await ctx
        .http()
        .get('/v1/painel/assistente/historico')
        .set(atendimento)
        .expect(200);
      expect(h.body.itens.length).toBe(3);
    });

    it('sem resposta, mas com um rascunho próximo: sugere o autor', async () => {
      await ctx
        .http()
        .post(base)
        .set(atendimento)
        .send({
          ...conteudo,
          titulo: 'Xilofonia nas festas do concelho',
          area: 'Cultura',
          resumo: 'Ainda por acabar.',
          passos: [],
          onde_esta: [],
          contactos: [],
          excecoes: [],
          erros_comuns: [],
        })
        .expect(201);
      const r = await ctx
        .http()
        .post('/v1/painel/assistente/perguntar')
        .set(chefe)
        .send({ pergunta: 'Quem trata da xilofonia?' })
        .expect(200);
      // O rascunho não serve de resposta, mas quem o escreveu sabe.
      expect(r.body).toMatchObject({ estado: 'sem_resposta', fontes: [] });
      expect(r.body.perguntar_a[0]).toMatchObject({
        utilizador_id: atendimentoId,
        motivo: 'escreveu "Xilofonia nas festas do concelho"',
      });
    });

    it('escrever o procedimento em falta: rascunho novo e a lacuna sai da lista', async () => {
      const r = await ctx
        .http()
        .post(`/v1/painel/assistente/lacunas/${lacunaId}/escrever`)
        .set(atendimento)
        .expect(201);
      const p = await linha(
        ctx.db,
        `SELECT titulo, origem, estado, autor_id FROM procedimentos WHERE id = $1`,
        [r.body.procedimento_id],
      );
      expect(p).toEqual({
        titulo: 'zzqx plimplom kkwrt?',
        origem: 'lacuna',
        estado: 'rascunho',
        autor_id: atendimentoId,
      });
      const l = await ctx
        .http()
        .get('/v1/painel/assistente/lacunas')
        .set(chefe)
        .expect(200);
      expect(l.body.itens.map((x: { id: string }) => x.id)).not.toContain(
        lacunaId,
      );
      const t = await ctx
        .http()
        .get('/v1/painel/assistente/lacunas?tratadas=1')
        .set(chefe)
        .expect(200);
      expect(
        t.body.itens.find((x: { id: string }) => x.id === lacunaId),
      ).toMatchObject({
        estado: 'tratada',
        procedimento_id: r.body.procedimento_id,
      });
      await ctx
        .http()
        .post(`/v1/painel/assistente/lacunas/${lacunaId}/escrever`)
        .set(atendimento)
        .expect(409);
    });

    it('marcar como tratada é da chefia', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/assistente/perguntar')
        .set(atendimento)
        .send({ pergunta: 'qwxz brrumbum?' })
        .expect(200);
      await ctx
        .http()
        .post(`/v1/painel/assistente/lacunas/${r.body.id}/tratar`)
        .set(atendimento)
        .send({})
        .expect(403);
      await ctx
        .http()
        .post(`/v1/painel/assistente/lacunas/${r.body.id}/tratar`)
        .set(chefe)
        .send({})
        .expect(200);
      const a = await linha(
        ctx.db,
        `SELECT acao, municipio_id FROM audit_log WHERE objeto_tipo = 'assistente_pergunta' AND objeto_id = $1`,
        [r.body.id],
      );
      expect(a).toEqual({ acao: 'tratar_lacuna', municipio_id: MUNICIPIO_ID });
    });
  });
});
