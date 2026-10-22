/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { generateKeyPairSync, randomInt } from 'crypto';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  esperarAte,
  linha,
  linhas,
  MUNICIPIO,
  MUNICIPIO_ID,
  novoTelefone,
  smsPara,
  TIPO_CP_ID,
} from './app';
import { WEB_URL } from './ambiente';
import {
  ClienteFcm,
  URL_TOKEN_GOOGLE,
} from '../../src/modules/app-municipe/fcm';
import { PushService } from '../../src/modules/app-municipe/push.service';

function novoIp(): string {
  return `203.0.113.${randomInt(1, 255)}`;
}

function novoFcm(): string {
  return `fcm-${randomInt(1e9)}-${'x'.repeat(40)}`;
}

/**
 * App do munícipe: entrar com o telemóvel (código por SMS → sessão), os
 * dados da própria pessoa, registo do telemóvel e push (modo consola) num
 * aviso por zona, numa emergência e numa mudança de fase do processo;
 * token FCM inválido desativa o telemóvel; sair revoga; limites; painel.
 */
describe('App do munícipe (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  // Longe das coordenadas dos outros ficheiros.
  const base = {
    lat: 38.2 + Math.random() * 0.2,
    lng: -8.9 + Math.random() * 0.2,
  };
  const letras = Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + randomInt(26)),
  ).join('');

  const A = { tel: novoTelefone(), token: '', id: '' };
  const B = { tel: novoTelefone(), token: '', id: '' };

  const pedirCodigo = (telefone: string, ip = novoIp()) =>
    ctx
      .http()
      .post('/v1/public/app/codigo')
      .set('X-Forwarded-For', ip)
      .send({ municipio: MUNICIPIO, telefone });

  async function codigoDoSms(telefone: string): Promise<string> {
    const sms = await smsPara(ctx, telefone, 'identificacao');
    const codigo = /\b(\d{6})\b/.exec(sms[sms.length - 1].corpo)?.[1];
    expect(codigo).toBeDefined();
    return codigo!;
  }

  async function entrar(telefone: string, dispositivo = 'Telemóvel de teste') {
    await pedirCodigo(telefone).expect(202);
    const codigo = await codigoDoSms(telefone);
    const r = await ctx
      .http()
      .post('/v1/public/app/entrar')
      .send({ municipio: MUNICIPIO, telefone, codigo, dispositivo })
      .expect(201);
    return r.body as {
      token: string;
      sessao_id: string;
      municipe: { telefone: string };
    };
  }

  const app = (token: string) => ({
    get: (c: string) =>
      ctx.http().get(`/v1/app/${c}`).set('Authorization', `Bearer ${token}`),
    post: (c: string, corpo: object = {}) =>
      ctx
        .http()
        .post(`/v1/app/${c}`)
        .set('Authorization', `Bearer ${token}`)
        .send(corpo),
    put: (c: string, corpo: object) =>
      ctx
        .http()
        .put(`/v1/app/${c}`)
        .set('Authorization', `Bearer ${token}`)
        .send(corpo),
    delete: (c: string) =>
      ctx.http().delete(`/v1/app/${c}`).set('Authorization', `Bearer ${token}`),
  });

  const pushes = (municipeId: string, origem: string) =>
    linhas(
      ctx.db,
      `SELECT tipo, origem, titulo, corpo, dados, estado, dispositivo_id
       FROM push_enviados WHERE municipe_id = $1 AND origem = $2 ORDER BY criado_em`,
      [municipeId, origem],
    );

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  describe('entrar com o telemóvel', () => {
    it('código por SMS (só o hash na BD) → entrar → token da sessão; cria o munícipe', async () => {
      const p = await pedirCodigo(A.tel).expect(202);
      expect(p.body).toMatchObject({
        enviado: true,
        telefone: expect.stringMatching(/^\+351 9•• ••• \d{3}$/),
      });
      const codigo = await codigoDoSms(A.tel);
      const guardado = await linha(
        ctx.db,
        `SELECT codigo_hash FROM app_codigos WHERE telefone_e164 = $1`,
        [A.tel],
      );
      expect(Buffer.from(guardado!.codigo_hash).toString()).not.toContain(
        codigo,
      );

      const errado = await ctx
        .http()
        .post('/v1/public/app/entrar')
        .send({
          municipio: MUNICIPIO,
          telefone: A.tel,
          codigo: codigo === '000000' ? '000001' : '000000',
        })
        .expect(400);
      expect(errado.body.erro).toMatchObject({
        codigo: 'codigo_errado',
        detalhes: { tentativas_restantes: 4 },
      });

      const r = await ctx
        .http()
        .post('/v1/public/app/entrar')
        .send({
          municipio: MUNICIPIO,
          telefone: A.tel,
          codigo,
          dispositivo: 'Pixel de teste',
        })
        .expect(201);
      expect(r.body).toMatchObject({
        token: expect.stringMatching(/^tca_[A-Za-z0-9_-]{32}$/),
        sessao_id: expect.any(String),
        municipio: { slug: MUNICIPIO },
      });
      A.token = r.body.token;
      const s = await linha(
        ctx.db,
        `SELECT s.municipe_id, s.token_hash, s.token_fim, s.dispositivo, m.telefone_e164
         FROM app_sessoes s JOIN municipes m ON m.id = s.municipe_id WHERE s.id = $1`,
        [r.body.sessao_id],
      );
      expect(s).toMatchObject({
        telefone_e164: A.tel,
        token_fim: A.token.slice(-4),
        dispositivo: 'Pixel de teste',
      });
      expect(Buffer.from(s!.token_hash).toString('base64url')).not.toBe(
        A.token,
      );
      A.id = s!.municipe_id;
      const auditoria = await linha(
        ctx.db,
        `SELECT ator_tipo::text, ator_id FROM audit_log WHERE acao = 'entrar_app' AND objeto_id = $1`,
        [r.body.sessao_id],
      );
      expect(auditoria).toEqual({ ator_tipo: 'municipe', ator_id: A.id });

      // O código só serve uma vez.
      await ctx
        .http()
        .post('/v1/public/app/entrar')
        .send({ municipio: MUNICIPIO, telefone: A.tel, codigo })
        .expect(400);

      const b = await entrar(B.tel);
      B.token = b.token;
      B.id = (await linha(
        ctx.db,
        'SELECT municipe_id FROM app_sessoes WHERE id = $1',
        [b.sessao_id],
      ))!.municipe_id;
    });

    it('um código novo anula o anterior; 5 tentativas erradas esgotam o código', async () => {
      const tel = novoTelefone();
      await pedirCodigo(tel).expect(202);
      const primeiro = await codigoDoSms(tel);
      await pedirCodigo(tel).expect(202);
      const segundo = await codigoDoSms(tel);
      let tentativas = 0;
      if (primeiro !== segundo) {
        // O primeiro já não vale (conta como uma tentativa errada do segundo).
        const r = await ctx
          .http()
          .post('/v1/public/app/entrar')
          .send({ municipio: MUNICIPIO, telefone: tel, codigo: primeiro })
          .expect(400);
        expect(r.body.erro.codigo).toBe('codigo_errado');
        tentativas++;
      }
      const errado = segundo === '999999' ? '999998' : '999999';
      for (; tentativas < 5; tentativas++) {
        await ctx
          .http()
          .post('/v1/public/app/entrar')
          .send({ municipio: MUNICIPIO, telefone: tel, codigo: errado })
          .expect(400);
      }
      const r = await ctx
        .http()
        .post('/v1/public/app/entrar')
        .send({ municipio: MUNICIPIO, telefone: tel, codigo: segundo })
        .expect(429);
      expect(r.body.erro.codigo).toBe('demasiadas_tentativas');
    });

    it('limites: 5 códigos por hora por número e 5 por 10 minutos por IP', async () => {
      const tel = novoTelefone();
      for (let i = 0; i < 5; i++) await pedirCodigo(tel).expect(202);
      const r = await pedirCodigo(tel).expect(429);
      expect(r.body.erro.codigo).toBe('demasiados_pedidos');

      const ip = novoIp();
      for (let i = 0; i < 5; i++)
        await pedirCodigo(novoTelefone(), ip).expect(202);
      await pedirCodigo(novoTelefone(), ip).expect(429);

      await pedirCodigo('123').expect(400);
      const inv = await pedirCodigo('+351 12').expect(400);
      expect(inv.body.erro.codigo).toBe('telefone_invalido');
    });

    it('rotas da app sem sessão ou com um token desconhecido → 401', async () => {
      await ctx.http().get('/v1/app/eu').expect(401);
      const r = await app(`tca_${'a'.repeat(32)}`)
        .get('eu')
        .expect(401);
      expect(r.body.erro.codigo).toBe('sessao_invalida');
      await app('outra-coisa').get('eu').expect(401);
    });
  });

  describe('a pessoa e as preferências', () => {
    it('GET eu: telefone mascarado, preferências por omissão; PUT preferências', async () => {
      await ctx.db.query('UPDATE municipes SET nome = $2 WHERE id = $1', [
        A.id,
        'Ana App',
      ]);
      const r = await app(A.token).get('eu').expect(200);
      expect(r.body).toMatchObject({
        nome: 'Ana App',
        telefone: expect.stringMatching(/^\+351 9•• ••• \d{3}$/),
        municipio: { slug: MUNICIPIO },
        preferencias: {
          tipos: { urgente: true, avisos: true, processos: true },
          zona: null,
        },
      });
      expect(JSON.stringify(r.body)).not.toContain(A.tel);

      const p = await app(A.token)
        .put('eu/preferencias', {
          tipos: { processos: true },
          zona: {
            freguesia: `Freguesia ${letras}`,
            lat: base.lat,
            lng: base.lng,
          },
        })
        .expect(200);
      expect(p.body).toMatchObject({
        tipos: { urgente: true, avisos: true, processos: true },
        zona: { freguesia: `Freguesia ${letras}`, lat: base.lat },
      });
      await app(A.token).put('eu/preferencias', {}).expect(400);
      await app(A.token)
        .put('eu/preferencias', { zona: { lat: 41 } })
        .expect(400);
    });
  });

  describe('dispositivos', () => {
    let fcm: string;

    it('registar (upsert pelo token FCM), outro token na mesma sessão substitui, apagar', async () => {
      fcm = novoFcm();
      const r = await app(A.token)
        .post('dispositivos', {
          fcm_token: fcm,
          plataforma: 'android',
          idioma: 'pt-PT',
          versao_app: '1.0.0',
        })
        .expect(201);
      expect(r.body).toMatchObject({ novo: true, ativo: true });
      const outra = await app(A.token)
        .post('dispositivos', { fcm_token: fcm, versao_app: '1.0.1' })
        .expect(201);
      expect(outra.body).toMatchObject({ id: r.body.id, novo: false });

      // Token renovado na mesma sessão: o antigo fica inativo.
      const novo = novoFcm();
      const n = await app(A.token)
        .post('dispositivos', { fcm_token: novo })
        .expect(201);
      const antigo = await linha(
        ctx.db,
        'SELECT ativo, motivo_desativacao FROM app_dispositivos WHERE id = $1',
        [r.body.id],
      );
      expect(antigo).toEqual({ ativo: false, motivo_desativacao: 'removido' });
      fcm = novo;

      await app(A.token)
        .post('dispositivos', { fcm_token: 'curto' })
        .expect(400);
      await app(A.token)
        .post('dispositivos', { fcm_token: novoFcm(), plataforma: 'ios' })
        .expect(400);

      // O de outra pessoa não se apaga.
      await app(B.token).delete(`dispositivos/${n.body.id}`).expect(404);
      const b = await app(B.token)
        .post('dispositivos', { fcm_token: novoFcm() })
        .expect(201);
      await app(B.token).delete(`dispositivos/${b.body.id}`).expect(200);
      expect(
        (await linha(
          ctx.db,
          'SELECT ativo FROM app_dispositivos WHERE id = $1',
          [b.body.id],
        ))!.ativo,
      ).toBe(false);
    });
  });

  describe('os dados da própria pessoa', () => {
    let processoA: string;
    let processoB: string;

    beforeAll(async () => {
      const novo = async (municipe: string) =>
        (await linha(
          ctx.db,
          `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada, freguesia)
           VALUES ($1, $2, $3, $4, 'Obra na cozinha', 'Rua da App 1', 'Freguesia App') RETURNING id`,
          [
            MUNICIPIO_ID,
            `APP ${letras} ${randomInt(1e9)}`,
            TIPO_CP_ID,
            municipe,
          ],
        ))!.id as string;
      processoA = await novo(A.id);
      processoB = await novo(B.id);
      await ctx.db.query(
        `INSERT INTO pagamentos (municipio_id, processo_id, valor_cent, detalhe, guia_numero)
         VALUES ($1, $2, 1234, '[]', $3), ($1, $4, 999, '[]', 'B-1')`,
        [MUNICIPIO_ID, processoA, `G-${letras}`, processoB],
      );
    });

    it('processos: só os dela; o detalhe é o da página "O seu processo"; o de outra pessoa → 404', async () => {
      const l = await app(A.token).get('processos').expect(200);
      expect(l.body.processos.map((p: { id: string }) => p.id)).toEqual([
        processoA,
      ]);
      expect(l.body.processos[0]).toMatchObject({
        fase: 'entrada',
        fase_rotulo: expect.any(String),
        assunto: 'Obra na cozinha',
      });
      const d = await app(A.token).get(`processos/${processoA}`).expect(200);
      expect(d.body).toMatchObject({
        id: processoA,
        assunto: 'Obra na cozinha',
        fase: 'entrada',
        fase_em_palavras: expect.any(String),
        documentos: expect.any(Object),
        linha_do_tempo: expect.any(Array),
        link: expect.stringContaining(`${WEB_URL}/r/`),
        codigo: expect.stringMatching(/^[A-Z0-9]{6}$/),
      });
      // O mesmo que a página pública devolve pelo código do link.
      const publico = await ctx
        .http()
        .get(`/v1/public/processos/${d.body.codigo}`)
        .expect(200);
      expect(publico.body.numero).toBe(d.body.numero);

      await app(A.token).get(`processos/${processoB}`).expect(404);
      await app(B.token).get(`processos/${processoA}`).expect(404);
      await app(A.token).get('processos/nao-e-uuid').expect(400);
    });

    it('pagamentos: só os dela, com o link de pagar', async () => {
      const r = await app(A.token).get('pagamentos').expect(200);
      expect(r.body.pagamentos).toHaveLength(1);
      expect(r.body.pagamentos[0]).toMatchObject({
        estado: 'pendente',
        valor_cent: 1234,
        guia_numero: `G-${letras}`,
        modo_teste: true,
        link: expect.stringMatching(
          new RegExp(`^${WEB_URL}/pagamento/[A-Z0-9]{6}$`),
        ),
      });
      const codigo = r.body.pagamentos[0].link.split('/').pop();
      await ctx.http().get(`/v1/public/pagamentos/${codigo}`).expect(200);
    });

    it('marcações, licenças, reclamações, conversas e avisos: listas vazias para quem não tem nada', async () => {
      for (const c of [
        'marcacoes',
        'licencas',
        'reclamacoes',
        'conversas',
        'avisos',
      ]) {
        const r = await app(B.token).get(c).expect(200);
        const lista = Object.values(r.body)[0] as unknown[];
        expect(Array.isArray(lista)).toBe(true);
        expect(lista).toHaveLength(0);
      }
    });

    it('ocorrências: reportar com GPS (sem SMS), duplicado a menos de 50 m, só as dela', async () => {
      const cats = await app(A.token).get('ocorrencias/categorias').expect(200);
      expect(cats.body.categorias.length).toBeGreaterThan(0);
      const categoria = cats.body.categorias[0].nome;

      const smsAntes = (await smsPara(ctx, A.tel, 'ocorrencia')).length;
      const r = await app(A.token)
        .post('ocorrencias', {
          categoria,
          descricao: 'Buraco grande junto à passadeira',
          lat: base.lat,
          lng: base.lng,
          foto_mime: 'image/jpeg',
        })
        .expect(201);
      expect(r.body).toMatchObject({
        numero: expect.stringMatching(/^OC-/),
        duplicada: false,
        token: expect.any(String),
        link: expect.stringContaining(`${WEB_URL}/ocorrencia/`),
        // Sem S3 nos testes: a ocorrência fica, a fotografia não.
        foto: { erro: 'armazenamento_indisponivel' },
      });
      const o = await linha(
        ctx.db,
        'SELECT municipe_id, lat, lng, morada, conversa_id FROM ocorrencias WHERE token_publico = $1',
        [r.body.token],
      );
      expect(o).toMatchObject({
        municipe_id: A.id,
        lat: base.lat,
        lng: base.lng,
        morada: expect.stringContaining('Localização GPS'),
      });
      expect(ctx.geo.pedidos.some((m) => m.includes('Localização GPS'))).toBe(
        false,
      );
      expect((await smsPara(ctx, A.tel, 'ocorrencia')).length).toBe(smsAntes);

      // B, a 20 m: junta-se à de A.
      const dup = await app(B.token)
        .post('ocorrencias', {
          categoria,
          descricao: 'O mesmo buraco',
          lat: base.lat + 0.00018,
          lng: base.lng,
          morada: 'Rua da Passadeira',
        })
        .expect(201);
      expect(dup.body).toMatchObject({
        duplicada: true,
        numero: r.body.numero,
      });

      const la = await app(A.token).get('ocorrencias').expect(200);
      expect(la.body.ocorrencias).toHaveLength(1);
      expect(la.body.ocorrencias[0]).toMatchObject({
        numero: r.body.numero,
        estado: 'nova',
        estado_explicado: expect.any(String),
      });
      const lb = await app(B.token).get('ocorrencias').expect(200);
      expect(lb.body.ocorrencias).toHaveLength(1);
      expect(lb.body.ocorrencias[0]).toMatchObject({
        numero: r.body.numero,
        juntada_a_outra: true,
        descricao: 'O mesmo buraco',
      });

      const cat = await app(A.token)
        .post('ocorrencias', {
          categoria: 'zzzz qqqq',
          descricao: 'Não sei',
          lat: base.lat,
          lng: base.lng,
        })
        .expect(422);
      expect(cat.body.erro.codigo).toBe('categoria_por_identificar');
      await app(A.token)
        .post('ocorrencias', { categoria, descricao: 'Sem GPS' })
        .expect(400);
    });

    it('chat: sessão já identificada com o munícipe, para as rotas do chat', async () => {
      const r = await app(A.token)
        .post('chat/sessoes', { idioma: 'pt-PT' })
        .expect(201);
      expect(r.body).toMatchObject({
        sessao: expect.stringMatching(/^[A-Za-z0-9_-]{20,64}$/),
        identificado: true,
        saudacao: expect.any(String),
        municipio: { slug: MUNICIPIO },
        caminhos: {
          mensagens: `/v1/chat/sessoes/${r.body.sessao}/mensagens`,
        },
      });
      const c = await linha(
        ctx.db,
        `SELECT municipe_id, canal::text FROM conversas WHERE provider_id = $1`,
        [r.body.sessao],
      );
      expect(c).toEqual({ municipe_id: A.id, canal: 'chat' });
      // Sem IA nos testes: a rota do chat aceita a sessão e responde 503 (não 404).
      const m = await ctx
        .http()
        .post(`/v1/chat/sessoes/${r.body.sessao}/mensagens`)
        .send({ texto: 'Olá' })
        .expect(503);
      expect(m.body.erro.codigo).toBe('ia_indisponivel');

      // Com um turno do munícipe, a conversa aparece no histórico (só a dela).
      await ctx.db.query(
        `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto)
         SELECT id, 1, 'municipe', 'Olá' FROM conversas WHERE provider_id = $1`,
        [r.body.sessao],
      );
      await ctx.db.query(
        `UPDATE conversas SET resumo = 'Perguntou pelo processo.' WHERE provider_id = $1`,
        [r.body.sessao],
      );
      const h = await app(A.token).get('conversas').expect(200);
      expect(h.body.conversas).toEqual([
        expect.objectContaining({
          canal: 'chat',
          resumo: 'Perguntou pelo processo.',
        }),
      ]);
      expect(
        (await app(B.token).get('conversas').expect(200)).body.conversas,
      ).toHaveLength(0);
    });
  });

  describe('push (modo consola)', () => {
    beforeAll(async () => {
      // A volta a ter um telemóvel ativo (a sessão dela).
      await app(A.token)
        .post('dispositivos', { fcm_token: novoFcm() })
        .expect(201);
    });

    it('aviso por zona de emergência: push urgente imediato a quem tem a app na zona', async () => {
      const zona = {
        tipo: 'ponto',
        lat: base.lat,
        lng: base.lng,
        raio_m: 200,
        descricao: 'Junto à passadeira',
      };
      const c = await ctx
        .http()
        .post('/v1/painel/avisos-zona')
        .set(chefe)
        .send({
          titulo: `Fuga de gás ${letras}`,
          mensagem: 'Evite a zona da passadeira até indicação em contrário.',
          tipo: 'emergencia',
          zona,
        })
        .expect(201);
      expect(c.body.pre_visualizacao.destinatarios).toBeGreaterThanOrEqual(1);
      await ctx
        .http()
        .post(`/v1/painel/avisos-zona/${c.body.id}/enviar`)
        .set(chefe)
        .send({ confirmo_destinatarios: c.body.pre_visualizacao.destinatarios })
        .expect(200);

      const [p] = await esperarAte(async () => {
        const r = await pushes(A.id, 'aviso_zona');
        return r.length ? r : null;
      }, 45_000);
      expect(p).toMatchObject({
        tipo: 'urgente',
        titulo: `Fuga de gás ${letras}`,
        corpo: 'Evite a zona da passadeira até indicação em contrário.',
        estado: 'enviado_teste',
        dados: {
          tipo: 'urgente',
          origem: 'aviso_zona',
          link: '/avisos',
          id: c.body.id,
        },
      });
      // B está na zona mas apagou o telemóvel: SMS sim, push não.
      expect(await pushes(B.id, 'aviso_zona')).toHaveLength(0);

      const avisos = await app(A.token).get('avisos').expect(200);
      expect(avisos.body.avisos[0]).toMatchObject({
        id: c.body.id,
        origem: 'aviso_zona',
        urgente: true,
        link: expect.stringContaining(`${WEB_URL}/r/`),
      });
    });

    it('aviso por zona normal com os avisos desligados nas preferências: SMS sim, push não', async () => {
      await app(A.token)
        .put('eu/preferencias', { tipos: { avisos: false } })
        .expect(200);
      const push = ctx.app.get(PushService);
      const r = await push.paraMunicipe(A.id, {
        tipo: 'avisos',
        titulo: 'Obras',
        corpo: 'Corte de trânsito.',
        origem: 'teste_preferencias',
      });
      expect(r).toMatchObject({
        enviados: 0,
        motivo: 'desligado_nas_preferencias',
      });
      // Os urgentes não se desligam.
      const u = await push.paraMunicipe(A.id, {
        tipo: 'urgente',
        titulo: 'Urgente',
        corpo: 'Teste.',
        origem: 'teste_preferencias',
        chave: `teste:${letras}`,
      });
      expect(u.enviados).toBe(1);
      // A mesma chave não repete.
      const outra = await push.paraMunicipe(A.id, {
        tipo: 'urgente',
        titulo: 'Urgente',
        corpo: 'Teste.',
        origem: 'teste_preferencias',
        chave: `teste:${letras}`,
      });
      expect(outra).toMatchObject({ enviados: 0, motivo: 'ja_enviado' });
      await app(A.token)
        .put('eu/preferencias', { tipos: { avisos: true } })
        .expect(200);
      expect(
        (
          await push.paraMunicipe(B.id, {
            tipo: 'urgente',
            titulo: 'x',
            corpo: 'y',
            origem: 'teste_preferencias',
          })
        ).motivo,
      ).toBe('sem_app');
    });

    it('emergência (avisos em massa): push urgente com as instruções, logo no envio', async () => {
      const d = 0.003;
      const c = await ctx
        .http()
        .post('/v1/painel/emergencias')
        .set(chefe)
        .send({
          tipo: 'cheia',
          gravidade: 'aviso',
          titulo: `Cheia ${letras}`,
          mensagem_sms: 'Risco de cheia esta noite junto ao rio',
          instrucoes: 'Afaste-se das margens',
          zona: {
            tipo: 'poligono',
            pontos: [
              { lat: base.lat - d, lng: base.lng - d },
              { lat: base.lat - d, lng: base.lng + d },
              { lat: base.lat + d, lng: base.lng + d },
              { lat: base.lat + d, lng: base.lng - d },
            ],
            descricao: 'Margens (teste app)',
          },
          fontes: ['municipes'],
          chamadas: 'nenhuma',
        })
        .expect(201);
      const sim = await ctx
        .http()
        .post(`/v1/painel/emergencias/${c.body.id}/simular`)
        .set(chefe)
        .expect(200);
      const n = sim.body.destinatarios.total;
      expect(n).toBeGreaterThanOrEqual(1);
      await ctx
        .http()
        .post(`/v1/painel/emergencias/${c.body.id}/enviar`)
        .set(chefe)
        .send({ confirmo_destinatarios: n, confirmo_texto: 'ENVIAR' })
        .expect(200);

      const [p] = await esperarAte(async () => {
        const r = await pushes(A.id, 'emergencia');
        return r.length ? r : null;
      }, 45_000);
      expect(p).toMatchObject({
        tipo: 'urgente',
        titulo: `Emergência: Cheia ${letras}`,
        corpo:
          'Risco de cheia esta noite junto ao rio. Afaste-se das margens. Perigo imediato: ligue 112.',
        estado: 'enviado_teste',
        dados: { origem: 'emergencia', id: c.body.id },
      });
      const avisos = await app(A.token).get('avisos').expect(200);
      expect(avisos.body.avisos).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: c.body.id,
            origem: 'emergencia',
            instrucoes: 'Afaste-se das margens',
            ativo: true,
          }),
        ]),
      );
    });

    it('processo mudou de fase: push com o aviso (sem o link), canal processos', async () => {
      const id = (await linha(
        ctx.db,
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto)
         VALUES ($1, $2, $3, $4, 'Muro') RETURNING id`,
        [MUNICIPIO_ID, `APF ${letras} ${randomInt(1e9)}`, TIPO_CP_ID, A.id],
      ))!.id;
      await ctx
        .http()
        .patch(`/v1/painel/processos/${id}`)
        .set(chefe)
        .send({ fase: 'apreciacao' })
        .expect(200);
      const [p] = await esperarAte(async () => {
        const r = await pushes(A.id, 'processo_fase');
        return r.find((x) => x.dados.id === id) ? r : null;
      }, 45_000);
      expect(p).toMatchObject({
        tipo: 'processos',
        titulo: expect.stringMatching(/^Processo APF .*: /),
        corpo: expect.stringContaining('em análise'),
        estado: 'enviado_teste',
        dados: { link: `/processos/${id}`, origem: 'processo_fase' },
      });
      expect(p.corpo).not.toContain('http');
    });

    it('token FCM inválido (UNREGISTERED): o telemóvel fica desativado', async () => {
      const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      const pedidos: string[] = [];
      const cliente = new ClienteFcm(
        {
          projectId: 'teste',
          clientEmail: 'push@teste.iam.gserviceaccount.com',
          privateKey,
        },
        (url) => {
          pedidos.push(url);
          return Promise.resolve(
            url === URL_TOKEN_GOOGLE
              ? new Response(
                  JSON.stringify({ access_token: 'ya29.x', expires_in: 3600 }),
                  { status: 200 },
                )
              : new Response(
                  JSON.stringify({
                    error: {
                      code: 404,
                      status: 'NOT_FOUND',
                      details: [{ errorCode: 'UNREGISTERED' }],
                    },
                  }),
                  { status: 404 },
                ),
          );
        },
      );
      const fcm = novoFcm();
      const d = await app(B.token)
        .post('dispositivos', { fcm_token: fcm })
        .expect(201);
      const push = ctx.app.get(PushService);
      push.usarCliente(cliente);
      try {
        const r = await push.paraMunicipe(B.id, {
          tipo: 'processos',
          titulo: 'Pagamento recebido',
          corpo: 'Obrigado.',
          origem: 'teste_fcm',
        });
        expect(r.enviados).toBe(0);
      } finally {
        push.usarCliente(null);
      }
      expect(pedidos).toEqual([
        URL_TOKEN_GOOGLE,
        'https://fcm.googleapis.com/v1/projects/teste/messages:send',
      ]);
      expect(
        await linha(
          ctx.db,
          'SELECT ativo, motivo_desativacao FROM app_dispositivos WHERE id = $1',
          [d.body.id],
        ),
      ).toEqual({ ativo: false, motivo_desativacao: 'token_invalido' });
      const [p] = await pushes(B.id, 'teste_fcm');
      expect(p).toMatchObject({ estado: 'token_invalido' });
    });
  });

  describe('painel', () => {
    it('GET painel/app/estatisticas: pessoas com a app, dispositivos e pushes por tipo (30 dias)', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/app/estatisticas')
        .set(chefe)
        .expect(200);
      expect(r.body).toMatchObject({
        modo: 'consola',
        pessoas_com_app: expect.any(Number),
        dispositivos_ativos: expect.any(Number),
        push_30d: {
          urgente: { teste: expect.any(Number) },
          avisos: expect.any(Object),
          processos: expect.any(Object),
        },
      });
      expect(r.body.pessoas_com_app).toBeGreaterThanOrEqual(1);
      expect(r.body.push_30d.urgente.teste).toBeGreaterThanOrEqual(3);
      expect(r.body.push_30d.processos.token_invalido).toBeGreaterThanOrEqual(
        1,
      );
      expect(r.body.por_origem_30d).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ origem: 'emergencia' }),
        ]),
      );

      const atendimento = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'atendimento'),
      );
      const p = await ctx
        .http()
        .get('/v1/painel/app/estatisticas')
        .set(atendimento)
        .expect(403);
      expect(p.body.erro.detalhes).toEqual({ recurso: 'indicadores' });
      await ctx.http().get('/v1/painel/app/estatisticas').expect(401);
    });
  });

  describe('sair', () => {
    it('sair revoga a sessão e desliga o push dos telemóveis dela', async () => {
      const s = await linha(
        ctx.db,
        `SELECT s.id FROM app_sessoes s WHERE s.municipe_id = $1 AND s.revogada_em IS NULL`,
        [A.id],
      );
      await app(A.token).post('sair').expect(200);
      const r = await app(A.token).get('eu').expect(401);
      expect(r.body.erro.codigo).toBe('sessao_invalida');
      expect(
        await linha(
          ctx.db,
          `SELECT count(*)::int AS n FROM app_dispositivos WHERE sessao_id = $1 AND ativo`,
          [s!.id],
        ),
      ).toEqual({ n: 0 });
      expect(
        await linha(
          ctx.db,
          `SELECT revogada_por FROM app_sessoes WHERE id = $1`,
          [s!.id],
        ),
      ).toEqual({ revogada_por: 'municipe' });
      expect(
        await linha(
          ctx.db,
          `SELECT ator_id FROM audit_log WHERE acao = 'sair_app' AND objeto_id = $1`,
          [s!.id],
        ),
      ).toEqual({ ator_id: A.id });
      // Sem telemóvel ativo: o push já não sai.
      const push = ctx.app.get(PushService);
      expect(
        (
          await push.paraMunicipe(A.id, {
            tipo: 'urgente',
            titulo: 'x',
            corpo: 'y',
            origem: 'depois_de_sair',
          })
        ).motivo,
      ).toBe('sem_app');
      // Volta a entrar: o mesmo munícipe.
      const outra = await entrar(A.tel);
      expect(
        (await linha(
          ctx.db,
          'SELECT municipe_id FROM app_sessoes WHERE id = $1',
          [outra.sessao_id],
        ))!.municipe_id,
      ).toBe(A.id);
    });
  });
});
