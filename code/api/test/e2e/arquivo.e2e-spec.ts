/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
import { ArmazenamentoService } from '../../src/modules/armazenamento/armazenamento.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  esperarAte,
  ferramenta,
  linha,
  MUNICIPIO_ID,
  novaChamada,
  PNG_1PX,
  smsPara,
  TIPO_CP_ID,
} from './app';

/** Armazenamento em memória: o "browser" põe o ficheiro no mapa pela chave. */
class ArmazenamentoFalso {
  disponivel = true;
  readonly ficheiros = new Map<string, Buffer>();
  chave(slug: string, pasta: string, ext: string) {
    return `${slug}/${pasta}/${randomUUID()}.${ext}`;
  }
  urlEnvio(chave: string) {
    return Promise.resolve(`https://s3.falso/envio/${chave}`);
  }
  urlLeitura(chave: string) {
    return Promise.resolve(`https://s3.falso/${chave}`);
  }
  guardar(chave: string, conteudo: Buffer) {
    this.ficheiros.set(chave, conteudo);
    return Promise.resolve();
  }
  ler(chave: string) {
    const f = this.ficheiros.get(chave);
    return f ? Promise.resolve(f) : Promise.reject(new Error('NoSuchKey'));
  }
  apagar(chaves: string[]) {
    return Promise.resolve(chaves);
  }
}

function pdf(paginas: string[]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const partes: Buffer[] = [];
    doc.on('data', (d: Buffer) => partes.push(d));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    paginas.forEach((p, i) => {
      if (i) doc.addPage();
      doc.font('Helvetica').text(p);
    });
    doc.end();
  });
}

function novoNif(): string {
  const base = `2${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const soma = [...base].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const controlo = 11 - (soma % 11);
  return `${base}${controlo >= 10 ? 0 : controlo}`;
}

/** `.expect(estado(200))`, com o corpo na mensagem de erro. */
function estado(esperado: number) {
  return (r: { status: number; body: unknown }) => {
    if (r.status !== esperado) {
      throw new Error(
        `Esperava ${esperado}, veio ${r.status}: ${JSON.stringify(r.body)}`,
      );
    }
  };
}

const REQUERIMENTO = [
  'Câmara Municipal de Guimarães',
  'Processo de obras n.º 123/1987',
  'Exmo. Senhor Presidente da Câmara Municipal',
  'José da Silva Conceição, casado, residente na Rua de Santo António, n.º 45, freguesia de Oliveira do Castelo, deste concelho, vem requerer a V. Ex.ª licença de construção de uma moradia unifamiliar no prédio urbano sito na Rua de Santo António, 45, inscrito na matriz predial urbana sob o artigo 1234 da freguesia de Oliveira do Castelo.',
  'Guimarães, 12 de março de 1987',
].join('\n');

const OUTRO = [
  'Processo n.º 88/1992',
  'Requerente: Maria Fernanda Costa; Morada: Travessa do Picoto, 3; freguesia de Azurém.',
  'Pedido de licença de utilização para habitação da fração do rés-do-chão, com vistoria marcada.',
].join('\n');

/**
 * Arquivo antigo: digitalizações em lotes (S3), texto da camada do PDF,
 * metadados sem IA, pesquisa com excertos, mesma morada de um processo
 * novo, pedido de consulta pelo agente (LADA, SMS), painel dos pedidos,
 * permissões e registo de acessos.
 */
describe('Arquivo antigo (e2e)', () => {
  let ctx: Contexto;
  const s3 = new ArmazenamentoFalso();
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  let atendimento: Record<string, string>;
  let vereador: Record<string, string>;
  let docId: string;

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) => b.overrideProvider(ArmazenamentoService).useValue(s3),
    });
    chefe = await entrarPainel(ctx);
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
    atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    vereador = await entrarPainel(ctx, await criarUtilizador(ctx, 'vereador'));
  });
  afterAll(() => ctx.fechar());
  afterEach(() => {
    s3.disponivel = true;
  });

  /** Cria um lote e "envia" os ficheiros (como o browser faria com o PUT). */
  async function carregar(
    ficheiros: { nome: string; mime: string; bytes: Buffer }[],
  ) {
    const r = await ctx
      .http()
      .post('/v1/painel/arquivo/lotes')
      .set(tecnico)
      .send({
        nome: `Caixa ${randomInt(1, 999)}`,
        ficheiros: ficheiros.map((f) => ({ nome: f.nome, mime: f.mime })),
      })
      .expect(estado(201));
    r.body.documentos.forEach((d: { ficheiro_key: string }, i: number) =>
      s3.ficheiros.set(d.ficheiro_key, ficheiros[i].bytes),
    );
    return r.body;
  }

  it('sem S3: carregar responde 503 com a explicação', async () => {
    s3.disponivel = false;
    const r = await ctx
      .http()
      .post('/v1/painel/arquivo/lotes')
      .set(tecnico)
      .send({
        nome: 'Caixa 1',
        ficheiros: [{ nome: 'a.pdf', mime: 'application/pdf' }],
      })
      .expect(503);
    expect(r.body.erro.codigo).toBe('armazenamento_indisponivel');
    expect(r.body.erro.mensagem).toContain('S3');
  });

  it('PDF com camada de texto → texto e metadados sem IA → processado', async () => {
    const lote = await carregar([
      {
        nome: 'obra-123-1987.pdf',
        mime: 'application/pdf',
        bytes: await pdf([REQUERIMENTO, 'Planta do rés-do-chão e alçados.']),
      },
    ]);
    expect(lote.documentos[0].url_envio).toContain('https://s3.falso/envio/');
    docId = lote.documentos[0].id;

    const r = await ctx
      .http()
      .post(`/v1/painel/arquivo/documentos/${docId}/processar`)
      .set(tecnico)
      .expect(estado(200));
    expect(r.body).toMatchObject({
      estado: 'processado',
      texto_origem: 'camada_texto',
      metadados_origem: 'regras',
      por_transcrever: false,
      paginas: 2,
      tipo_nome: expect.stringContaining('Obras'),
      metadados: {
        numero_antigo: '123/1987',
        ano: 1987,
        tipo: 'obras',
        requerente: 'José da Silva Conceição',
        morada: 'Rua de Santo António, 45',
        freguesia: 'Oliveira do Castelo',
        artigo_matricial: '1234',
      },
    });
    expect(r.body.texto).toContain('licença de construção');
  });

  it('lote processado pela fila; imagem sem IA fica por transcrever e transcreve-se à mão', async () => {
    const lote = await carregar([
      {
        nome: 'utilizacao-88-1992.pdf',
        mime: 'application/pdf',
        bytes: await pdf([OUTRO]),
      },
      {
        nome: 'folha-solta.png',
        mime: 'image/png',
        bytes: Buffer.from(PNG_1PX, 'base64'),
      },
    ]);
    const fila = await ctx
      .http()
      .post(`/v1/painel/arquivo/lotes/${lote.lote.id}/processar`)
      .set(tecnico)
      .expect(estado(200));
    expect(fila.body.em_fila).toBe(2);
    const [pdfId, pngId] = lote.documentos.map((d: { id: string }) => d.id);
    await esperarAte(() =>
      linha(
        ctx.db,
        `SELECT 1 FROM arquivo_documentos WHERE id = ANY($1::uuid[]) AND estado = 'processado'
         HAVING count(*) = 2`,
        [[pdfId, pngId]],
      ),
    );

    const png = await ctx
      .http()
      .get(`/v1/painel/arquivo/documentos/${pngId}`)
      .set(tecnico)
      .expect(200);
    expect(png.body).toMatchObject({
      estado: 'processado',
      por_transcrever: true,
      texto: null,
      erro: expect.stringContaining('por transcrever'),
    });

    const t = await ctx
      .http()
      .put(`/v1/painel/arquivo/documentos/${pngId}/texto`)
      .set(tecnico)
      .send({
        texto:
          'Proc. n.º 7/75. Requerente: Joaquim Pereira Lopes. Pedido de demolição de um anexo na Rua da Liberdade, 10.',
      })
      .expect(200);
    expect(t.body).toMatchObject({
      por_transcrever: false,
      texto_origem: 'manual',
      metadados: { numero_antigo: '7/75', ano: 1975, tipo: 'demolicao' },
    });

    const lotes = await ctx
      .http()
      .get('/v1/painel/arquivo/lotes')
      .set(tecnico)
      .expect(200);
    expect(
      lotes.body.lotes.find((l: { id: string }) => l.id === lote.lote.id),
    ).toMatchObject({
      total: 2,
      por_processar: 0,
      por_transcrever: 0,
    });
  });

  it('pesquisa por texto (sem acentos) e por metadados, com excertos', async () => {
    const q = await ctx
      .http()
      .get('/v1/painel/arquivo')
      .query({ q: 'licenca construcao moradia' })
      .set(tecnico)
      .expect(200);
    const achado = q.body.itens.find((d: { id: string }) => d.id === docId);
    expect(achado).toBeDefined();
    expect(achado.encontrado_por).toEqual(['texto']);
    expect(achado.excertos[0].texto).toContain('licença de construção');
    expect(achado.excertos[0].destaques.length).toBeGreaterThan(0);
    expect(q.body.semelhanca).toBe(false);

    const filtros = await ctx
      .http()
      .get('/v1/painel/arquivo')
      .query({
        ano: 1987,
        freguesia: 'oliveira do castelo',
        tipo: 'obras',
        morada: 'R. Santo Antonio',
      })
      .set(tecnico)
      .expect(200);
    expect(filtros.body.itens.map((d: { id: string }) => d.id)).toContain(
      docId,
    );

    const outroAno = await ctx
      .http()
      .get('/v1/painel/arquivo')
      .query({ q: 'moradia', ano: 1992 })
      .set(tecnico)
      .expect(200);
    expect(outroAno.body.itens.map((d: { id: string }) => d.id)).not.toContain(
      docId,
    );

    const numero = await ctx
      .http()
      .get('/v1/painel/arquivo?q=123/1987')
      .set(tecnico)
      .expect(200);
    expect(numero.body.itens[0].id).toBe(docId);
  });

  it('rever: o funcionário corrige e confirma os metadados', async () => {
    const r = await ctx
      .http()
      .post(`/v1/painel/arquivo/documentos/${docId}/rever`)
      .set(tecnico)
      .send({ requerente: 'José da Silva Conceição Júnior' })
      .expect(estado(200));
    expect(r.body).toMatchObject({
      estado: 'revisto',
      metadados_origem: 'manual',
      revisto_por: 'Teste tecnico',
      metadados: { requerente: 'José da Silva Conceição Júnior', ano: 1987 },
    });
    // Voltar a processar não desfaz a revisão.
    const p = await ctx
      .http()
      .post(`/v1/painel/arquivo/documentos/${docId}/processar`)
      .set(tecnico)
      .expect(200);
    expect(p.body.estado).toBe('revisto');
    expect(p.body.metadados.requerente).toBe('José da Silva Conceição Júnior');
  });

  it('processos na mesma morada: do processo novo para o arquivo, e ligar', async () => {
    const proc = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, morada)
       VALUES ($1, $2, $3, 'Ampliação da moradia', 'R. Santo Antonio, nº 45, 4810-000 Guimarães')
       RETURNING id`,
      [MUNICIPIO_ID, `CP ${randomInt(5000, 9999)}/2026`, TIPO_CP_ID],
    );
    const vizinho = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, morada)
       VALUES ($1, $2, $3, 'Muro', 'Rua de Santo António, 47') RETURNING id`,
      [MUNICIPIO_ID, `CP ${randomInt(5000, 9999)}/2026`, TIPO_CP_ID],
    );

    const r = await ctx
      .http()
      .get(`/v1/painel/arquivo/processos/${proc!.id}/mesma-morada`)
      .set(tecnico)
      .expect(200);
    expect(r.body.chave_morada).toEqual({
      rua: 'rua santo antonio',
      porta: '45',
    });
    const d = r.body.documentos.find((x: { id: string }) => x.id === docId);
    expect(d).toMatchObject({ ligado: false, mesma_porta: true });

    const outro = await ctx
      .http()
      .get(`/v1/painel/arquivo/processos/${vizinho!.id}/mesma-morada`)
      .set(tecnico)
      .expect(200);
    expect(
      outro.body.documentos.map((x: { id: string }) => x.id),
    ).not.toContain(docId);

    const det = await ctx
      .http()
      .get(`/v1/painel/arquivo/documentos/${docId}`)
      .set(tecnico)
      .expect(200);
    expect(
      det.body.processos_mesma_morada.map((p: { id: string }) => p.id),
    ).toEqual(expect.arrayContaining([proc!.id]));
    expect(
      det.body.processos_mesma_morada.map((p: { id: string }) => p.id),
    ).not.toContain(vizinho!.id);

    await ctx
      .http()
      .post(`/v1/painel/arquivo/documentos/${docId}/ligar`)
      .set(tecnico)
      .send({ processos: [proc!.id] })
      .expect(200);
    const depois = await ctx
      .http()
      .get(`/v1/painel/arquivo/processos/${proc!.id}/mesma-morada`)
      .set(tecnico)
      .expect(200);
    expect(depois.body.documentos[0]).toMatchObject({
      id: docId,
      ligado: true,
    });
  });

  it('pedir_consulta_arquivo: conta sem revelar, pede NIF, LADA, modalidade, confirma; SMS; painel trata', async () => {
    const chamada = novaChamada('arq');
    const procura = { morada: 'Rua de Santo António', ano: 1987 };

    const r1 = await ferramenta(
      ctx,
      chamada,
      'pedir_consulta_arquivo',
      procura,
    ).expect(estado(200));
    expect(r1.body).toMatchObject({
      registado: false,
      motivo: 'precisa_identificacao',
      documentos_provaveis: 1,
      encontrados_dizer: expect.stringContaining('um documento'),
    });
    // Nada dos documentos de terceiros sai para o agente.
    const tudo = JSON.stringify(r1.body);
    expect(tudo).not.toContain('Conceição');
    expect(tudo).not.toContain('123/1987');
    expect(tudo).not.toContain(docId);

    const nada = await ferramenta(ctx, chamada, 'pedir_consulta_arquivo', {
      morada: 'Rua Inexistente do Nunca',
    }).expect(200);
    expect(nada.body.documentos_provaveis).toBe(0);

    await ferramenta(ctx, chamada, 'identificar_municipe', {
      nif: novoNif(),
      nome: 'Rui Matos',
    }).expect(estado(200));

    const r2 = await ferramenta(
      ctx,
      chamada,
      'pedir_consulta_arquivo',
      procura,
    ).expect(200);
    expect(r2.body).toMatchObject({
      registado: false,
      motivo: 'falta_qualidade',
      lei_a_confirmar: true,
    });
    expect(r2.body.lei).toContain('26/2016');

    const r3 = await ferramenta(ctx, chamada, 'pedir_consulta_arquivo', {
      ...procura,
      qualidade: 'interesse_legitimo',
    }).expect(200);
    expect(r3.body.motivo).toBe('falta_interesse');

    const comInteresse = {
      ...procura,
      qualidade: 'interesse_legitimo',
      interesse: 'Vou comprar a casa e preciso da planta aprovada',
    };
    const r4 = await ferramenta(
      ctx,
      chamada,
      'pedir_consulta_arquivo',
      comInteresse,
    ).expect(200);
    expect(r4.body).toMatchObject({
      motivo: 'falta_modalidade',
      valores_de_demonstracao: true,
      opcoes: {
        presencial: expect.stringContaining('Arquivo Municipal'),
        copia_certificada: expect.stringContaining('valor de demonstração'),
      },
    });

    const r5 = await ferramenta(ctx, chamada, 'pedir_consulta_arquivo', {
      ...comInteresse,
      modalidade: 'presencial',
    }).expect(200);
    expect(r5.body.motivo).toBe('falta_confirmar');
    expect(r5.body.ler_a_pessoa).toContain('Rui Matos');
    expect(await smsPara(ctx, chamada.telefone, 'processo')).toHaveLength(0);

    const r6 = await ferramenta(ctx, chamada, 'pedir_consulta_arquivo', {
      ...comInteresse,
      modalidade: 'presencial',
      confirmado: true,
    }).expect(estado(200));
    expect(r6.body).toMatchObject({
      registado: true,
      numero: expect.stringMatching(/^ARQ \d+\/\d{4}$/),
      documentos_provaveis: 1,
      prazo_dias_uteis: 10,
      valores_de_demonstracao: true,
      sms_enviado: true,
      dizer: expect.stringContaining('ficou registado com o número'),
    });
    expect(r6.body.lei).toContain('a confirmar');
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms).toHaveLength(1);
    expect(sms[0].corpo).toContain(r6.body.numero);

    const audit = await linha(
      ctx.db,
      `SELECT ator_tipo FROM audit_log WHERE acao = 'pedir_consulta_arquivo' ORDER BY em DESC LIMIT 1`,
    );
    expect(audit?.ator_tipo).toBe('agente');

    // Painel: quem atende vê o pedido, mas não o conteúdo dos documentos.
    const lista = await ctx
      .http()
      .get('/v1/painel/arquivo/pedidos?estado=abertos')
      .set(atendimento)
      .expect(200);
    const p = lista.body.pedidos.find(
      (x: { numero: string }) => x.numero === r6.body.numero,
    );
    expect(p).toMatchObject({
      estado: 'recebido',
      qualidade: 'interesse_legitimo',
      modalidade: 'presencial',
      documentos_provaveis: 1,
      nome: 'Rui Matos',
      valores_de_demonstracao: true,
    });
    expect(p.telefone).not.toBe(chamada.telefone);
    expect(lista.body.contagens.recebido).toBeGreaterThanOrEqual(1);

    const det = await ctx
      .http()
      .get(`/v1/painel/arquivo/pedidos/${p.id}`)
      .set(atendimento)
      .expect(200);
    expect(det.body.pode_ver_documentos).toBe(false);
    expect(det.body.documentos).toEqual([
      expect.objectContaining({
        id: docId,
        metadados: { numero_antigo: '123/1987', ano: 1987, tipo: 'obras' },
      }),
    ]);
    expect(JSON.stringify(det.body.documentos)).not.toContain('Conceição');
    const detTecnico = await ctx
      .http()
      .get(`/v1/painel/arquivo/pedidos/${p.id}`)
      .set(tecnico)
      .expect(200);
    expect(detTecnico.body.documentos[0].metadados.requerente).toContain(
      'Conceição',
    );

    const amanha = new Date(Date.now() + 2 * 86_400_000);
    amanha.setUTCHours(10, 0, 0, 0);
    const marcado = await ctx
      .http()
      .post(`/v1/painel/arquivo/pedidos/${p.id}/atender`)
      .set(atendimento)
      .send({ acao: 'marcar', quando: amanha.toISOString() })
      .expect(estado(200));
    expect(marcado.body).toMatchObject({
      estado: 'agendado',
      local: 'Arquivo Municipal (com marcação prévia)',
    });
    const sms2 = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms2).toHaveLength(2);
    expect(sms2[1].corpo).toContain('marcada para');
    expect(marcado.body.mensagens).toHaveLength(2);

    const fim = await ctx
      .http()
      .post(`/v1/painel/arquivo/pedidos/${p.id}/encerrar`)
      .set(atendimento)
      .send({ resultado: 'consultado' })
      .expect(200);
    expect(fim.body).toMatchObject({
      estado: 'encerrado',
      resultado: 'consultado',
    });
    await ctx
      .http()
      .post(`/v1/painel/arquivo/pedidos/${p.id}/encerrar`)
      .set(atendimento)
      .send({ resultado: 'consultado' })
      .expect(409);
  });

  it('cópia certificada: preparar (taxa de demonstração) e pronta; recusar pede o motivo', async () => {
    const chamada = novaChamada('arq');
    await ferramenta(ctx, chamada, 'identificar_municipe', {
      nif: novoNif(),
    }).expect(200);
    const r = await ferramenta(ctx, chamada, 'pedir_consulta_arquivo', {
      requerente: 'Maria Fernanda Costa',
      qualidade: 'titular',
      modalidade: 'copia_certificada',
      confirmado: true,
    }).expect(estado(200));
    expect(r.body).toMatchObject({ registado: true, documentos_provaveis: 1 });
    const [{ id }] = (
      await ctx.db.query('SELECT id FROM arquivo_pedidos WHERE numero = $1', [
        r.body.numero,
      ])
    ).rows;

    const prep = await ctx
      .http()
      .post(`/v1/painel/arquivo/pedidos/${id}/atender`)
      .set(atendimento)
      .send({ acao: 'preparar_copia', paginas: 4 })
      .expect(estado(200));
    expect(prep.body).toMatchObject({
      estado: 'em_preparacao',
      paginas: 4,
      taxa_cents: 650,
      taxa: '6,50 €',
    });
    const pronta = await ctx
      .http()
      .post(`/v1/painel/arquivo/pedidos/${id}/atender`)
      .set(atendimento)
      .send({ acao: 'copia_pronta' })
      .expect(200);
    expect(pronta.body.estado).toBe('pronto');
    const sms = await smsPara(ctx, chamada.telefone, 'processo');
    expect(sms.at(-1)!.corpo).toContain('está pronta');
    expect(sms.at(-1)!.corpo).toContain('valor de demonstração');

    const semNota = await ctx
      .http()
      .post(`/v1/painel/arquivo/pedidos/${id}/encerrar`)
      .set(atendimento)
      .send({ resultado: 'recusado' })
      .expect(400);
    expect(semNota.body.erro.codigo).toBe('falta_nota');
  });

  it('permissões: quem atende só trata pedidos; o vereador não entra', async () => {
    const pesquisa = await ctx
      .http()
      .get('/v1/painel/arquivo?q=moradia')
      .set(atendimento)
      .expect(403);
    expect(pesquisa.body.erro.codigo).toBe('sem_permissao');
    await ctx
      .http()
      .post('/v1/painel/arquivo/lotes')
      .set(atendimento)
      .send({
        nome: 'Caixa',
        ficheiros: [{ nome: 'a.pdf', mime: 'application/pdf' }],
      })
      .expect(403);
    await ctx
      .http()
      .get(`/v1/painel/arquivo/documentos/${docId}`)
      .set(atendimento)
      .expect(403);
    await ctx
      .http()
      .get('/v1/painel/arquivo/pedidos')
      .set(atendimento)
      .expect(200);
    await ctx
      .http()
      .get('/v1/painel/arquivo/pedidos')
      .set(vereador)
      .expect(403);
    await ctx.http().get('/v1/painel/arquivo?q=x').set(chefe).expect(200);
    // Prazos e taxas: só a chefia.
    await ctx
      .http()
      .put('/v1/painel/arquivo/config')
      .set(tecnico)
      .send({})
      .expect(403);
    const eu = await ctx
      .http()
      .get('/v1/painel/auth/eu')
      .set(atendimento)
      .expect(200);
    expect(eu.body.permissoes.arquivo).toBe(true);
    const euV = await ctx
      .http()
      .get('/v1/painel/auth/eu')
      .set(vereador)
      .expect(200);
    expect(euV.body.permissoes.arquivo).toBe(false);
  });

  it('cada consulta de um documento fica no registo de acessos (dado pessoal)', async () => {
    await ctx
      .http()
      .get(`/v1/painel/arquivo/documentos/${docId}`)
      .set(chefe)
      .expect(200);
    const f = await ctx
      .http()
      .get(`/v1/painel/arquivo/documentos/${docId}/ficheiro`)
      .set(chefe)
      .expect(200);
    expect(f.body).toMatchObject({
      url: expect.stringContaining('https://s3.falso/'),
      valido_minutos: 5,
    });

    const vistos = (
      await ctx.db.query(
        `SELECT dados FROM audit_log
         WHERE acao = 'ver' AND objeto_tipo = 'documento_arquivo' AND objeto_id = $1
         ORDER BY em`,
        [docId],
      )
    ).rows as { dados: { ficheiro?: boolean } }[];
    expect(vistos.length).toBeGreaterThanOrEqual(2);
    expect(vistos.some((v) => v.dados.ficheiro === true)).toBe(true);

    const acessos = await ctx
      .http()
      .get('/v1/painel/equipa/acessos?so_dados_pessoais=true')
      .set(chefe)
      .expect(200);
    expect(acessos.body.itens[0]).toMatchObject({
      acao: 'ver',
      frase: 'viu um documento do arquivo antigo',
      dados_pessoais: true,
    });
    const pesquisas = await linha(
      ctx.db,
      `SELECT count(*)::int AS n FROM audit_log WHERE acao = 'pesquisar_arquivo'`,
    );
    expect(pesquisas.n).toBeGreaterThan(0);
  });
});
