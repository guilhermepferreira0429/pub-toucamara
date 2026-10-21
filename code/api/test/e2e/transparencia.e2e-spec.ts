/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { hojeLisboa } from '../../src/common/dias-uteis';
import { TransparenciaService } from '../../src/modules/transparencia/transparencia.service';
import { IDS_CONJUNTOS } from '../../src/modules/transparencia/conjuntos';
import { somarMeses } from '../../src/modules/transparencia/regras';
import { arrancarApp, Contexto, entrarPainel, linha, linhas } from './app';

/*
 * Transparência: dados abertos e indicadores. Um município só para este
 * ficheiro (os outros testes enchem o 'teste' de ocorrências e conversas),
 * com dados pessoais de propósito em todo o lado (nome, telefone, NIF,
 * morada, textos): nada disso pode aparecer em nenhum ficheiro publicado.
 */

const M = randomUUID();
const SLUG = `transp-${M.slice(0, 8)}`;
const SERVICO = randomUUID();
const TIPO = randomUUID();
const CATEGORIA = randomUUID();

// Os dados pessoais que nunca podem sair.
const NOME = 'Joaquina Segredo Pires';
const TELEFONE = '+351919876543';
const NIF = '245678901';
const EMAIL = 'joaquina.segredo@exemplo.pt';
const RUA = 'Rua da Joaquina Escondida';
const PROIBIDOS = [
  'Joaquina',
  'Segredo',
  '919876543',
  NIF,
  'joaquina.segredo',
  'Escondida',
];

function semDadosPessoais(texto: string, onde: string): void {
  for (const p of PROIBIDOS) {
    if (texto.includes(p)) {
      throw new Error(`"${p}" apareceu em ${onde}`);
    }
  }
}

describe('Transparência · dados abertos e indicadores (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let vereador: Record<string, string>;
  let atendimento: Record<string, string>;
  let tecnico: Record<string, string>;
  const mes = hojeLisboa().slice(0, 7);
  const base = `/v1/public/dados/${SLUG}`;

  async function utilizador(perfil: string): Promise<Record<string, string>> {
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil) VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        M,
        `${perfil}-${id.slice(0, 8)}@transp.pt`,
        `Func ${perfil}`,
        perfil,
      ],
    );
    return entrarPainel(ctx, id);
  }

  let seq = 0;
  async function municipe(i: number): Promise<string> {
    seq++;
    const [r] = (
      await ctx.db.query<{ id: string }>(
        `INSERT INTO municipes (municipio_id, telefone_e164, nome, email, nif_hash)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          M,
          `${TELEFONE}${seq}`,
          `${NOME} ${i}`,
          `${seq}.${EMAIL}`,
          Buffer.from(NIF),
        ],
      )
    ).rows;
    return r.id;
  }

  async function ocorrencia(morada: string, resolvida: boolean, n: string) {
    await ctx.db.query(
      `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, estado,
         municipe_id, criada_em, resolvida_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now() - interval '2 hours', $8)`,
      [
        M,
        n,
        CATEGORIA,
        `${NOME} (${TELEFONE}, NIF ${NIF}) diz que há um buraco enorme`,
        morada,
        resolvida ? 'resolvida' : 'nova',
        await municipe(Number(n.slice(-1))),
        resolvida ? new Date() : null,
      ],
    );
  }

  beforeAll(async () => {
    ctx = await arrancarApp();
    const hoje = hojeLisboa();
    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome, email_geral) VALUES ($1, $2, 'Vila Transparente', $3)`,
      [M, SLUG, `geral@${SLUG}.pt`],
    );
    const entidade = randomUUID();
    await ctx.db.query(
      `INSERT INTO entidades (id, municipio_id, nome, tipo, descricao) VALUES ($1, $2, 'Câmara Municipal', 'camara', 'Câmara')`,
      [entidade, M],
    );
    await ctx.db.query(
      `INSERT INTO servicos (id, municipio_id, entidade_id, nome) VALUES ($1, $2, $3, 'Obras e via pública')`,
      [SERVICO, M, entidade],
    );
    await ctx.db.query(
      `INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, servico_id, formulario)
       VALUES ($1, $2, 'CP', 'Comunicação prévia', 20, $3, '[]')`,
      [TIPO, M, SERVICO],
    );
    await ctx.db.query(
      `INSERT INTO categorias_ocorrencia (id, municipio_id, nome, servico_id) VALUES ($1, $2, 'Buraco na via', $3)`,
      [CATEGORIA, M, SERVICO],
    );
    chefe = await utilizador('chefe_divisao');
    vereador = await utilizador('vereador');
    atendimento = await utilizador('atendimento');
    tecnico = await utilizador('tecnico');

    // Atendimento: 6 ao telefone resolvidas, 6 no chat passadas.
    for (let i = 0; i < 12; i++) {
      await ctx.db.query(
        `INSERT INTO conversas (municipio_id, municipe_id, canal, iniciada_em, duracao_s, resultado, resumo, fora_de_horas)
         VALUES ($1, $2, $3, now() - interval '1 hour', 120, $4, $5, false)`,
        [
          M,
          await municipe(i),
          i < 6 ? 'telefone' : 'chat',
          i < 6 ? 'resolvida' : 'passada_funcionario',
          `${NOME} ligou do ${TELEFONE} com o NIF ${NIF}`,
        ],
      );
    }

    // Processos: 6 que entraram completos e foram decididos dentro do prazo
    // (a freguesia deles é a lista que reconhece as moradas).
    for (let i = 0; i < 6; i++) {
      await ctx.db.query(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada, freguesia,
           fase, prazo_inicio, prazo_fim, decisao, decidido_em, criado_em)
         VALUES ($1, $2, $3, $4, $5, $6, 'Azurém', 'notificado', $7::date, $7::date + 30, 'admitido',
                 now(), now() - interval '1 hour')`,
        [
          M,
          `CP ${i + 1}/2026`,
          TIPO,
          await municipe(i),
          `Obra de ${NOME}, NIF ${NIF}`,
          `${RUA} ${i}, Azurém`,
          hoje,
        ],
      );
    }

    // Ocorrências: 6 em Azurém resolvidas; 2 sem freguesia reconhecível.
    for (let i = 0; i < 6; i++) {
      await ocorrencia(`${RUA} ${i}, Azurém`, true, `OC-${i}`);
    }
    await ocorrencia(`${RUA} 99`, false, 'OC-7');
    await ocorrencia(`${RUA} 98`, false, 'OC-8');

    // Reclamações: 5 respondidas dentro do prazo.
    for (let i = 0; i < 5; i++) {
      await ctx.db.query(
        `INSERT INTO reclamacoes (municipio_id, numero, codigo_publico, canal, nome, telefone, email,
           servico_id, descricao, pedido, estado, recebida_em, prazo_dias_uteis, responder_ate,
           config_usada, resposta, respondida_em)
         VALUES ($1, $2, $3, 'telefone', $4, $5, $6, $7, $8, $9, 'respondida', $10::date, 15,
                 $10::date + 20, '{}', $11, now())`,
        [
          M,
          `REC ${i + 1}/2026`,
          `rec-${randomUUID()}`,
          NOME,
          TELEFONE,
          EMAIL,
          SERVICO,
          `Sou a ${NOME}, NIF ${NIF}`,
          `Liguem para ${TELEFONE}`,
          hoje,
          `Cara ${NOME}, ...`,
        ],
      );
    }

    // Consulta pública fechada: 5 em Azurém, 1 que disse o nome como freguesia.
    const [c] = (
      await ctx.db.query<{ id: string }>(
        `INSERT INTO consultas_publicas (municipio_id, codigo, titulo, resumo, perguntas, pergunta_aberta,
           freguesias, abre_em, fecha_em, relatorio_em, estado)
         VALUES ($1, $2, 'Nova praça central', 'Uma praça nova', $3, 'O que acha?', ARRAY['Azurém','Creixomil'],
                 $4::date - 20, $4::date - 2, $4::date, 'fechada') RETURNING id`,
        [
          M,
          `C${M.slice(0, 7).toUpperCase()}`,
          JSON.stringify([
            {
              id: 'p1',
              texto: 'Concorda com a praça?',
              opcoes: [
                { id: 'sim', texto: 'Sim' },
                { id: 'nao', texto: 'Não' },
              ],
            },
          ]),
          hoje,
        ],
      )
    ).rows;
    for (let i = 0; i < 6; i++) {
      await ctx.db.query(
        `INSERT INTO consulta_participacoes (consulta_id, municipe_id, respostas, opiniao, freguesia, canal)
         VALUES ($1, $2, '{"p1":"sim"}', $3, $4, 'telefone')`,
        [
          c.id,
          await municipe(i),
          `Liguem-me para o ${TELEFONE}, ${NOME}`,
          i < 5 ? 'azurem' : 'Joaquina Segredo',
        ],
      );
    }

    // Licenças: 5 de ruído emitidas na hora.
    for (let i = 0; i < 5; i++) {
      const [p] = (
        await ctx.db.query<{ id: string }>(
          `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, fase, criado_em)
           VALUES ($1, $2, $3, $4, 'notificado', now() - interval '1 hour') RETURNING id`,
          [M, `LER ${i + 1}/2026`, TIPO, `Festa de ${NOME}`],
        )
      ).rows;
      await ctx.db.query(
        `INSERT INTO licencas (municipio_id, processo_id, tipo, dados, avaliacao, config_usada, proposta,
           estado, taxa_cent, codigo_verificacao, decidida_em)
         VALUES ($1, $2, 'ruido', $3, '{}', '{}', 'aprovar', 'emitida', 0, $4, now())`,
        [
          M,
          p.id,
          JSON.stringify({ morada: RUA, requerente: NOME, nif: NIF }),
          `lic-${randomUUID()}`,
        ],
      );
    }
  });
  afterAll(() => ctx.fechar());

  /** Tira o endereço da API de uma URL absoluta. */
  const caminho = (url: string) => url.replace(/^https?:\/\/[^/]+/, '');

  describe('antes de ligar', () => {
    it('o catálogo está vazio e os conjuntos dão 404', async () => {
      const r = await ctx.http().get(base).expect(200);
      expect(r.body).toMatchObject({
        municipio: { slug: SLUG, nome: 'Vila Transparente' },
        licenca: { id: 'CC-BY-4.0' },
        conjuntos: [],
      });
      const e = await ctx.http().get(`${base}/ocorrencias.csv`).expect(404);
      expect(e.body.erro.codigo).toBe('conjunto_nao_publicado');
      await ctx.http().get(`${base}/nao-existe`).expect(404);
      await ctx.http().get('/v1/public/dados/nao-existe-mesmo').expect(404);
      const i = await ctx
        .http()
        .get(`/v1/public/indicadores/${SLUG}?mes=${mes}`)
        .expect(200);
      expect(i.body.indicadores).toEqual([]);
    });

    it('o painel mostra tudo desligado e pré-visualiza sem publicar', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/transparencia')
        .set(chefe)
        .expect(200);
      expect(r.body.conjuntos.map((c: any) => c.id)).toEqual([
        ...IDS_CONJUNTOS,
      ]);
      expect(r.body.conjuntos.every((c: any) => !c.ativo)).toBe(true);
      expect(r.body.portal.dcat).toMatch(
        new RegExp(`/v1/public/dados/${SLUG}/catalogo\\.jsonld$`),
      );
      const p = await ctx
        .http()
        .get('/v1/painel/transparencia/conjuntos/ocorrencias/pre-visualizar')
        .set(chefe)
        .expect(200);
      expect(p.body.linhas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            mes,
            freguesia: 'Azurém',
            reportadas: 6,
          }),
        ]),
      );
      semDadosPessoais(JSON.stringify(p.body), 'pré-visualização');
      const n = await linha(
        ctx.db,
        'SELECT count(*)::int AS n FROM dados_abertos_publicacoes WHERE municipio_id = $1',
        [M],
      );
      expect(n.n).toBe(0);
    });
  });

  describe('permissões', () => {
    it('quem atende não vê; vereador e técnico veem mas não ligam nem publicam', async () => {
      await ctx
        .http()
        .get('/v1/painel/transparencia')
        .set(atendimento)
        .expect(403);
      await ctx
        .http()
        .get('/v1/painel/transparencia')
        .set(vereador)
        .expect(200);
      for (const quem of [vereador, tecnico, atendimento]) {
        await ctx
          .http()
          .put('/v1/painel/transparencia/conjuntos/ocorrencias')
          .set(quem)
          .send({ ativo: true })
          .expect(403);
        await ctx
          .http()
          .post('/v1/painel/transparencia/publicar')
          .set(quem)
          .expect(403);
      }
      const eu = await ctx
        .http()
        .get('/v1/painel/auth/eu')
        .set(vereador)
        .expect(200);
      expect(eu.body.permissoes).toMatchObject({
        indicadores: true,
        transparencia: false,
      });
    });

    it('conjunto desconhecido e corpo inválido', async () => {
      await ctx
        .http()
        .put('/v1/painel/transparencia/conjuntos/nomes-dos-municipes')
        .set(chefe)
        .send({ ativo: true })
        .expect(404);
      await ctx
        .http()
        .put('/v1/painel/transparencia/conjuntos/ocorrencias')
        .set(chefe)
        .send({ ativo: 'sim' })
        .expect(400);
      const r = await ctx
        .http()
        .post('/v1/painel/transparencia/conjuntos/ocorrencias/publicar')
        .set(chefe)
        .expect(409);
      expect(r.body.erro.codigo).toBe('conjunto_desligado');
    });
  });

  describe('ligar e publicar', () => {
    it('ligar cada conjunto publica logo e fica registado', async () => {
      for (const id of IDS_CONJUNTOS) {
        const r = await ctx
          .http()
          .put(`/v1/painel/transparencia/conjuntos/${id}`)
          .set(chefe)
          .send({ ativo: true })
          .expect(200);
        expect(r.body).toMatchObject({ id, ativo: true, nova: true });
        expect(r.body.publicacao.linhas).toBeGreaterThan(0);
      }
      const audit = await linhas(
        ctx.db,
        `SELECT acao, ator_tipo::text AS ator_tipo, objeto_id FROM audit_log
         WHERE municipio_id = $1 AND objeto_tipo = 'conjunto_dados' ORDER BY em, id`,
        [M],
      );
      expect(
        audit.filter((a) => a.acao === 'ligar_dados_abertos'),
      ).toHaveLength(6);
      expect(
        audit.filter(
          (a) =>
            a.acao === 'publicar_dados_abertos' && a.ator_tipo === 'utilizador',
        ),
      ).toHaveLength(6);
      // O registo de acessos lê-o em português.
      const acessos = await ctx
        .http()
        .get('/v1/painel/equipa/acessos')
        .set(chefe)
        .expect(200);
      expect(JSON.stringify(acessos.body)).toContain(
        'publicou um conjunto de dados abertos',
      );
    });

    it('publicar já sem nada mudado não cria outra versão', async () => {
      const antes = await linha(
        ctx.db,
        'SELECT count(*)::int AS n FROM dados_abertos_publicacoes WHERE municipio_id = $1',
        [M],
      );
      const r = await ctx
        .http()
        .post('/v1/painel/transparencia/publicar')
        .set(chefe)
        .expect(200);
      expect(r.body.conjuntos).toHaveLength(6);
      expect(r.body.conjuntos.every((c: any) => c.nova === false)).toBe(true);
      const depois = await linha(
        ctx.db,
        'SELECT count(*)::int AS n FROM dados_abertos_publicacoes WHERE municipio_id = $1',
        [M],
      );
      expect(depois.n).toBe(antes.n);
    });

    it('o catálogo público lista os seis, com as ligações', async () => {
      const r = await ctx.http().get(base).expect(200);
      expect(r.body.conjuntos.map((c: any) => c.id)).toEqual([
        ...IDS_CONJUNTOS,
      ]);
      expect(r.body.conjuntos[0].urls.csv).toMatch(/\/ocorrencias\.csv$/);
      expect(r.headers['cache-control']).toMatch(/public, max-age=\d+/);
      expect(r.headers['access-control-allow-origin']).toBe('*');
    });
  });

  describe('conteúdo publicado', () => {
    it('ocorrências: CSV agregado, com a freguesia e as contagens pequenas escondidas', async () => {
      const r = await ctx.http().get(`${base}/ocorrencias.csv`).expect(200);
      expect(r.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
      expect(r.headers['content-disposition']).toMatch(
        new RegExp(`filename="${SLUG}-ocorrencias-\\d{4}-\\d{2}-\\d{2}\\.csv"`),
      );
      const ls = r.text.trimEnd().split('\r\n');
      expect(ls[0]).toBe(
        'mes,categoria,freguesia,reportadas,resolvidas,em_aberto,tempo_medio_resolucao_dias',
      );
      expect(ls).toContain(`${mes},Buraco na via,Azurém,6,6,0,0.1`);
      expect(ls).toContain(
        `${mes},Buraco na via,Sem freguesia identificada,<5,0,<5,`,
      );
    });

    it('atendimento, processos, reclamações, consultas e licenças em JSON', async () => {
      const at = await ctx.http().get(`${base}/atendimento.json`).expect(200);
      expect(at.body).toMatchObject({
        conjunto: 'atendimento',
        municipio: { slug: SLUG },
        licenca: { id: 'CC-BY-4.0' },
        supressao: expect.stringContaining('<5'),
      });
      expect(at.body.colunas[0]).toEqual({
        nome: 'mes',
        tipo: 'mes',
        descricao: expect.any(String),
      });
      expect(at.body.dados).toEqual([
        expect.objectContaining({
          mes,
          canal: 'chat',
          conversas: 6,
          resolvidas_pelo_agente: 0,
          resolvidas_pelo_agente_pct: 0,
          passadas_a_funcionario: 6,
        }),
        expect.objectContaining({
          mes,
          canal: 'telefone',
          conversas: 6,
          resolvidas_pelo_agente: 6,
          resolvidas_pelo_agente_pct: 100,
          duracao_media_minutos: 2,
        }),
      ]);

      const pr = await ctx.http().get(`${base}/processos.json`).expect(200);
      expect(pr.body.dados).toEqual([
        expect.objectContaining({
          mes,
          tipo_codigo: 'CP',
          prazo_legal_dias_uteis: 20,
          entrados: 11,
          decididos: 6,
          dentro_do_prazo_pct: 100,
        }),
      ]);

      const rc = await ctx.http().get(`${base}/reclamacoes.json`).expect(200);
      expect(rc.body.dados).toEqual([
        expect.objectContaining({
          mes,
          servico: 'Obras e via pública',
          recebidas: 5,
          respondidas: 5,
          respondidas_no_prazo: 5,
          respondidas_no_prazo_pct: 100,
          em_atraso: 0,
        }),
      ]);

      const cp = await ctx
        .http()
        .get(`${base}/consultas-publicas.json`)
        .expect(200);
      const freguesias = [
        ...new Set(cp.body.dados.map((l: any) => l.freguesia)),
      ];
      expect(freguesias).toEqual(['Azurém', 'Creixomil', 'Outra freguesia']);
      expect(cp.body.dados).toContainEqual(
        expect.objectContaining({
          consulta: 'Nova praça central',
          pergunta: 'Concorda com a praça?',
          opcao: 'Sim',
          freguesia: 'Azurém',
          respostas: 5,
          respostas_freguesia: 5,
          pct: 100,
        }),
      );

      const li = await ctx.http().get(`${base}/licencas.json`).expect(200);
      expect(li.body.dados).toEqual([
        expect.objectContaining({
          mes,
          tipo_codigo: 'ruido',
          tipo: 'Licença especial de ruído',
          pedidas: 5,
          emitidas: 5,
          emitidas_sem_tecnico: 5,
          recusadas: 0,
        }),
      ]);
    });

    it('a página do conjunto traz os metadados e a última publicação', async () => {
      const r = await ctx.http().get(`${base}/reclamacoes`).expect(200);
      expect(r.body).toMatchObject({
        id: 'reclamacoes',
        titulo: expect.any(String),
        frequencia: { codigo: 'diaria' },
        licenca: { id: 'CC-BY-4.0' },
        publicacao: {
          id: expect.any(String),
          linhas: 1,
          urls: {
            csv: expect.stringMatching(/historico\/[0-9a-f-]{36}\.csv$/),
          },
        },
      });
      expect(r.body.colunas.every((c: any) => c.tipo && c.descricao)).toBe(
        true,
      );
      expect(r.body.dados).toHaveLength(1);
    });

    it('nunca aparece telefone, nome, NIF, email ou morada em nada do que se publica', async () => {
      const textos: [string, string][] = [];
      const juntar = async (url: string) => {
        const r = await ctx.http().get(url).expect(200);
        textos.push([url, r.text]);
      };
      await juntar(base);
      await juntar(`${base}/catalogo.jsonld`);
      await juntar(`/v1/public/indicadores/${SLUG}?mes=${mes}`);
      for (const id of IDS_CONJUNTOS) {
        await juntar(`${base}/${id}`);
        await juntar(`${base}/${id}.csv`);
        await juntar(`${base}/${id}.json`);
        await juntar(`${base}/${id}/historico`);
      }
      for (const [url, t] of textos) semDadosPessoais(t, url);
      // E o que fica guardado na BD (que também pode ir para S3).
      const guardado = await linhas(
        ctx.db,
        'SELECT csv, linhas::text AS linhas, resumo::text AS resumo FROM dados_abertos_publicacoes WHERE municipio_id = $1',
        [M],
      );
      expect(guardado.length).toBe(6);
      for (const g of guardado) {
        semDadosPessoais(`${g.csv}${g.linhas}${g.resumo}`, 'BD');
      }
      // E a verificação apanha de facto um dado pessoal.
      expect(() => semDadosPessoais(`x ${TELEFONE}`, 'teste')).toThrow();
    });
  });

  describe('cache e DCAT', () => {
    it('ETag e 304 com If-None-Match', async () => {
      const r = await ctx.http().get(`${base}/ocorrencias.csv`).expect(200);
      expect(r.headers.etag).toMatch(/^"[0-9a-f]{32}-csv"$/);
      expect(r.headers['last-modified']).toBeTruthy();
      expect(r.headers['cache-control']).toMatch(/public/);
      await ctx
        .http()
        .get(`${base}/ocorrencias.csv`)
        .set('If-None-Match', r.headers.etag)
        .expect(304);
    });

    it('catálogo DCAT-AP em JSON-LD com um dcat:Dataset por conjunto', async () => {
      const r = await ctx.http().get(`${base}/catalogo.jsonld`).expect(200);
      expect(r.headers['content-type']).toMatch(/^application\/ld\+json/);
      const doc = JSON.parse(r.text);
      expect(doc['@type']).toBe('dcat:Catalog');
      expect(doc['@context'].dcat).toBe('http://www.w3.org/ns/dcat#');
      expect(doc['dct:publisher']['foaf:name']).toBe(
        'Município de Vila Transparente',
      );
      expect(doc['dcat:dataset']).toHaveLength(6);
      for (const d of doc['dcat:dataset']) {
        expect(d['@type']).toBe('dcat:Dataset');
        expect(d['dcat:contactPoint']['vcard:hasEmail']['@id']).toBe(
          `mailto:geral@${SLUG}.pt`,
        );
        for (const x of d['dcat:distribution']) {
          expect(x['dct:license']['@id']).toBe(
            'http://publications.europa.eu/resource/authority/licence/CC_BY_4_0',
          );
          // As ligações de descarga funcionam.
          const f = await ctx
            .http()
            .get(caminho(x['dcat:downloadURL']['@id']))
            .expect(200);
          expect(Number(x['dcat:byteSize']['@value'])).toBe(
            Buffer.byteLength(f.text),
          );
        }
      }
    });
  });

  describe('histórico e o trabalho diário', () => {
    it('o trabalho só cria uma versão nova quando os números mudam; as antigas ficam iguais', async () => {
      const csvAntes = (await ctx.http().get(`${base}/ocorrencias.csv`)).text;
      const servico = ctx.app.get(TransparenciaService);

      await servico.correrJob();
      let h = await ctx.http().get(`${base}/ocorrencias/historico`).expect(200);
      expect(h.body.itens).toHaveLength(1);
      const antiga = h.body.itens[0];

      // Mais uma ocorrência em Azurém (resolvida): os números mudam.
      await ocorrencia(`${RUA} 50, Azurém`, true, 'OC-9');
      await servico.correrJob();
      h = await ctx.http().get(`${base}/ocorrencias/historico`).expect(200);
      expect(h.body.itens).toHaveLength(2);
      expect(h.body.itens[1].id).toBe(antiga.id);

      const agora = await ctx.http().get(`${base}/ocorrencias.csv`);
      expect(agora.text).toContain(`${mes},Buraco na via,Azurém,7,7,0,0.1`);
      const velha = await ctx.http().get(caminho(antiga.urls.csv)).expect(200);
      expect(velha.text).toBe(csvAntes);
      expect(velha.headers['cache-control']).toMatch(/immutable/);
      const velhaJson = await ctx
        .http()
        .get(caminho(antiga.urls.json))
        .expect(200);
      expect(velhaJson.body.dados).toContainEqual(
        expect.objectContaining({ freguesia: 'Azurém', reportadas: 6 }),
      );

      const pub = await linha(
        ctx.db,
        `SELECT origem FROM dados_abertos_publicacoes
         WHERE municipio_id = $1 AND conjunto = 'ocorrencias' ORDER BY gerado_em DESC LIMIT 1`,
        [M],
      );
      expect(pub.origem).toBe('automatica');
      const audit = await linha(
        ctx.db,
        `SELECT ator_tipo::text AS ator_tipo FROM audit_log
         WHERE municipio_id = $1 AND acao = 'publicar_dados_abertos' ORDER BY em DESC LIMIT 1`,
        [M],
      );
      expect(audit.ator_tipo).toBe('sistema');

      await ctx
        .http()
        .get(`${base}/ocorrencias/historico/${randomUUID()}.csv`)
        .expect(404);
      await ctx
        .http()
        .get(`${base}/ocorrencias/historico/qualquer.txt`)
        .expect(404);
    });

    it('o painel mostra o histórico do conjunto', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/transparencia/conjuntos/ocorrencias')
        .set(vereador)
        .expect(200);
      expect(r.body).toMatchObject({
        id: 'ocorrencias',
        ativo: true,
        publicacoes: 2,
      });
      expect(r.body.historico).toHaveLength(2);
      expect(r.body.historico[0].origem).toBe('automatica');
    });
  });

  describe('indicadores para o portal', () => {
    it('os números do mês, com a data e a ligação ao conjunto de origem', async () => {
      const r = await ctx
        .http()
        .get(`/v1/public/indicadores/${SLUG}?mes=${mes}`)
        .expect(200);
      expect(r.headers['access-control-allow-origin']).toBe('*');
      expect(r.body).toMatchObject({ mes, mes_completo: false });
      const por = Object.fromEntries(
        r.body.indicadores.map((i: any) => [i.id, i]),
      );
      expect(por.resolvidos_pelo_agente_pct).toMatchObject({
        valor: 50,
        texto: '50 %',
        conjunto: 'atendimento',
        fonte: { url: expect.stringMatching(/\/atendimento$/) },
      });
      expect(por.conversas.valor).toBe(12);
      expect(por.ocorrencias_resolvidas).toMatchObject({ valor: 7, de: 9 });
      expect(por.processos_dentro_do_prazo_pct.valor).toBe(100);
      expect(por.reclamacoes_no_prazo_pct.valor).toBe(100);
      expect(por.licencas_emitidas.valor).toBe(5);
      for (const i of r.body.indicadores) {
        expect(i.atualizado_em).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('por omissão o último mês completo; mês inválido dá 400', async () => {
      const r = await ctx
        .http()
        .get(`/v1/public/indicadores/${SLUG}`)
        .expect(200);
      expect(r.body.mes).toBe(somarMeses(mes, -1));
      expect(r.body.mes_completo).toBe(true);
      expect(
        r.body.indicadores.find((i: any) => i.id === 'conversas').valor,
      ).toBe(0);
      await ctx
        .http()
        .get(`/v1/public/indicadores/${SLUG}?mes=2026-13`)
        .expect(400);
    });
  });

  describe('desligar', () => {
    it('desligado sai do portal, do DCAT e dos indicadores (o histórico fica na BD)', async () => {
      await ctx
        .http()
        .put('/v1/painel/transparencia/conjuntos/atendimento')
        .set(chefe)
        .send({ ativo: false })
        .expect(200);
      await ctx.http().get(`${base}/atendimento.csv`).expect(404);
      await ctx.http().get(`${base}/atendimento/historico`).expect(404);
      const c = await ctx.http().get(base).expect(200);
      expect(c.body.conjuntos.map((x: any) => x.id)).not.toContain(
        'atendimento',
      );
      const d = JSON.parse(
        (await ctx.http().get(`${base}/catalogo.jsonld`)).text,
      );
      expect(d['dcat:dataset']).toHaveLength(5);
      const i = await ctx
        .http()
        .get(`/v1/public/indicadores/${SLUG}?mes=${mes}`)
        .expect(200);
      expect(
        i.body.indicadores.filter((x: any) => x.conjunto === 'atendimento'),
      ).toEqual([]);
      const guardadas = await linha(
        ctx.db,
        `SELECT count(*)::int AS n FROM dados_abertos_publicacoes WHERE municipio_id = $1 AND conjunto = 'atendimento'`,
        [M],
      );
      expect(guardadas.n).toBe(1);
      const a = await linha(
        ctx.db,
        `SELECT 1 AS ok FROM audit_log WHERE municipio_id = $1 AND acao = 'desligar_dados_abertos' AND objeto_id = 'atendimento'`,
        [M],
      );
      expect(a?.ok).toBe(1);

      // O trabalho diário não publica o que está desligado.
      await ctx.app.get(TransparenciaService).correrJob();
      const depois = await linha(
        ctx.db,
        `SELECT count(*)::int AS n FROM dados_abertos_publicacoes WHERE municipio_id = $1 AND conjunto = 'atendimento'`,
        [M],
      );
      expect(depois.n).toBe(1);
    });
  });
});
