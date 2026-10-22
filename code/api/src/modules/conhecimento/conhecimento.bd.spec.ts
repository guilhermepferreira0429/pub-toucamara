/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { readFileSync } from 'fs';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { join } from 'path';
import { Client } from 'pg';
import { lerCursor } from '../../common/paginacao.js';
import type { UtilizadorPainel } from '../../common/pedido.js';
import type { DatabaseService, Tx } from '../../database/database.service.js';
import type { ClaudeService } from '../../ia/claude.service.js';
import type { JobsService } from '../../jobs/jobs.service.js';
import type { ArmazenamentoService } from '../armazenamento/armazenamento.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { AvaliacaoService } from './avaliacao.service.js';
import { ConhecimentoService } from './conhecimento.service.js';
import { ContradicoesService } from './contradicoes.service.js';
import { DescarregadorService } from './descarregador.service.js';
import { EdicaoService } from './edicao.service.js';
import { DIMENSAO, EmbeddingsService } from './embeddings.service.js';
import { IndexacaoService } from './indexacao.service.js';
import { ERRO_PDF, IngestaoService } from './ingestao.service.js';
import { PainelConhecimentoService } from './painel-conhecimento.service.js';
import { PropostasService } from './propostas.service.js';

/*
 * Integração com o Postgres de dev, tudo numa transação desfeita no fim
 * (nada fica na BD). Só corre com TESTE_BD=1:
 *
 *   TESTE_BD=1 npx jest src/modules/conhecimento/conhecimento.bd.spec.ts
 *
 * Outra BD (já com todas as migrações): DB_NAME=toucamara_mig.
 *
 * Embeddings e IA são falsos (vetores determinísticos, texto fixo); as
 * fontes vêm de um servidor HTTP local.
 */
const correr = process.env.TESTE_BD === '1' ? describe : describe.skip;

/** Vetor determinístico por palavras: textos com as mesmas palavras ficam perto. */
function vetorFalso(texto: string): number[] {
  const v = new Array<number>(DIMENSAO).fill(0);
  for (const w of texto.toLowerCase().split(/\W+/).filter(Boolean)) {
    let h = 0;
    for (const c of w) h = (h * 31 + c.charCodeAt(0)) % DIMENSAO;
    v[h] += 1;
  }
  v[0] += 0.01;
  return v;
}

correr('conhecimento (BD)', () => {
  let client: Client;
  let servidor: Server;
  let base: string;
  const paginas: Record<string, { tipo: string; corpo: string | Buffer }> = {};
  const enviados: { nome: string; dados: any }[] = [];

  let db: DatabaseService;
  let pesquisa: ConhecimentoService;
  let ingestao: IngestaoService;
  let propostas: PropostasService;
  let contradicoes: ContradicoesService;
  let painel: PainelConhecimentoService;
  let indexacao: IndexacaoService;

  let municipio: string;
  let camara: string;
  let aguas: string;
  let u: UtilizadorPainel;

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      const p = paginas[req.url ?? ''];
      if (!p) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': p.tipo }).end(p.corpo);
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;

    client = new Client({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 54330),
      user: 'toucamara',
      password: process.env.DB_PASSWORD ?? 'toucamara',
      database: process.env.DB_NAME ?? 'toucamara',
    });
    await client.connect();
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'fontes' AND column_name = 'leitura_automatica'`,
    );
    if (!rows.length) {
      await client.query(
        readFileSync(
          join(__dirname, '../../../db/migrations/0017_conhecimento.sql'),
          'utf8',
        ),
      );
    }

    let n = 0;
    const query = async (sql: string, p?: unknown[]) =>
      (await client.query(sql, p)).rows;
    const tx = { query };
    db = {
      query,
      transaction: async <T>(fn: (t: Tx) => Promise<T>) => {
        const sp = `sp${++n}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          const r = await fn(tx);
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          return r;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          throw e;
        }
      },
    } as unknown as DatabaseService;

    const embeddings = {
      disponivel: true,
      pergunta: (t: string) => Promise.resolve(vetorFalso(t)),
      varios: (ts: string[]) => Promise.resolve(ts.map(vetorFalso)),
    } as unknown as EmbeddingsService;
    const claude = {
      disponivel: true,
      escrever: () => Promise.resolve('A licença custa agora 12 euros.'),
      extrair: () =>
        Promise.resolve({
          contradiz: true,
          assunto: 'Falta de água · contacto',
          valor_a: '800 910 410',
          valor_b: '253 000 111',
          usar: 'a',
        }),
    } as unknown as ClaudeService;
    const jobs = {
      enviar: (nome: string, dados: object) => {
        enviados.push({ nome, dados });
        return Promise.resolve('job');
      },
    } as unknown as JobsService;
    const armazenamento = {
      disponivel: false,
    } as unknown as ArmazenamentoService;

    indexacao = new IndexacaoService(db, embeddings);
    pesquisa = new ConhecimentoService(db, embeddings);
    // Sem a pausa de 2 s entre pedidos ao mesmo site (é tudo o servidor local).
    const descarregador = Object.assign(new DescarregadorService(), {
      intervaloMs: 0,
    });
    ingestao = new IngestaoService(
      db,
      jobs,
      claude,
      armazenamento,
      indexacao,
      undefined,
      descarregador,
    );
    propostas = new PropostasService(db, claude);
    contradicoes = new ContradicoesService(db, claude);
    const avaliacao = new AvaliacaoService(db);
    painel = new PainelConhecimentoService(
      db,
      jobs,
      new AuditoriaService(db),
      ingestao,
      indexacao,
      avaliacao,
      new EdicaoService(db, new AuditoriaService(db), avaliacao),
    );

    [{ id: municipio }] = await db.query<{ id: string }>(
      `INSERT INTO municipios (slug, nome) VALUES ('teste-conhecimento', 'Teste') RETURNING id`,
    );
    [{ id: camara }] = await db.query<{ id: string }>(
      `INSERT INTO entidades (municipio_id, nome, tipo) VALUES ($1, 'Câmara Municipal', 'camara') RETURNING id`,
      [municipio],
    );
    [{ id: aguas }] = await db.query<{ id: string }>(
      `INSERT INTO entidades (municipio_id, nome, tipo, descricao)
       VALUES ($1, 'Águas Municipais', 'empresa_municipal', 'Água e saneamento') RETURNING id`,
      [municipio],
    );
    const [ut] = await db.query<{ id: string }>(
      `INSERT INTO utilizadores (email, nome, perfil) VALUES ('teste-conh@x.pt', 'Equipa', 'equipa_toucamara') RETURNING id`,
    );
    u = {
      id: ut.id,
      nome: 'Equipa',
      email: 'teste-conh@x.pt',
      perfil: 'equipa_toucamara',
      municipioId: null,
      servicoId: null,
    };
  }, 30_000);

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => undefined);
    await client?.end();
    await new Promise((r) => servidor?.close(r));
  });

  const regulamento = (valor: string) =>
    `<html><body><nav>Menu</nav><main><h1>Regulamento de Taxas</h1>
     <p>Artigo 1.º</p><p>Objeto</p><p>O presente regulamento fixa as taxas de obras.</p>
     <p>Artigo 2.º</p><p>Licença de obras</p><p>A licença de obras no interior custa ${valor} euros.</p>
     <p>Artigo 3.º</p><p>Isenções</p><p>Estão isentas as instituições de solidariedade social.</p>
     </main></body></html>`;

  let fonteReg: string;
  let respostaId: string;

  /**
   * Uma execução terminada do nosso tou-chat com `certas` certas em 10
   * (categoria 'Taxas' as 5 primeiras, 'Água' as outras).
   */
  async function execucaoFalsa(
    versao: string,
    certas: number,
    o: { amostra?: boolean; adaptador?: string } = {},
  ): Promise<string> {
    const adaptador = o.adaptador ?? 'tou-chat';
    const nome = `Tou · Teste · ${adaptador}`;
    await db.query(
      `INSERT INTO avaliacao.sistemas (nome, municipio_id, adaptador, nosso)
       VALUES ($1, $2, $3, true) ON CONFLICT (nome) DO NOTHING`,
      [nome, municipio, adaptador],
    );
    const [{ id: conjunto }] = await db.query<{ id: string }>(
      `INSERT INTO avaliacao.conjuntos (nome, municipio_id) VALUES ('Teste', $1)
       ON CONFLICT (nome, versao, municipio_id) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
      [municipio],
    );
    await db.query(
      `INSERT INTO avaliacao.perguntas (conjunto_id, ordem, categoria, texto, comportamento)
       SELECT $1, i, CASE WHEN i <= 5 THEN 'Taxas' ELSE 'Água' END, 'Pergunta ' || i, 'responder'
       FROM generate_series(1, 10) i ON CONFLICT DO NOTHING`,
      [conjunto],
    );
    const [{ id }] = await db.query<{ id: string }>(
      `INSERT INTO avaliacao.execucoes (sistema_id, conjunto_id, agente_versao, amostra, estado, terminada_em)
       SELECT s.id, $2, $3, $4, 'terminada', clock_timestamp()
       FROM avaliacao.sistemas s WHERE s.nome = $1 RETURNING id`,
      [nome, conjunto, versao, o.amostra ?? false],
    );
    await db.query(
      `WITH r AS (
         INSERT INTO avaliacao.respostas (execucao_id, pergunta_id, texto, latencia_ms)
         SELECT $1, p.id, 'Resposta ' || p.ordem, 1000 + p.ordem FROM avaliacao.perguntas p
         WHERE p.conjunto_id = $2 RETURNING id, pergunta_id)
       INSERT INTO avaliacao.avaliacoes (resposta_id, rubrica_versao, veredicto, factos_em_falta, justificacao)
       SELECT r.id, '1', CASE WHEN p.ordem <= $3 THEN 'certa' ELSE 'errada' END,
              CASE WHEN p.ordem <= $3 THEN '{}' ELSE '{preço}' END::text[], 'Falta o preço.'
       FROM r JOIN avaliacao.perguntas p ON p.id = r.pergunta_id`,
      [id, conjunto, certas],
    );
    return id;
  }

  it('lê uma fonte HTML: versão, trechos por artigo e vetores', async () => {
    paginas['/taxas'] = {
      tipo: 'text/html; charset=utf-8',
      corpo: regulamento('10'),
    };
    const f = await painel.criarFonte(municipio, u, {
      entidade_id: camara,
      titulo: 'Regulamento de Taxas',
      tipo: 'regulamento',
      url: `${base}/taxas`,
      ler_a_cada_horas: 24,
      leitura_automatica: true,
    });
    fonteReg = (f as { id: string }).id;
    expect(enviados.at(-1)?.nome).toBe('ingestao_fontes');

    await ingestao.correr({
      municipio_id: municipio,
      fonte_id: fonteReg,
      forcar: true,
    });
    const trechos = await db.query<{ referencia: string; com_vetor: boolean }>(
      `SELECT t.referencia, t.embedding IS NOT NULL AS com_vetor FROM trechos t
       JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id WHERE fv.fonte_id = $1 ORDER BY t.ordem`,
      [fonteReg],
    );
    expect(trechos.map((t) => t.referencia)).toEqual([
      null,
      'art. 1.º',
      'art. 2.º',
      'art. 3.º',
    ]);
    expect(trechos.every((t) => t.com_vetor)).toBe(true);

    const [ing] = await db.query<{
      fontes_lidas: number;
      mudancas: number;
      erros: number;
    }>(
      `SELECT fontes_lidas, mudancas, erros FROM ingestoes WHERE municipio_id = $1`,
      [municipio],
    );
    expect(ing).toEqual({ fontes_lidas: 1, mudancas: 1, erros: 0 });
    expect(enviados.at(-1)?.nome).toBe('detetar_contradicoes');
  });

  it('pesquisa híbrida encontra o artigo e dá sem_fonte para o que não existe', async () => {
    const r = await pesquisa.procurar(
      municipio,
      'quanto custa a licença de obras?',
    );
    expect(r.sem_fonte).toBe(false);
    expect(r.trechos[0].referencia).toBe('art. 2.º');
    expect(r.trechos[0].entidade).toBe('Câmara Municipal');

    const nada = await pesquisa.procurar(municipio, 'zzzz qqqq');
    expect(nada.sem_fonte).toBe(true);
  });

  it('cria e publica uma resposta curada que passa a ser encontrada', async () => {
    const [t] = await db.query<{ id: string }>(
      `SELECT t.id FROM trechos t JOIN fonte_versoes fv ON fv.id = t.fonte_versao_id
       WHERE fv.fonte_id = $1 AND t.referencia = 'art. 2.º'`,
      [fonteReg],
    );
    const criada = await painel.criarResposta(municipio, u, {
      pergunta_tipo: 'Quanto custa a licença de obras?',
      texto_voz: 'A licença custa 10 euros.',
      texto_sms: 'Licença de obras: 10 euros.',
      passa_a_pessoa_quando: ['perguntam por prazos'],
      trechos: [t.id],
      frases: ['preço da licença de obras', 'quanto custa a licença de obras?'],
    });
    respostaId = criada.id;
    expect(criada.estado).toBe('rascunho');
    expect(criada.frases).toHaveLength(2);
    const versao = (criada.versoes as { id: string }[])[0];

    // Gate: sem avaliação, outra versão ou abaixo do limiar não publica.
    await db.query(
      `INSERT INTO agente_config (municipio_id, saudacao, versao) VALUES ($1, 'Olá', 'v1')`,
      [municipio],
    );
    const codigo = (p: Promise<unknown>) =>
      p.then(
        () => 'publicou',
        (e: { codigo?: string }) => e.codigo,
      );
    expect(
      await codigo(painel.publicar(municipio, u, respostaId, versao.id)),
    ).toBe('avaliacao_em_falta');
    await execucaoFalsa('v0', 10);
    expect(
      await codigo(painel.publicar(municipio, u, respostaId, versao.id)),
    ).toBe('avaliacao_em_falta');
    await execucaoFalsa('v1', 7);
    expect(
      await codigo(painel.publicar(municipio, u, respostaId, versao.id)),
    ).toBe('avaliacao_abaixo_do_limiar');
    const camaraU = { ...u, perfil: 'chefe_divisao' } as UtilizadorPainel;
    expect(
      await codigo(
        painel.publicar(municipio, camaraU, respostaId, versao.id, true),
      ),
    ).toBe('so_equipa_interna');
    const aprovada = await execucaoFalsa('v1', 9);

    await painel.publicar(municipio, u, respostaId, versao.id);
    const [pub] = await db.query<{ eval_execucao_id: string }>(
      `SELECT eval_execucao_id FROM resposta_versoes WHERE id = $1`,
      [versao.id],
    );
    expect(pub.eval_execucao_id).toBe(aprovada);
    const r = await pesquisa.procurar(
      municipio,
      'qual é o preço da licença de obras',
    );
    expect(r.respostas[0]?.resposta_id).toBe(respostaId);
    expect(r.respostas[0].fontes[0].referencia).toBe('art. 2.º');
  });

  it('versão nova da fonte: alteração com diff, resposta afetada e proposta', async () => {
    paginas['/taxas'] = { tipo: 'text/html', corpo: regulamento('12') };
    await ingestao.correr({
      municipio_id: municipio,
      fonte_id: fonteReg,
      forcar: true,
    });

    const lista = await painel.alteracoes(municipio, 'por_rever', 10, null);
    expect(lista.itens).toHaveLength(1);
    const alt = lista.itens[0] as any;
    expect(alt.resumo).toBe('1 linha mudou');
    expect(alt.respostas_afetadas).toBe(1);
    expect(enviados.some((e) => e.nome === 'propor_respostas')).toBe(true);

    await propostas.correr({ alteracao_id: alt.id });
    const det = (await painel.alteracao(municipio, alt.id)) as any;
    expect(det.diff.blocos[0].depois[0]).toContain('12 euros');
    expect(det.respostas[0].texto_proposto).toBe(
      'A licença custa agora 12 euros.',
    );

    // A pesquisa usa só a versão atual.
    const r = await pesquisa.procurar(
      municipio,
      'licença de obras custa euros',
    );
    expect(r.trechos.every((x) => !x.texto.includes('10 euros'))).toBe(true);

    // Versão nova do agente: a avaliação deixa de valer; forçar fica auditado.
    await db.query(
      `UPDATE agente_config SET versao = 'v2' WHERE municipio_id = $1`,
      [municipio],
    );
    await expect(
      painel.aprovar(municipio, u, alt.id, []),
    ).rejects.toMatchObject({
      codigo: 'avaliacao_em_falta',
    });
    await painel.aprovar(municipio, u, alt.id, [], true);
    const [aud] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_log
       WHERE acao = 'publicar_sem_avaliacao' AND objeto_id = $1`,
      [alt.id],
    );
    expect(aud.n).toBe(1);
    const resp = (await painel.resposta(municipio, respostaId)) as any;
    expect(resp.versoes[0].numero).toBe(2);
    expect(resp.versao_no_ar_id).toBe(resp.versoes[0].id);
    expect(resp.versoes[0].fontes[0].texto).toContain('12 euros');

    const [fo] = await db.query<{ estado: string }>(
      `SELECT estado FROM fontes WHERE id = $1`,
      [fonteReg],
    );
    expect(fo.estado).toBe('em_dia');
  });

  it('mesmo texto: só marca a leitura', async () => {
    const r = await ingestao.registarTexto(
      fonteReg,
      (
        await db.query<{ texto: string }>(
          `SELECT texto FROM fonte_versoes WHERE fonte_id = $1 ORDER BY lida_em DESC LIMIT 1`,
          [fonteReg],
        )
      )[0].texto,
    );
    expect(r.mudou).toBe(false);
  });

  it('PDF fica em erro até se colar o texto; depois não volta a erro se não mudar', async () => {
    paginas['/plano.pdf'] = {
      tipo: 'application/pdf',
      corpo: Buffer.from('%PDF-1.7 conteúdo'),
    };
    const f = (await painel.criarFonte(municipio, u, {
      entidade_id: aguas,
      titulo: 'Avarias e contactos',
      tipo: 'contactos',
      url: `${base}/plano.pdf`,
      ler_a_cada_horas: 24,
      leitura_automatica: true,
    })) as { id: string };
    await ingestao.correr({
      municipio_id: municipio,
      fonte_id: f.id,
      forcar: true,
    });
    let [fo] = await db.query<{ estado: string; erro: string }>(
      `SELECT estado, erro FROM fontes WHERE id = $1`,
      [f.id],
    );
    expect(fo).toEqual({ estado: 'erro', erro: ERRO_PDF });

    const colado = await painel.colarTexto(municipio, u, f.id, {
      texto:
        'Avarias de água\nEm caso de falta de água ligue para a linha de avarias 800 910 410, disponível 24 horas por dia.',
    });
    expect(colado.mudou).toBe(true);
    await ingestao.correr({
      municipio_id: municipio,
      fonte_id: f.id,
      forcar: true,
    });
    [fo] = await db.query(`SELECT estado, erro FROM fontes WHERE id = $1`, [
      f.id,
    ]);
    expect(fo).toEqual({ estado: 'em_dia', erro: null });

    // Contacto oficial ligado à versão colada, e uma página da câmara com outro número.
    await db.query(
      `INSERT INTO entidade_contactos (entidade_id, tipo, rotulo, valor, fonte_versao_id)
       VALUES ($1, 'avarias', 'Falta de água', '800 910 410', $2)`,
      [aguas, colado.versao_id],
    );
    paginas['/contactos'] = {
      tipo: 'text/html',
      corpo:
        '<main><h2>Contactos úteis</h2><p>Falta de água ou avarias: ligue 253 000 111 (Águas Municipais), todos os dias.</p></main>',
    };
    const c = (await painel.criarFonte(municipio, u, {
      entidade_id: camara,
      titulo: 'Contactos úteis',
      tipo: 'pagina',
      url: `${base}/contactos`,
      ler_a_cada_horas: 24,
      leitura_automatica: true,
    })) as { id: string };
    await ingestao.correr({
      municipio_id: municipio,
      fonte_id: c.id,
      forcar: true,
    });
  });

  it('deteta a contradição de contacto e não repete o par', async () => {
    expect(await contradicoes.correr({ municipio_id: municipio })).toBe(1);
    expect(await contradicoes.correr({ municipio_id: municipio })).toBe(0);
    const l = await painel.contradicoes(municipio, 'aberta', 10, null);
    expect(l.itens).toHaveLength(1);
    const c = l.itens[0] as any;
    expect(c.a.entidade).toBe('Águas Municipais');
    expect(c.b.entidade).toBe('Câmara Municipal');
    const atualizada = await painel.atualizarContradicao(municipio, u, c.id, {
      estado: 'resolvida',
    });
    expect((atualizada as any).estado).toBe('resolvida');
  });

  it('listas do painel respondem', async () => {
    const mapa = await painel.mapa(municipio);
    expect((mapa.resumo as any).respostas_no_ar).toBe(1);
    const resp = await painel.respostas(municipio, {}, 10, null);
    expect(resp.itens).toHaveLength(1);
    const fontes = await painel.fontes(municipio, {});
    expect(fontes.itens).toHaveLength(3);
    expect(fontes.ultima_ingestao).not.toBeNull();

    const [p] = await db.query<{ id: string }>(
      `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes) VALUES ($1, 'Posso pôr toldo?', 4) RETURNING id`,
      [municipio],
    );
    await db.query(
      `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes) VALUES ($1, 'Outra', 2), ($1, 'Mais', 1)`,
      [municipio],
    );
    const pg1 = await painel.semResposta(municipio, undefined, 2, null);
    expect(pg1.itens.map((x: any) => x.vezes)).toEqual([4, 2]);
    expect(pg1.proximo_cursor).not.toBeNull();
    const pg2 = await painel.semResposta(
      municipio,
      undefined,
      2,
      lerCursor(pg1.proximo_cursor!),
    );
    expect(pg2.itens.map((x: any) => x.vezes)).toEqual([1]);
    const pe = await painel.atualizarSemResposta(municipio, u, p.id, {
      estado: 'com_equipa',
      o_que_falta: 'Regra do património',
    });
    expect((pe as any).estado).toBe('com_equipa');

    await execucaoFalsa('v2', 4, { amostra: true, adaptador: 'tou-voz' });
    const q = (await painel.qualidade(municipio)) as any;
    expect(q.limiar).toBe(80);
    expect(q.versao_atual).toBe('v2');
    expect(q.publicacao).toMatchObject({
      pode_publicar: false,
      causa: 'outra_versao',
    });
    expect(q.ultima).toMatchObject({
      taxa: 90,
      perguntas: 10,
      passou: true,
      agente_versao: 'v1',
    });
    expect(q.ultima.categorias.map((c: any) => [c.categoria, c.taxa])).toEqual([
      ['Água', 80],
      ['Taxas', 100],
    ]);
    expect(q.evolucao.map((e: any) => e.taxa)).toEqual([100, 70, 90]);
    expect(q.erradas).toHaveLength(1);
    expect(q.erradas[0]).toMatchObject({
      ordem: 10,
      categoria: 'Água',
      veredicto: 'errada',
      factos_em_falta: ['preço'],
    });
    expect(q.voz).toMatchObject({ taxa: 40, latencia_media_ms: 1006 });
  });

  it('reindexar preenche vetores em falta', async () => {
    await db.query(
      `UPDATE trechos t SET embedding = NULL FROM fonte_versoes fv, fontes fo
       WHERE fv.id = t.fonte_versao_id AND fo.id = fv.fonte_id AND fo.municipio_id = $1`,
      [municipio],
    );
    const r = await indexacao.reindexar({ municipio_id: municipio });
    expect(r.trechos).toBeGreaterThan(3);
    expect(r.frases).toBe(0);
  });
});
