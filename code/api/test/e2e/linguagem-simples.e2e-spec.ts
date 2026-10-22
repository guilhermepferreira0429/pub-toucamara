/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { ClaudeService } from '../../src/ia/claude.service';
import {
  arrancarApp,
  CHEFE_ID,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO,
  MUNICIPIO_ID,
  novaChamada,
} from './app';
import { WEB_URL } from './ambiente';

/**
 * IA falsa: desligada por defeito (como nos outros e2e, sem chave); ligada
 * só para gerar. Devolve partes a partir das secções que recebe, com uma
 * secção inventada (s99) que tem de ser deitada fora.
 */
class IaFalsa {
  ligada = false;
  pedidos = 0;
  get disponivel() {
    return this.ligada;
  }
  extrair(_esquema: unknown, pedido: { conteudo: string }) {
    this.pedidos++;
    const c = JSON.parse(pedido.conteudo) as {
      titulo: string;
      seccoes: { id: string; referencia: string | null; texto: string }[];
    };
    const art = (n: number) =>
      c.seccoes.find((s) => s.referencia === `art. ${n}.º`)!.id;
    return Promise.resolve({
      titulo: `${c.titulo}: o que precisa de saber`,
      resumo:
        'Diz como pode pôr uma esplanada na rua e quanto paga. Faz uma comunicação prévia.',
      partes: [
        {
          chave: 'quanto_custa',
          titulo: 'Quanto custa',
          texto: 'Paga uma taxa por metro quadrado, por mês.',
          seccoes: [art(3)],
        },
        {
          chave: 'o_que_tem_de_fazer',
          titulo: 'O que tem de fazer',
          texto:
            'Faz uma comunicação prévia no Balcão do Empreendedor, 20 dias úteis antes.',
          seccoes: [art(2), 's99'],
        },
        {
          chave: 'outro',
          titulo: 'Inventado',
          texto: 'Isto não vem do regulamento.',
          seccoes: ['s99'],
        },
      ],
    });
  }
  escrever() {
    return Promise.reject(new Error('IA falsa: escrever não usado aqui'));
  }
}

describe('Linguagem simples e glossário (e2e)', () => {
  let ctx: Contexto;
  const ia = new IaFalsa();
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  const palavra = `quiosque${randomUUID()
    .replace(/[^a-f]/g, '')
    .slice(0, 8)}`;
  let fonteId: string;
  let docId: string;
  let codigo: string;

  const regulamento = (euros: number) =>
    [
      `Regulamento das esplanadas e ${palavra}`,
      'Artigo 1.º Objeto',
      `Este regulamento fixa as regras das esplanadas e dos ${palavra} na via pública.`,
      'Artigo 2.º Comunicação',
      '1 - A instalação está sujeita a comunicação prévia no Balcão do Empreendedor.',
      '2 - A comunicação é feita com 20 dias úteis de antecedência.',
      'Artigo 3.º Taxas',
      `A ocupação paga ${euros} euros por metro quadrado e por mês.`,
    ].join('\n');

  const colar = (texto: string) =>
    ctx
      .http()
      .post(`/v1/painel/conhecimento/fontes/${fonteId}/texto`)
      .set(chefe)
      .send({ texto })
      .expect(200);

  const ver = async () =>
    (
      await ctx
        .http()
        .get(`/v1/painel/linguagem-simples/${docId}`)
        .set(chefe)
        .expect(200)
    ).body;

  const gerarComIa = async () => {
    ia.ligada = true;
    try {
      return await ctx
        .http()
        .post(`/v1/painel/linguagem-simples/${docId}/gerar`)
        .set(chefe)
        .send({});
    } finally {
      ia.ligada = false;
    }
  };

  const publicar = (versao: string, corpo: object = { confirmo: true }) =>
    ctx
      .http()
      .post(`/v1/painel/linguagem-simples/${docId}/versoes/${versao}/publicar`)
      .set(chefe)
      .send(corpo);

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) => b.overrideProvider(ClaudeService).useValue(ia),
    });
    chefe = await entrarPainel(ctx);
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
    const e = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO entidades (id, municipio_id, nome, tipo) VALUES ($1, $2, 'Câmara (simples)', 'camara') RETURNING id`,
      [randomUUID(), MUNICIPIO_ID],
    );
    const f = await ctx
      .http()
      .post('/v1/painel/conhecimento/fontes')
      .set(chefe)
      .send({
        entidade_id: e!.id,
        titulo: `Regulamento de ${palavra}`,
        tipo: 'regulamento',
        url: `https://exemplo.pt/${palavra}.pdf`,
        leitura_automatica: false,
      });
    if (f.status !== 201) throw new Error(JSON.stringify(f.body));
    fonteId = f.body.id;
    await colar(regulamento(5));
  });
  afterAll(() => ctx.fechar());

  describe('glossário', () => {
    it('termos de demonstração, CRUD com auditoria e permissões', async () => {
      await ctx
        .http()
        .post('/v1/painel/glossario/demonstracao')
        .set(tecnico)
        .expect(403);
      const demo = await ctx
        .http()
        .post('/v1/painel/glossario/demonstracao')
        .set(chefe)
        .expect(201);
      expect(demo.body.demonstracao).toBe(true);
      const tacito = demo.body.itens.find(
        (t: { termo: string }) => t.termo === 'deferimento tácito',
      );
      expect(tacito).toMatchObject({ demonstracao: true, ativo: true });

      // Quem só vê o conhecimento lê, mas não escreve.
      await ctx.http().get('/v1/painel/glossario').set(tecnico).expect(200);
      await ctx
        .http()
        .post('/v1/painel/glossario')
        .set(tecnico)
        .send({ termo: `x${palavra}`, explicacao: 'Uma explicação qualquer.' })
        .expect(403);

      const novo = await ctx
        .http()
        .post('/v1/painel/glossario')
        .set(chefe)
        .send({
          termo: `taxa de ${palavra}`,
          variantes: [`taxas de ${palavra}`, `taxa de ${palavra}`],
          explicacao: 'O valor que paga à câmara por ter um quiosque na rua.',
        })
        .expect(201);
      expect(novo.body).toMatchObject({
        demonstracao: false,
        variantes: [`taxas de ${palavra}`],
      });
      await ctx
        .http()
        .post('/v1/painel/glossario')
        .set(chefe)
        .send({
          termo: `Taxa de ${palavra.toUpperCase()}`,
          explicacao: 'Repetido, com maiúsculas.',
        })
        .expect(409);

      // A câmara revê um termo de demonstração: deixa de o ser.
      const revisto = await ctx
        .http()
        .put(`/v1/painel/glossario/${tacito.id}`)
        .set(chefe)
        .send({ demonstracao: false })
        .expect(200);
      expect(revisto.body).toMatchObject({
        demonstracao: false,
        explicacao: tacito.explicacao,
      });
      await ctx
        .http()
        .put(`/v1/painel/glossario/${tacito.id}`)
        .set(chefe)
        .send({ demonstracao: true })
        .expect(200);

      await ctx
        .http()
        .delete(`/v1/painel/glossario/${novo.body.id}`)
        .set(tecnico)
        .expect(403);
      await ctx
        .http()
        .delete(`/v1/painel/glossario/${novo.body.id}`)
        .set(chefe)
        .expect(200);
      await ctx
        .http()
        .delete(`/v1/painel/glossario/${novo.body.id}`)
        .set(chefe)
        .expect(404);

      const acoes = await linhas<{ acao: string }>(
        ctx.db,
        `SELECT acao FROM audit_log WHERE objeto_id = $1 AND ator_id = $2 ORDER BY em`,
        [novo.body.id, CHEFE_ID],
      );
      expect(acoes.map((a) => a.acao)).toEqual([
        'criar_termo_glossario',
        'apagar_termo_glossario',
      ]);

      const publico = await ctx
        .http()
        .get(`/v1/public/glossario?municipio=${MUNICIPIO}`)
        .expect(200);
      expect(publico.body.demonstracao).toBe(true);
      expect(
        publico.body.itens.some(
          (t: { termo: string }) => t.termo === 'audiência prévia',
        ),
      ).toBe(true);
    });

    it('o agente explica um termo (explicar_termo)', async () => {
      const r = await ferramenta(ctx, novaChamada(), 'explicar_termo', {
        termo: 'O que é o deferimento tácito?',
      }).expect(200);
      expect(r.body).toMatchObject({
        encontrado: true,
        termo: 'deferimento tácito',
        valores_de_demonstracao: true,
      });
      expect(r.body.dizer).toContain('deferimento tácito');

      const nada = await ferramenta(ctx, novaChamada(), 'explicar_termo', {
        termo: 'o que é um zarolho de pastéis',
      }).expect(200);
      expect(nada.body.encontrado).toBe(false);
    });
  });

  describe('versão simples de um regulamento', () => {
    it('cria o documento preso à fonte; sem IA, gerar diz que precisa dela', async () => {
      await ctx
        .http()
        .post('/v1/painel/linguagem-simples')
        .set(tecnico)
        .send({ fonte_id: fonteId, tipo: 'regulamento' })
        .expect(403);
      const r = await ctx
        .http()
        .post('/v1/painel/linguagem-simples')
        .set(chefe)
        .send({ fonte_id: fonteId, tipo: 'regulamento' })
        .expect(201);
      docId = r.body.id;
      codigo = r.body.codigo;
      expect(r.body).toMatchObject({
        estado: 'sem_versao',
        ia_disponivel: false,
        link: null,
        rascunho: null,
      });
      const original = r.body.originais[r.body.versao_atual_id];
      expect(
        original.seccoes.map((s: { referencia: string }) => s.referencia),
      ).toEqual([null, 'art. 1.º', 'art. 2.º', 'art. 3.º']);
      expect(original.seccoes[2].trechos.length).toBeGreaterThan(0);

      // Outra vez a mesma fonte: o mesmo documento.
      const outra = await ctx
        .http()
        .post('/v1/painel/linguagem-simples')
        .set(chefe)
        .send({ fonte_id: fonteId, tipo: 'regulamento' })
        .expect(201);
      expect(outra.body.id).toBe(docId);

      const lista = await ctx
        .http()
        .get('/v1/painel/linguagem-simples')
        .set(tecnico)
        .expect(200);
      expect(
        lista.body.itens.find(
          (i: { fonte_id: string }) => i.fonte_id === fonteId,
        ),
      ).toMatchObject({ documento_id: docId, estado: 'sem_versao' });

      const semIa = await ctx
        .http()
        .post(`/v1/painel/linguagem-simples/${docId}/gerar`)
        .set(chefe)
        .send({})
        .expect(503);
      expect(semIa.body.erro.codigo).toBe('ia_indisponivel');
    });

    it('excertos sem IA: marcados e não se publicam sem os reescrever', async () => {
      const r = await ctx
        .http()
        .post(`/v1/painel/linguagem-simples/${docId}/gerar`)
        .set(chefe)
        .send({ modo: 'extrativo' })
        .expect(200);
      expect(r.body.rascunho).toMatchObject({
        origem: 'extrativo',
        estado: 'rascunho',
        editada_em: null,
      });
      expect(r.body.rascunho.partes).toHaveLength(4);
      const p = await publicar(r.body.rascunho.id).expect(422);
      expect(p.body.erro.codigo).toBe('extrativo_por_rever');
      // Nada é público antes da revisão.
      await ctx.http().get(`/v1/public/documentos/${codigo}`).expect(404);
    });

    it('gerar com IA: partes ligadas aos artigos e trechos; o que não tem origem sai', async () => {
      const r = await gerarComIa();
      expect(r.status).toBe(200);
      expect(ia.pedidos).toBe(1);
      const ras = r.body.rascunho;
      expect(ras).toMatchObject({
        origem: 'ia',
        numero: 2,
        fonte_versao_id: r.body.versao_atual_id,
        desatualizada: false,
      });
      // Por ordem das perguntas; a parte inventada (s99) saiu.
      expect(ras.partes.map((p: { chave: string }) => p.chave)).toEqual([
        'o_que_tem_de_fazer',
        'quanto_custa',
      ]);
      const seccoes = r.body.originais[ras.fonte_versao_id].seccoes;
      const art2 = seccoes.find(
        (s: { referencia: string }) => s.referencia === 'art. 2.º',
      );
      expect(ras.partes[0].seccoes).toEqual([art2.id]);
      expect(ras.partes[0].trechos).toEqual(art2.trechos);
      // Gerar de novo descartou o rascunho de excertos.
      expect(r.body.historico.map((h: { estado: string }) => h.estado)).toEqual(
        ['rascunho', 'descartada'],
      );
    });

    it('editar o rascunho, rever e publicar (com auditoria); página pública com os dois textos', async () => {
      const antes = await ver();
      const ras = antes.rascunho;
      await publicar(ras.id, {}).expect(400);
      await ctx
        .http()
        .post(
          `/v1/painel/linguagem-simples/${docId}/versoes/${ras.id}/publicar`,
        )
        .set(tecnico)
        .send({ confirmo: true })
        .expect(403);

      const partes = ras.partes.map(
        (p: {
          chave: string;
          titulo: string;
          texto: string;
          seccoes: string[];
        }) => ({
          chave: p.chave,
          titulo: p.titulo,
          texto: p.texto,
          seccoes: p.seccoes,
        }),
      );
      const invalida = await ctx
        .http()
        .put(`/v1/painel/linguagem-simples/${docId}/rascunho`)
        .set(chefe)
        .send({
          titulo: ras.titulo,
          resumo: ras.resumo,
          partes: [{ ...partes[0], seccoes: ['s77'] }],
        })
        .expect(400);
      expect(invalida.body.erro.codigo).toBe('seccao_invalida');

      partes[1].texto = 'Paga 5 euros por metro quadrado, por mês.';
      const gravado = await ctx
        .http()
        .put(`/v1/painel/linguagem-simples/${docId}/rascunho`)
        .set(chefe)
        .send({ titulo: ras.titulo, resumo: ras.resumo, partes })
        .expect(200);
      expect(gravado.body.rascunho.id).toBe(ras.id);
      expect(gravado.body.rascunho.partes[1].texto).toContain('5 euros');

      const pub = await publicar(ras.id).expect(200);
      expect(pub.body).toMatchObject({
        estado: 'publicada',
        rascunho: null,
        link: `${WEB_URL}/documento/${codigo}`,
      });
      expect(pub.body.publicada).toMatchObject({
        id: ras.id,
        revista_por_nome: expect.any(String),
        desatualizada: false,
      });
      const acoes = await linhas<{ acao: string; ator_id: string }>(
        ctx.db,
        `SELECT acao, ator_id FROM audit_log WHERE objeto_id = $1 ORDER BY em`,
        [docId],
      );
      expect(acoes.map((a) => a.acao)).toEqual([
        'criar_documento_simples',
        'gerar_versao_simples',
        'gerar_versao_simples',
        'editar_versao_simples',
        'publicar_versao_simples',
      ]);
      expect(acoes.every((a) => a.ator_id === CHEFE_ID)).toBe(true);

      const p = await ctx
        .http()
        .get(`/v1/public/documentos/${codigo}`)
        .expect(200);
      expect(p.body).toMatchObject({
        codigo,
        tipo: 'regulamento',
        fonte: { url: `https://exemplo.pt/${palavra}.pdf` },
        aviso_legal:
          'Este resumo ajuda a perceber; o que vale legalmente é o texto oficial.',
        simples: { revista: true, desatualizada: false, origem: 'ia' },
      });
      expect(p.body.simples.partes).toHaveLength(2);
      expect(p.body.original.vigor_desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // O texto oficial completo, por artigos.
      const completo = p.body.original.seccoes
        .map((s: { texto: string }) => s.texto)
        .join('\n');
      expect(completo).toContain('20 dias úteis de antecedência');
      expect(completo).toContain('5 euros por metro quadrado');
      // A frase simples aponta para o artigo do original.
      const ids = p.body.original.seccoes.map((s: { id: string }) => s.id);
      expect(ids).toEqual(
        expect.arrayContaining(p.body.simples.partes[0].seccoes),
      );
      // Glossário: "comunicação prévia" sublinhada na versão simples e no original.
      const termo = p.body.glossario.find(
        (t: { termo: string }) => t.termo === 'comunicação prévia',
      );
      expect(termo).toMatchObject({ demonstracao: true });
      const parte = p.body.simples.partes[0];
      const marca = parte.termos.find(
        (m: { termo_id: string }) => m.termo_id === termo.id,
      );
      expect(parte.texto.slice(marca.inicio, marca.fim)).toBe(
        'comunicação prévia',
      );
      expect(
        p.body.original.seccoes.some((s: { termos: { termo_id: string }[] }) =>
          s.termos.some((m) => m.termo_id === termo.id),
        ),
      ).toBe(true);

      const lista = await ctx
        .http()
        .get(`/v1/public/documentos?municipio=${MUNICIPIO}`)
        .expect(200);
      expect(
        lista.body.itens.find((i: { codigo: string }) => i.codigo === codigo),
      ).toMatchObject({ desatualizada: false });
    });

    it('o agente manda o link da versão simples (documento_simples e procurar_conhecimento)', async () => {
      const d = await ferramenta(ctx, novaChamada(), 'documento_simples', {
        pesquisa: `regulamento dos ${palavra}`,
      }).expect(200);
      expect(d.body.encontrado).toBe(true);
      // Os documentos da demo (BD partilhada) podem vir também.
      expect(d.body.documentos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            link: `${WEB_URL}/documento/${codigo}`,
            url_oficial: `https://exemplo.pt/${palavra}.pdf`,
          }),
        ]),
      );
      expect(d.body.dizer).toContain('o que vale legalmente é o texto oficial');

      const k = await ferramenta(ctx, novaChamada(), 'procurar_conhecimento', {
        pergunta: `Quanto custa a taxa dos ${palavra}?`,
      }).expect(200);
      expect(k.body.sem_fonte).toBe(false);
      // A demo (BD partilhada) pode ter publicado outro regulamento.
      expect(k.body.documentos_simples).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ link: `${WEB_URL}/documento/${codigo}` }),
        ]),
      );
    });

    it('a fonte muda: a versão simples fica desatualizada e o rascunho antigo não se publica', async () => {
      // Um rascunho novo (à mão) ainda sobre o texto de hoje.
      const atual = await ver();
      const partes = atual.publicada.partes.map(
        (p: {
          chave: string;
          titulo: string;
          texto: string;
          seccoes: string[];
        }) => ({
          chave: p.chave,
          titulo: p.titulo,
          texto: p.texto,
          seccoes: p.seccoes,
        }),
      );
      const ras = (
        await ctx
          .http()
          .put(`/v1/painel/linguagem-simples/${docId}/rascunho`)
          .set(chefe)
          .send({ titulo: 'Quiosques: o essencial', resumo: 'Resumo.', partes })
          .expect(200)
      ).body.rascunho;
      expect(ras).toMatchObject({ origem: 'manual', numero: 3 });

      await colar(regulamento(9));

      const depois = await ver();
      expect(depois.estado).toBe('desatualizada');
      expect(depois.publicada.desatualizada).toBe(true);
      expect(depois.rascunho.desatualizada).toBe(true);
      const lista = await ctx
        .http()
        .get('/v1/painel/linguagem-simples')
        .set(chefe)
        .expect(200);
      expect(
        lista.body.itens.find(
          (i: { fonte_id: string }) => i.fonte_id === fonteId,
        ).estado,
      ).toBe('desatualizada');

      const recusa = await publicar(ras.id).expect(409);
      expect(recusa.body.erro.codigo).toBe('rascunho_desatualizado');

      // Na página: aviso e o texto oficial que vale agora.
      const p = await ctx
        .http()
        .get(`/v1/public/documentos/${codigo}`)
        .expect(200);
      expect(p.body.simples.desatualizada).toBe(true);
      expect(p.body.original.versao_id).toBe(depois.versao_atual_id);
      expect(
        p.body.original.seccoes
          .map((s: { texto: string }) => s.texto)
          .join('\n'),
      ).toContain('9 euros');
      expect(
        p.body.simples.partes.every(
          (x: { seccoes: string[] }) => !x.seccoes.length,
        ),
      ).toBe(true);

      // O agente já não manda o resumo antigo.
      const d = await ferramenta(ctx, novaChamada(), 'documento_simples', {
        pesquisa: `regulamento dos ${palavra}`,
      }).expect(200);
      // (Outro documento da BD partilhada, ex.: o da demo, pode aparecer;
      // o nosso não.)
      expect(JSON.stringify(d.body)).not.toContain(`/documento/${codigo}`);
      const k = await ferramenta(ctx, novaChamada(), 'procurar_conhecimento', {
        pergunta: `Quanto custa a taxa dos ${palavra}?`,
      }).expect(200);
      expect(JSON.stringify(k.body.documentos_simples ?? [])).not.toContain(
        `/documento/${codigo}`,
      );

      // Gerar de novo sobre o texto novo e publicar: volta a estar em dia.
      const g = await gerarComIa();
      expect(g.status).toBe(200);
      expect(g.body.rascunho.fonte_versao_id).toBe(depois.versao_atual_id);
      const pub = await publicar(g.body.rascunho.id).expect(200);
      expect(pub.body.estado).toBe('publicada');
      expect(
        pub.body.historico.find(
          (h: { id: string }) => h.id === atual.publicada.id,
        ).estado,
      ).toBe('substituida');
    });

    it('tirar do ar: a página deixa de abrir', async () => {
      await ctx
        .http()
        .post(`/v1/painel/linguagem-simples/${docId}/retirar`)
        .set(chefe)
        .expect(200);
      await ctx.http().get(`/v1/public/documentos/${codigo}`).expect(404);
      await ctx
        .http()
        .post(`/v1/painel/linguagem-simples/${docId}/retirar`)
        .set(chefe)
        .expect(409);
    });
  });
});
