/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import type { Response } from 'superagent';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  linha,
  linhas,
  PNG_1PX,
} from './app';
import { ArmazenamentoService } from '../../src/modules/armazenamento/armazenamento.service';
import { GestaoDocumentalService } from '../../src/modules/integracoes/gestao-documental.service';
import { MosaicosOsmService } from '../../src/modules/integracoes/mosaicos-osm.service';
import { PlantaService } from '../../src/modules/integracoes/planta.service';

/**
 * Integrações (V2): gestão documental (adaptador simulado, job, reintentos,
 * painel) e planta de localização. Nada sai para a rede: os mosaicos do
 * OpenStreetMap vêm de um PNG local, a geocodificação é a falsa de app.ts e
 * o armazenamento é em memória (liga-se e desliga-se por teste).
 *
 * Município próprio deste ficheiro: ligar a gestão documental no 'teste'
 * mexia nos processos dos outros ficheiros.
 */

class MosaicosFalsos {
  falhar = false;
  readonly pedidos: string[] = [];
  obter(z: number, x: number, y: number): Promise<Buffer> {
    this.pedidos.push(`${z}/${x}/${y}`);
    if (this.falhar) return Promise.reject(new Error('sem rede'));
    return Promise.resolve(Buffer.from(PNG_1PX, 'base64'));
  }
}

class ArmazenamentoFalso {
  disponivel = true;
  readonly ficheiros = new Map<string, Buffer>();
  chave(slug: string, pasta: string, ext: string) {
    return `${slug}/${pasta}/${randomUUID()}.${ext}`;
  }
  guardar(chave: string, conteudo: Buffer) {
    this.ficheiros.set(chave, conteudo);
    return Promise.resolve();
  }
  urlLeitura(chave: string) {
    return Promise.resolve(`https://s3.falso/${chave}`);
  }
  ler(chave: string) {
    return Promise.resolve(this.ficheiros.get(chave)!);
  }
  apagar(chaves: string[]) {
    return Promise.resolve(chaves);
  }
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

/** Corpo binário (o PDF) como Buffer. */
function binario(res: Response, cb: (e: Error | null, b: Buffer) => void) {
  // Em Node, a resposta do superagent é o IncomingMessage (um stream).
  const stream = res as unknown as NodeJS.ReadableStream;
  const partes: Buffer[] = [];
  stream.on('data', (d: Buffer) => partes.push(d));
  stream.on('end', () => cb(null, Buffer.concat(partes)));
}

describe('Integrações (e2e)', () => {
  let ctx: Contexto;
  const mosaicos = new MosaicosFalsos();
  const armazenamento = new ArmazenamentoFalso();
  let gd: GestaoDocumentalService;
  let plantas: PlantaService;

  const municipioId = randomUUID();
  const slug = `int-${municipioId.slice(0, 8)}`;
  const tipoGd = randomUUID();
  const tipoPlanta = randomUUID();
  const docPlanta = randomUUID();
  let n = 0;
  let chefe: Record<string, string>;
  let interno: Record<string, string>;
  let tecnico: Record<string, string>;
  let atendimento: Record<string, string>;

  async function utilizador(perfil: string) {
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil) VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        municipioId,
        `${perfil}-${id.slice(0, 8)}@int.pt`,
        `Int ${perfil}`,
        perfil,
      ],
    );
    return entrarPainel(ctx, id);
  }

  async function processo(
    o: {
      tipo?: string;
      morada?: string | null;
      lat?: number;
      lng?: number;
    } = {},
  ) {
    const p = await linha<{ id: string; gd_estado: string }>(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, morada, lat, lng)
       VALUES ($1, $2, $3, 'Porta na fachada', $4, $5, $6) RETURNING id, gd_estado`,
      [
        municipioId,
        `CP ${++n}/2026`,
        o.tipo ?? tipoGd,
        o.morada === undefined ? 'Rua A, 1' : o.morada,
        o.lat ?? null,
        o.lng ?? null,
      ],
    );
    return p!;
  }

  const gdDe = (id: string) =>
    linha<{ gd_id: string | null; gd_estado: string; gd_tentativas: number }>(
      ctx.db,
      'SELECT gd_id, gd_estado, gd_tentativas FROM processos WHERE id = $1',
      [id],
    );

  const configurar = (corpo: object, h = interno) =>
    ctx
      .http()
      .put('/v1/painel/integracoes/gestao-documental')
      .set(h)
      .send(corpo);

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) =>
        b
          .overrideProvider(MosaicosOsmService)
          .useValue(mosaicos)
          .overrideProvider(ArmazenamentoService)
          .useValue(armazenamento),
    });
    gd = ctx.app.get(GestaoDocumentalService);
    plantas = ctx.app.get(PlantaService);
    const entidade = randomUUID();
    const servico = randomUUID();
    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Integrações E2E')`,
      [municipioId, slug],
    );
    await ctx.db.query(
      `INSERT INTO entidades (id, municipio_id, nome, tipo) VALUES ($1, $2, 'Câmara', 'camara')`,
      [entidade, municipioId],
    );
    await ctx.db.query(
      `INSERT INTO servicos (id, municipio_id, entidade_id, nome) VALUES ($1, $2, $3, 'Obras')`,
      [servico, municipioId, entidade],
    );
    for (const [id, codigo] of [
      [tipoGd, 'CP'],
      [tipoPlanta, 'LO'],
    ]) {
      await ctx.db.query(
        `INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, servico_id, formulario)
         VALUES ($1, $2, $3, 'Tipo E2E', 20, $4, '[]')`,
        [id, municipioId, codigo, servico],
      );
    }
    await ctx.db.query(
      `INSERT INTO tipo_processo_documentos (id, tipo_processo_id, nome, ordem, gerado_pelo_sistema)
       VALUES ($1, $2, 'Planta de localização', 1, true)`,
      [docPlanta, tipoPlanta],
    );
    chefe = await utilizador('chefe_divisao');
    interno = await utilizador('equipa_toucamara');
    tecnico = await utilizador('tecnico');
    atendimento = await utilizador('atendimento');
  });

  afterAll(() => ctx?.fechar());

  beforeEach(() => {
    mosaicos.falhar = false;
    mosaicos.pedidos.length = 0;
    armazenamento.disponivel = true;
  });

  describe('gestão documental', () => {
    let antigo: string;

    it('configuração: desligada por defeito; só a equipa interna liga', async () => {
      antigo = (await processo()).id;
      expect((await gdDe(antigo))!.gd_estado).toBe('nao_aplicavel');

      const r = await ctx
        .http()
        .get('/v1/painel/integracoes/gestao-documental')
        .set(chefe)
        .expect(estado(200));
      expect(r.body).toMatchObject({
        adaptador: 'nenhum',
        taxa_falha: 0,
        simulado: false,
        adaptadores_disponiveis: ['nenhum', 'simulado'],
      });

      const proibido = await configurar(
        { adaptador: 'simulado' },
        chefe,
      ).expect(estado(403));
      expect(proibido.body.erro.codigo).toBe('so_equipa_interna');
      await ctx
        .http()
        .get('/v1/painel/integracoes/gestao-documental')
        .set(tecnico)
        .expect(estado(403));
      const invalido = await configurar({ adaptador: 'mydoc' }).expect(
        estado(400),
      );
      expect(invalido.body.erro.codigo).toBe('pedido_invalido');

      const ligado = await configurar({
        adaptador: 'simulado',
        taxa_falha: 0,
      }).expect(estado(200));
      expect(ligado.body).toMatchObject({
        adaptador: 'simulado',
        simulado: true,
        processos_alterados: 1,
      });
      // O processo que já existia passa a estar à espera.
      expect((await gdDe(antigo))!.gd_estado).toBe('por_sincronizar');
      const audit = await linha(
        ctx.db,
        `SELECT dados FROM audit_log WHERE acao = 'configurar_gestao_documental' AND objeto_id = $1`,
        [municipioId],
      );
      expect(audit.dados.depois).toEqual({
        adaptador: 'simulado',
        taxa_falha: 0,
      });
    });

    it('processo novo fica por sincronizar; o job regista-o com número da câmara', async () => {
      const p = await processo();
      expect(p.gd_estado).toBe('por_sincronizar');

      const r = await gd.sincronizarPendentes();
      expect(r.sincronizados).toBeGreaterThanOrEqual(2);
      for (const id of [p.id, antigo]) {
        const g = await gdDe(id);
        expect(g).toMatchObject({
          gd_estado: 'sincronizado',
          gd_tentativas: 0,
        });
        expect(g!.gd_id).toMatch(/^\d{4}\/E\/\d{6}$/);
      }
      const g = await gdDe(p.id);
      const enviado = await linha(
        ctx.db,
        `SELECT operacao, conteudo FROM gd_simulado_registos WHERE municipio_id = $1 AND gd_id = $2`,
        [municipioId, g!.gd_id],
      );
      expect(enviado).toMatchObject({
        operacao: 'registar',
        conteudo: { id: p.id, fase: 'entrada', tipo_codigo: 'CP' },
      });

      // Nada mudou: a volta seguinte não envia nada.
      const antes = await linhas(
        ctx.db,
        'SELECT id FROM gd_envios WHERE processo_id = $1',
        [p.id],
      );
      await gd.sincronizarPendentes();
      expect(
        await linhas(
          ctx.db,
          'SELECT id FROM gd_envios WHERE processo_id = $1',
          [p.id],
        ),
      ).toHaveLength(antes.length);

      // Documento novo e mudança de fase: volta a 'por_sincronizar' e segue.
      const doc = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO documentos (municipio_id, processo_id, ficheiro_key, mime, origem)
         VALUES ($1, $2, 'int/doc.pdf', 'application/pdf', 'upload') RETURNING id`,
        [municipioId, p.id],
      );
      expect((await gdDe(p.id))!.gd_estado).toBe('por_sincronizar');
      await ctx.db.query(
        `UPDATE processos SET fase = 'apreciacao' WHERE id = $1`,
        [p.id],
      );
      await gd.sincronizarPendentes();
      expect((await gdDe(p.id))!.gd_estado).toBe('sincronizado');
      const ops = await linhas<{ operacao: string; conteudo: any }>(
        ctx.db,
        `SELECT operacao, conteudo FROM gd_simulado_registos WHERE gd_id = $1 AND municipio_id = $2 ORDER BY id`,
        [g!.gd_id, municipioId],
      );
      expect(ops.map((o) => o.operacao)).toEqual([
        'registar',
        'anexar',
        'estado',
      ]);
      expect(ops[1].conteudo).toMatchObject({
        id: doc!.id,
        ficheiro_key: 'int/doc.pdf',
      });
      expect(ops[2].conteudo).toEqual({ fase: 'apreciacao' });

      // A rede de segurança: sincronizado com um documento por enviar (sem trigger).
      await ctx.db.query(
        'ALTER TABLE documentos DISABLE TRIGGER documentos_gd',
      );
      try {
        await ctx.db.query(
          `INSERT INTO documentos (municipio_id, processo_id, ficheiro_key, mime, origem)
           VALUES ($1, $2, 'int/doc2.pdf', 'application/pdf', 'upload')`,
          [municipioId, p.id],
        );
      } finally {
        await ctx.db.query(
          'ALTER TABLE documentos ENABLE TRIGGER documentos_gd',
        );
      }
      expect((await gdDe(p.id))!.gd_estado).toBe('sincronizado');
      await gd.sincronizarPendentes();
      expect(
        await linhas(
          ctx.db,
          `SELECT 1 FROM gd_envios WHERE processo_id = $1 AND ficheiro_key = 'int/doc2.pdf'`,
          [p.id],
        ),
      ).toHaveLength(1);
    });

    it('falhas: erro, evento sync_erro interno, backoff; "sincronizar já" volta a tentar', async () => {
      await configurar({ adaptador: 'simulado', taxa_falha: 1 }).expect(
        estado(200),
      );
      const p = await processo();

      await gd.sincronizarPendentes();
      expect(await gdDe(p.id)).toMatchObject({
        gd_estado: 'erro',
        gd_tentativas: 1,
        gd_id: null,
      });
      const ev = await linhas(
        ctx.db,
        `SELECT descricao, interno, ator_tipo, dados FROM processo_eventos WHERE processo_id = $1 AND tipo = 'sync_erro'`,
        [p.id],
      );
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({
        interno: true,
        ator_tipo: 'sistema',
        dados: { tentativa: 1 },
      });
      expect(ev[0].descricao).toContain('tentativa 1 de 5');

      // Backoff: a volta seguinte ainda não tenta.
      await gd.sincronizarPendentes();
      expect((await gdDe(p.id))!.gd_tentativas).toBe(1);

      // Painel: estado.
      const e = await ctx
        .http()
        .get('/v1/painel/integracoes/gestao-documental/estado')
        .set(chefe)
        .expect(estado(200));
      expect(e.body).toMatchObject({
        adaptador: 'simulado',
        simulado: true,
        com_erro: 1,
        max_tentativas: 5,
        ultimo_erro: { processo_id: p.id, gd_tentativas: 1 },
      });
      expect(e.body.sincronizados).toBeGreaterThanOrEqual(2);
      expect(e.body.ultimo_erro.mensagem).toContain('simulada');

      // Forçar com o sistema ainda em baixo: tentativas recomeçam (1).
      const f = await ctx
        .http()
        .post(`/v1/painel/processos/${p.id}/sincronizar`)
        .set(tecnico)
        .expect(estado(200));
      expect(f.body).toMatchObject({ gd_estado: 'erro', gd_tentativas: 1 });

      // Depois de 5 falhas, o job desiste.
      await ctx.db.query(
        'UPDATE processos SET gd_tentativas = 5 WHERE id = $1',
        [p.id],
      );
      await ctx.db.query(
        'UPDATE gd_sincronizacoes SET proxima_tentativa_em = NULL WHERE processo_id = $1',
        [p.id],
      );
      await configurar({ adaptador: 'simulado', taxa_falha: 0 }).expect(
        estado(200),
      );
      await gd.sincronizarPendentes();
      expect((await gdDe(p.id))!.gd_estado).toBe('erro');

      // "Sincronizar já" com o sistema de volta.
      const ok = await ctx
        .http()
        .post(`/v1/painel/processos/${p.id}/sincronizar`)
        .set(chefe)
        .expect(estado(200));
      expect(ok.body).toMatchObject({
        gd_estado: 'sincronizado',
        gd_tentativas: 0,
        erro: null,
        enviados: { processo: true, documentos: 0, fase: false },
      });
      expect(ok.body.gd_id).toMatch(/^\d{4}\/E\/\d{6}$/);
    });

    it('sincronizar: 404, perfil sem processos e município sem integração', async () => {
      await ctx
        .http()
        .post(`/v1/painel/processos/${randomUUID()}/sincronizar`)
        .set(chefe)
        .expect(estado(404));
      const p = await processo();
      await ctx
        .http()
        .post(`/v1/painel/processos/${p.id}/sincronizar`)
        .set(atendimento)
        .expect(estado(403));

      const desligado = await configurar({ adaptador: 'nenhum' }).expect(
        estado(200),
      );
      expect(desligado.body.adaptador).toBe('nenhum');
      expect((await gdDe(p.id))!.gd_estado).toBe('nao_aplicavel');
      const r = await ctx
        .http()
        .post(`/v1/painel/processos/${p.id}/sincronizar`)
        .set(chefe)
        .expect(estado(409));
      expect(r.body.erro.codigo).toBe('gestao_documental_desligada');
      // Desligado, os processos novos não ficam à espera.
      expect((await processo()).gd_estado).toBe('nao_aplicavel');
    });
  });

  describe('planta de localização', () => {
    const gerar = (id: string, corpo: object = {}, h = tecnico) =>
      ctx.http().post(`/v1/painel/processos/${id}/planta`).set(h).send(corpo);

    it('geocodifica a morada, compõe o PDF e guarda como documento do processo', async () => {
      ctx.geo.moradas.set('Rua da Planta, 7', { lat: 41.4479, lng: -8.2902 });
      const p = await processo({
        tipo: tipoPlanta,
        morada: 'Rua da Planta, 7',
      });

      const r = await gerar(p.id).expect(estado(201));
      expect(r.body).toMatchObject({
        lat: 41.4479,
        lng: -8.2902,
        geocodificada: true,
        zoom: 17,
        documento: {
          processo_id: p.id,
          tipo_documento_id: docPlanta,
          mime: 'application/pdf',
          origem: 'gerado',
          verificacao_estado: 'valido',
        },
      });
      expect(r.body.url).toMatch(/^https:\/\/s3\.falso\//);
      expect(mosaicos.pedidos).toHaveLength(9);
      expect(mosaicos.pedidos.every((t) => t.startsWith('17/'))).toBe(true);

      const d = await linha<{ ficheiro_key: string; tamanho: number }>(
        ctx.db,
        'SELECT ficheiro_key, tamanho FROM documentos WHERE id = $1',
        [r.body.documento.id],
      );
      const pdf = armazenamento.ficheiros.get(d!.ficheiro_key)!;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(d!.tamanho).toBe(pdf.length);
      expect(d!.ficheiro_key).toContain(`${slug}/documentos/`);

      // As coordenadas ficam no processo; a seguinte já não geocodifica.
      expect(
        await linha(ctx.db, 'SELECT lat, lng FROM processos WHERE id = $1', [
          p.id,
        ]),
      ).toEqual({ lat: 41.4479, lng: -8.2902 });
      const pedidosGeo = ctx.geo.pedidos.length;
      const r2 = await gerar(p.id, { zoom: 18 }).expect(estado(201));
      expect(r2.body.geocodificada).toBe(false);
      expect(ctx.geo.pedidos).toHaveLength(pedidosGeo);
    });

    it('sem armazenamento: o PDF vem na resposta e não fica nada guardado', async () => {
      armazenamento.disponivel = false;
      const p = await processo({ tipo: tipoPlanta, lat: 41.45, lng: -8.29 });
      const r = await gerar(p.id)
        .buffer(true)
        .parse(binario)
        .expect(estado(200));
      expect(r.headers['content-type']).toBe('application/pdf');
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect(
        await linhas(
          ctx.db,
          'SELECT 1 FROM documentos WHERE processo_id = $1',
          [p.id],
        ),
      ).toHaveLength(0);
    });

    it('sem mapa: 503 mapa_indisponivel, sem documento', async () => {
      mosaicos.falhar = true;
      const p = await processo({ tipo: tipoPlanta, lat: 41.45, lng: -8.29 });
      const r = await gerar(p.id).expect(estado(503));
      expect(r.body.erro.codigo).toBe('mapa_indisponivel');
      expect(
        await linhas(
          ctx.db,
          'SELECT 1 FROM documentos WHERE processo_id = $1',
          [p.id],
        ),
      ).toHaveLength(0);
    });

    it('sem morada, morada desconhecida, zoom inválido, 404 e perfil', async () => {
      const semMorada = await processo({ tipo: tipoPlanta, morada: null });
      expect(
        (await gerar(semMorada.id).expect(estado(422))).body.erro.codigo,
      ).toBe('processo_sem_morada');
      const desconhecida = await processo({
        tipo: tipoPlanta,
        morada: 'Rua Que Não Existe',
      });
      expect(
        (await gerar(desconhecida.id).expect(estado(422))).body.erro.codigo,
      ).toBe('morada_nao_encontrada');
      expect(mosaicos.pedidos).toHaveLength(0);
      await gerar(desconhecida.id, { zoom: 5 }).expect(estado(400));
      await gerar(randomUUID()).expect(estado(404));
      await gerar(semMorada.id, {}, atendimento).expect(estado(403));
    });

    it('job: gera a planta em falta uma vez; falhas ficam com tentativas', async () => {
      const p = await processo({ tipo: tipoPlanta, lat: 41.44, lng: -8.3 });
      await plantas.gerarEmFalta(50);
      const docs = await linhas(
        ctx.db,
        `SELECT origem, tipo_documento_id FROM documentos WHERE processo_id = $1`,
        [p.id],
      );
      expect(docs).toEqual([
        { origem: 'gerado', tipo_documento_id: docPlanta },
      ]);
      await plantas.gerarEmFalta(50);
      expect(
        await linhas(
          ctx.db,
          'SELECT 1 FROM documentos WHERE processo_id = $1',
          [p.id],
        ),
      ).toHaveLength(1);

      mosaicos.falhar = true;
      const q = await processo({ tipo: tipoPlanta, lat: 41.44, lng: -8.3 });
      await plantas.gerarEmFalta(50);
      expect(
        await linha(
          ctx.db,
          'SELECT tentativas FROM planta_tentativas WHERE processo_id = $1',
          [q.id],
        ),
      ).toEqual({ tentativas: 1 });
      // Não volta a tentar logo a seguir.
      await plantas.gerarEmFalta(50);
      expect(
        await linha(
          ctx.db,
          'SELECT tentativas FROM planta_tentativas WHERE processo_id = $1',
          [q.id],
        ),
      ).toEqual({ tentativas: 1 });

      armazenamento.disponivel = false;
      expect(await plantas.gerarEmFalta(50)).toMatchObject({
        sem_armazenamento: true,
      });
    });
  });
});
