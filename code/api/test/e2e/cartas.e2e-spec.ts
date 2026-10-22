/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'crypto';
import { hojeLisboa, somarDiasUteis } from '../../src/common/dias-uteis';
import { ClaudeService } from '../../src/ia/claude.service';
import { CartasService } from '../../src/modules/cartas/cartas.service';
import { MARCA_DEMO } from '../../src/modules/cartas/demo-carta';
import {
  esquemaLeituraCarta,
  LeituraCarta,
} from '../../src/modules/cartas/regras';
import {
  arrancarApp,
  Chamada,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO,
  MUNICIPIO_ID,
  novaChamada,
  PNG_1PX,
  smsPara,
  TIPO_CP_ID,
} from './app';

const ANO = new Date().getFullYear();
const N = randomInt(5000, 9999);
const NUMERO = `CP ${N}/${ANO}`;

/** O que a IA "lê": a notificação para audiência prévia do processo NUMERO. */
function leituraAudiencia(over: Partial<LeituraCarta> = {}): LeituraCarta {
  return {
    legivel: true,
    motivo_ilegivel: null,
    entidade_emissora: 'Câmara Municipal de Teste',
    tipo_entidade: 'camara',
    tipo: 'audiencia_previa',
    assunto: 'Porta na cozinha',
    referencia: { valor: NUMERO, excerto: `Processo n.º ${NUMERO}` },
    data_documento: { valor: '2026-10-15', excerto: 'Data: 15/10/2026' },
    data_notificacao: { valor: null, excerto: null },
    prazo: {
      dias: 10,
      unidade: 'uteis',
      data_limite_escrita: null,
      a_contar_de: 'notificacao',
      base_legal: 'artigos 121.º e 122.º do CPA',
      excerto:
        'no prazo de 10 (dez) dias úteis a contar da data da receção da presente notificação',
    },
    pedido: [
      {
        o_que: 'Responder por escrito se não concordar.',
        excerto: 'pronunciar-se por escrito',
      },
    ],
    valores: [],
    consequencias: [
      {
        texto: 'Se não responder, a câmara rejeita o pedido.',
        excerto: 'Findo o prazo sem que se pronuncie, será rejeitada',
      },
    ],
    // O NIF não pode ficar guardado.
    explicacao:
      'A câmara pensa recusar a obra (NIF 123456789) porque falta a planta de estruturas.',
    ...over,
  };
}

class IaFalsa {
  ligada = true;
  resposta: LeituraCarta = leituraAudiencia();
  leituras: { ficheiros: { mime: string }[] }[] = [];
  escritos: { conteudo: string }[] = [];
  get disponivel() {
    return this.ligada;
  }
  extrair(esquema: unknown, pedido: any) {
    if (esquema === esquemaLeituraCarta) {
      this.leituras.push(pedido);
      return Promise.resolve(this.resposta);
    }
    return Promise.reject(new Error('esquema inesperado'));
  }
  escrever(pedido: { conteudo: string }) {
    this.escritos.push(pedido);
    return Promise.resolve(
      'A requerente esclarece que a parede a abrir não tem função estrutural.\nO técnico autor do projeto confirmará esse facto por declaração escrita.',
    );
  }
}

describe('Não percebi esta carta da câmara (e2e)', () => {
  let ctx: Contexto;
  const ia = new IaFalsa();
  let chamada: Chamada;
  let municipeId: string;
  let processoId: string;
  let codigo: string;

  const foto = { mime: 'image/png', ficheiro_base64: PNG_1PX };

  beforeAll(async () => {
    ctx = await arrancarApp({
      substituir: (b) => b.overrideProvider(ClaudeService).useValue(ia),
    });
    chamada = novaChamada('carta');
    const m = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, telefone_e164, nome)
       VALUES ($1, $2, 'Sandra Martins') RETURNING id`,
      [MUNICIPIO_ID, chamada.telefone],
    );
    municipeId = m!.id;
    const p = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, fase)
       VALUES ($1, $2, $3, $4, 'Porta na cozinha', 'apreciacao') RETURNING id`,
      [MUNICIPIO_ID, NUMERO, TIPO_CP_ID, municipeId],
    );
    processoId = p!.id;
  });

  afterAll(() => ctx.fechar());

  describe('na chamada (voz)', () => {
    it('sem código manda o SMS com o link para fotografar', async () => {
      const r = await ferramenta(ctx, chamada, 'ler_carta', {}).expect(200);
      expect(r.body).toMatchObject({
        a_espera_da_carta: true,
        sms_enviado: true,
        codigo: expect.stringMatching(/^[2-9A-HJKMNP-Z]{10}$/),
        dizer: expect.stringContaining('SMS'),
      });
      codigo = r.body.codigo;
      expect(r.body.link).toBe(`http://web.e2e.local/carta/${codigo}`);
      const sms = await smsPara(ctx, chamada.telefone, 'carta');
      expect(sms).toHaveLength(1);
      expect(sms[0].corpo).toContain(`/carta/${codigo}`);
    });

    it('antes da fotografia, fica à espera', async () => {
      const r = await ferramenta(ctx, chamada, 'ler_carta', { codigo }).expect(
        200,
      );
      expect(r.body).toMatchObject({ a_espera_da_carta: true });
      const p = await ctx.http().get(`/v1/public/cartas/${codigo}`).expect(200);
      expect(p.body).toMatchObject({ estado: 'a_espera', leitura: null });
    });

    it('a fotografia chega pela página: lê, liga ao processo e pede a data de receção', async () => {
      const r = await ctx
        .http()
        .post(`/v1/public/cartas/${codigo}/ficheiro`)
        .send(foto)
        .expect(200);
      expect(ia.leituras).toHaveLength(1);
      expect(ia.leituras[0].ficheiros[0].mime).toBe('image/png');
      expect(r.body).toMatchObject({
        estado: 'lida',
        leitura: {
          da_camara: true,
          tipo: 'audiencia_previa',
          tipo_rotulo: 'Notificação para audiência prévia',
          prazo_lido: { encontrado: true, dias: 10, unidade: 'uteis' },
        },
        prazo: { estado: 'falta_data' },
        pergunta_rececao: true,
        processo: { numero: NUMERO, fase: 'apreciacao' },
        respostas_possiveis: [
          { tipo: 'pronuncia', rotulo: expect.any(String) },
          { tipo: 'prorrogacao', rotulo: expect.any(String) },
        ],
      });
      // Sem dados pessoais guardados.
      expect(r.body.leitura.explicacao).not.toContain('123456789');
      const c = await linha(
        ctx.db,
        `SELECT processo_id, leitura::text AS leitura FROM cartas WHERE codigo = $1`,
        [codigo],
      );
      expect(c.processo_id).toBe(processoId);
      expect(c.leitura).not.toContain('123456789');
      // A nota (interna) na ficha do processo.
      const e = await linha(
        ctx.db,
        `SELECT descricao, interno FROM processo_eventos
         WHERE processo_id = $1 AND tipo = 'carta_ajuda'`,
        [processoId],
      );
      expect(e).toMatchObject({ interno: true });
      expect(e.descricao).toMatch(/pediu ajuda para perceber o ofício/);
      // Uma segunda fotografia da mesma carta já não é lida.
      await ctx
        .http()
        .post(`/v1/public/cartas/${codigo}/ficheiro`)
        .send(foto)
        .expect(409);
    });

    it('o agente explica e pergunta em que dia a recebeu (sem inventar o prazo)', async () => {
      const r = await ferramenta(ctx, chamada, 'ler_carta', { codigo }).expect(
        200,
      );
      expect(r.body).toMatchObject({
        da_camara: true,
        tipo: 'audiencia_previa',
        pergunta: 'data_rececao',
        prazo: { estado: 'falta_data', data_limite: null },
        processo: { numero: NUMERO },
        respostas_possiveis: ['pronuncia', 'prorrogacao'],
      });
      expect(r.body.dizer).toContain('Em que dia recebeu a carta?');
      expect(r.body.dizer).toContain('Se não fizer nada');
    });

    it('com a data de receção calcula o prazo em dias úteis', async () => {
      const hoje = hojeLisboa();
      const r = await ferramenta(ctx, chamada, 'ler_carta', {
        codigo,
        data_rececao: hoje,
      }).expect(200);
      const feriados = new Set(
        (
          await linhas<{ dia: string }>(
            ctx.db,
            `SELECT to_char(data, 'YYYY-MM-DD') AS dia FROM feriados
             WHERE municipio_id IS NULL OR municipio_id = $1`,
            [MUNICIPIO_ID],
          )
        ).map((f) => f.dia),
      );
      const limite = somarDiasUteis(hoje, 10, feriados);
      expect(r.body.prazo).toMatchObject({
        estado: 'calculado',
        data_limite: limite,
        faltam_dias_uteis: 10,
        terminou: false,
      });
      expect(r.body.pergunta).toBeNull();
      expect(r.body.dizer).toContain('Faltam 10 dias úteis');
      // Uma data no futuro não é aceite.
      await ctx
        .http()
        .post(`/v1/public/cartas/${codigo}/rececao`)
        .send({ data: '2099-01-01' })
        .expect(400);
    });

    it('prepara a pronúncia com as palavras da pessoa e manda o link', async () => {
      const r = await ferramenta(ctx, chamada, 'preparar_resposta_carta', {
        codigo,
        tipo: 'pronuncia',
        argumentos:
          'a parede não segura nada, o engenheiro pode passar um papel',
      }).expect(200);
      expect(ia.escritos[0].conteudo).toContain('a parede não segura nada');
      expect(r.body.resposta.tipo).toBe('pronuncia');
      expect(r.body.resposta.texto).toContain(
        '1. A requerente esclarece que a parede a abrir não tem função estrutural.',
      );
      expect(r.body.resposta.texto).toContain(`Processo n.º ${NUMERO}`);
      expect(r.body.resposta.texto).toContain('Sandra Martins');
      expect(r.body.dizer).toMatch(/Nada é entregue sem a sua confirmação/);
      expect(r.body.sms_enviado).toBe(true);
      expect(await smsPara(ctx, chamada.telefone, 'carta')).toHaveLength(2);
    });

    it('a pessoa revê, muda e confirma: entra no processo (simulado)', async () => {
      const p = await ctx.http().get(`/v1/public/cartas/${codigo}`).expect(200);
      const resposta = p.body.respostas[0];
      expect(resposta).toMatchObject({ estado: 'rascunho', tipo: 'pronuncia' });
      const texto = `${resposta.texto}\n\n(revisto pela requerente)`;
      const e = await ctx
        .http()
        .patch(`/v1/public/cartas/${codigo}/respostas/${resposta.id}`)
        .send({ texto })
        .expect(200);
      expect(e.body.respostas[0].texto).toContain('(revisto pela requerente)');

      const r = await ctx
        .http()
        .post(`/v1/public/cartas/${codigo}/respostas/${resposta.id}/entregar`)
        .expect(200);
      expect(r.body).toMatchObject({
        entregue: true,
        simulado: true,
        numero_entrada: expect.stringMatching(/^DEMO-CARTA-\d{4}\/\d{4}$/),
        carta: { estado: 'respondida', respostas_possiveis: [] },
      });
      const ev = await linha(
        ctx.db,
        `SELECT descricao, interno FROM processo_eventos
         WHERE processo_id = $1 AND tipo = 'resposta_municipe'`,
        [processoId],
      );
      expect(ev).toMatchObject({ interno: false });
      // Depois de entregue não se muda nem se prepara outra.
      await ctx
        .http()
        .patch(`/v1/public/cartas/${codigo}/respostas/${resposta.id}`)
        .send({ texto })
        .expect(409);
      await ctx
        .http()
        .post(`/v1/public/cartas/${codigo}/respostas`)
        .send({ tipo: 'prorrogacao' })
        .expect(409);
    });
  });

  describe('no chat (anexo)', () => {
    let sessao: string;
    let conversa: string;

    beforeAll(async () => {
      const r = await ctx
        .http()
        .post('/v1/chat/sessoes')
        .set(
          'X-Forwarded-For',
          `10.9.${randomInt(0, 250)}.${randomInt(1, 250)}`,
        )
        .send({ municipio: MUNICIPIO })
        .expect(201);
      sessao = r.body.sessao;
      conversa = (await linha<{ id: string }>(
        ctx.db,
        'SELECT id FROM conversas WHERE provider_id = $1',
        [sessao],
      ))!.id;
    });

    it('documento sem prazo: não inventa e pergunta', async () => {
      ia.resposta = leituraAudiencia({
        tipo: 'pedido_elementos',
        referencia: { valor: null, excerto: null },
        prazo: {
          dias: 10,
          unidade: 'uteis',
          data_limite_escrita: null,
          a_contar_de: 'notificacao',
          base_legal: null,
          // A IA diz 10 dias mas o excerto não o sustenta: descarta-se.
          excerto: 'deve entregar os documentos em falta',
        },
        consequencias: [],
      });
      const r = await ctx
        .http()
        .post(`/v1/chat/sessoes/${sessao}/carta`)
        .send(foto)
        .expect(201);
      expect(r.body).toMatchObject({
        estado: 'lida',
        prazo: { estado: 'sem_prazo', data_limite: null },
        pergunta_rececao: true,
        processo: null,
        leitura: {
          tipo: 'pedido_elementos',
          prazo_lido: { encontrado: false, dias: null },
          consequencias: [{ origem: 'regra_geral' }],
        },
      });
      const c = await linha(
        ctx.db,
        'SELECT conversa_id, canal FROM cartas WHERE codigo = $1',
        [r.body.codigo],
      );
      expect(c).toEqual({ conversa_id: conversa, canal: 'chat' });
    });

    it('carta de outra entidade: diz de quem é e não prepara resposta', async () => {
      ia.resposta = leituraAudiencia({
        tipo_entidade: 'financas',
        entidade_emissora: 'Autoridade Tributária e Aduaneira',
        tipo: 'liquidacao_taxa',
        assunto: 'IMI 2026',
        valores: [
          {
            descricao: 'IMI',
            valor_cent: 31250,
            referencia_mb: null,
            excerto: 'Valor: 312,50 €',
          },
        ],
      });
      const r = await ctx
        .http()
        .post(`/v1/chat/sessoes/${sessao}/carta`)
        .send(foto)
        .expect(201);
      expect(r.body).toMatchObject({
        leitura: { da_camara: false },
        encaminhamento: {
          entidade: 'Autoridade Tributária e Aduaneira',
          dizer: expect.stringContaining('não é da câmara'),
        },
        respostas_possiveis: [],
        processo: null,
      });
      await ctx
        .http()
        .post(`/v1/public/cartas/${r.body.codigo}/respostas`)
        .send({ tipo: 'pagamento' })
        .expect(422)
        .expect((x) =>
          expect(x.body.erro.codigo).toBe('carta_de_outra_entidade'),
        );
    });

    it('recusa ficheiros que não são imagem nem PDF', async () => {
      const r = await ctx
        .http()
        .post(`/v1/chat/sessoes/${sessao}/carta`)
        .send({
          mime: 'image/png',
          ficheiro_base64: Buffer.from(
            'isto não é uma imagem nenhuma',
          ).toString('base64'),
        })
        .expect(415);
      expect(r.body.erro.codigo).toBe('ficheiro_invalido');
    });

    it('sem IA (e sem carta de demonstração): 503 e a carta fica à espera', async () => {
      ia.ligada = false;
      try {
        const r = await ctx
          .http()
          .post(`/v1/chat/sessoes/${sessao}/carta`)
          .send(foto)
          .expect(503);
        expect(r.body.erro.codigo).toBe('ia_indisponivel');
        const c = await linha(
          ctx.db,
          'SELECT estado, leituras FROM cartas WHERE codigo = $1',
          [r.body.erro.detalhes.codigo],
        );
        expect(c).toEqual({ estado: 'a_espera', leituras: 1 });
      } finally {
        ia.ligada = true;
      }
    });
  });

  describe('permissões', () => {
    it('a carta de uma conversa não abre noutra', async () => {
      const outra = novaChamada('carta-outra');
      const r = await ferramenta(ctx, outra, 'ler_carta', { codigo }).expect(
        404,
      );
      expect(r.body.erro.codigo).toBe('carta_desconhecida');
    });

    it('não liga ao processo de outra pessoa', async () => {
      ia.resposta = leituraAudiencia();
      const outra = novaChamada('carta-outra');
      const r = await ferramenta(ctx, outra, 'ler_carta', {}).expect(200);
      const p = await ctx
        .http()
        .post(`/v1/public/cartas/${r.body.codigo}/ficheiro`)
        .send(foto)
        .expect(200);
      expect(p.body.processo).toBeNull();
      expect(p.body.precisa_identificacao).toBe(false);
    });

    it('código inválido ou desconhecido: 404', async () => {
      await ctx.http().get('/v1/public/cartas/curto').expect(404);
      await ctx.http().get('/v1/public/cartas/ABCDEFGH23').expect(404);
    });

    it('o painel é para quem trata dos processos', async () => {
      const atendimento = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'atendimento'),
      );
      await ctx.http().get('/v1/painel/cartas').set(atendimento).expect(403);
      await ctx
        .http()
        .get('/v1/painel/cartas/confusoes')
        .set(atendimento)
        .expect(403);
    });
  });

  describe('painel', () => {
    let chefe: Record<string, string>;
    beforeAll(async () => {
      chefe = await entrarPainel(ctx);
    });

    it('na ficha do processo: o munícipe pediu ajuda com o ofício', async () => {
      const r = await ctx
        .http()
        .get(`/v1/painel/cartas?processo_id=${processoId}`)
        .set(chefe)
        .expect(200);
      expect(r.body.itens).toEqual([
        expect.objectContaining({
          tipo: 'audiencia_previa',
          processo_numero: NUMERO,
          estado: 'respondida',
          entregues: 1,
        }),
      ]);
      const d = await ctx
        .http()
        .get(`/v1/painel/cartas/${r.body.itens[0].id}`)
        .set(chefe)
        .expect(200);
      expect(d.body.leitura.tipo).toBe('audiencia_previa');
      // O texto da resposta é da pessoa: o painel vê o tipo e o estado.
      expect(d.body.respostas[0]).not.toHaveProperty('texto');
      const a = await linha(
        ctx.db,
        `SELECT acao FROM audit_log WHERE objeto_tipo = 'carta' AND objeto_id = $1 AND acao = 'ver'`,
        [r.body.itens[0].id],
      );
      expect(a).toBeTruthy();
    });

    it('os ofícios que mais confundem', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/cartas/confusoes')
        .set(chefe)
        .expect(200);
      const audiencia = r.body.itens.find(
        (i: any) => i.tipo === 'audiencia_previa',
      );
      expect(audiencia).toMatchObject({
        nome: 'Notificação para audiência prévia',
        total: expect.any(Number),
        responderam: expect.any(Number),
      });
      expect(audiencia.total).toBeGreaterThanOrEqual(2);
      expect(r.body.total_outras_entidades).toBeGreaterThanOrEqual(1);
    });
  });

  describe('app do munícipe', () => {
    let token: string;
    let codigoApp: string;

    beforeAll(async () => {
      await ctx
        .http()
        .post('/v1/public/app/codigo')
        .set(
          'X-Forwarded-For',
          `10.8.${randomInt(0, 250)}.${randomInt(1, 250)}`,
        )
        .send({ municipio: MUNICIPIO, telefone: chamada.telefone })
        .expect(202);
      const sms = await smsPara(ctx, chamada.telefone, 'identificacao');
      const c = /\b(\d{6})\b/.exec(sms[sms.length - 1].corpo)![1];
      const r = await ctx
        .http()
        .post('/v1/public/app/entrar')
        .send({
          municipio: MUNICIPIO,
          telefone: chamada.telefone,
          codigo: c,
          dispositivo: 'Telemóvel de teste',
        })
        .expect(201);
      token = r.body.token;
    });

    it('"Não percebi uma carta": taxa do processo da pessoa → referência de teste', async () => {
      ia.resposta = leituraAudiencia({
        tipo: 'liquidacao_taxa',
        assunto: 'Taxa da comunicação prévia',
        consequencias: [],
        valores: [
          {
            descricao: 'Taxa de apreciação',
            valor_cent: 4520,
            referencia_mb: null,
            excerto: 'Valor a pagar: 45,20 €',
          },
        ],
      });
      const r = await ctx
        .http()
        .post('/v1/app/cartas')
        .set('Authorization', `Bearer ${token}`)
        .send(foto)
        .expect(201);
      codigoApp = r.body.codigo;
      expect(r.body).toMatchObject({
        canal: 'app',
        processo: { numero: NUMERO },
        respostas_possiveis: [{ tipo: 'pagamento' }],
      });
      const p = await ctx
        .http()
        .post(`/v1/public/cartas/${codigoApp}/respostas`)
        .send({ tipo: 'pagamento' })
        .expect(201);
      const resp = p.body.carta.respostas[0];
      expect(resp).toMatchObject({
        tipo: 'pagamento',
        pagamento: { valor_cent: 4520, modo_teste: true },
      });
      expect(resp.texto).toMatch(/modo de teste/);
      const pag = await linha(
        ctx.db,
        'SELECT processo_id, valor_cent, modo_teste FROM pagamentos WHERE id = (SELECT pagamento_id FROM carta_respostas WHERE id = $1)',
        [resp.id],
      );
      expect(pag).toEqual({
        processo_id: processoId,
        valor_cent: 4520,
        modo_teste: true,
      });
    });

    it('lista as cartas da pessoa e não abre as de outros', async () => {
      const l = await ctx
        .http()
        .get('/v1/app/cartas')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(l.body.itens.map((i: { codigo: string }) => i.codigo)).toContain(
        codigoApp,
      );
      await ctx
        .http()
        .get(`/v1/app/cartas/${codigoApp}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      // Sem sessão: 401.
      await ctx.http().get('/v1/app/cartas').expect(401);
    });

    it('sem ficheiro: cria a carta à espera (para mandar um PDF pela página)', async () => {
      const r = await ctx
        .http()
        .post('/v1/app/cartas')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);
      expect(r.body).toMatchObject({ estado: 'a_espera', canal: 'app' });
    });
  });

  describe('lembrete antes do fim do prazo', () => {
    it('avisa uma vez quando faltam 3 dias úteis', async () => {
      const lembrete = novaChamada('carta-lembrete');
      await ctx.db.query(
        `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Rui')`,
        [MUNICIPIO_ID, lembrete.telefone],
      );
      ia.resposta = leituraAudiencia({
        referencia: { valor: null, excerto: null },
      });
      const r = await ferramenta(ctx, lembrete, 'ler_carta', {}).expect(200);
      const c = r.body.codigo;
      await ctx
        .http()
        .post(`/v1/public/cartas/${c}/ficheiro`)
        .send(foto)
        .expect(200);
      const feriados = new Set<string>();
      await ctx.db.query(
        `UPDATE cartas SET data_limite = $2, prazo = jsonb_set(coalesce(prazo, '{}'), '{estado}', '"calculado"')
         WHERE codigo = $1`,
        [c, somarDiasUteis(hojeLisboa(), 2, feriados)],
      );
      const svc = ctx.app.get(CartasService);
      expect(await svc.lembrar()).toBeGreaterThanOrEqual(1);
      const avisos = await smsPara(ctx, lembrete.telefone, 'aviso');
      expect(avisos).toHaveLength(1);
      expect(avisos[0].corpo).toContain(`/carta/${c}`);
      await svc.lembrar();
      expect(await smsPara(ctx, lembrete.telefone, 'aviso')).toHaveLength(1);
    });
  });

  describe('demonstração', () => {
    it('o ofício de demonstração em PDF, lido sem IA', async () => {
      const r = await ctx
        .http()
        .get(`/v1/public/cartas/demonstracao/oficio.pdf?municipio=${MUNICIPIO}`)
        .buffer(true)
        .parse((res, cb) => {
          const partes: Buffer[] = [];
          res.on('data', (p: Buffer) => partes.push(p));
          res.on('end', () => cb(null, Buffer.concat(partes)));
        })
        .expect(200);
      const pdf = r.body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(pdf.includes(Buffer.from(MARCA_DEMO))).toBe(true);

      ia.ligada = false;
      try {
        const demo = novaChamada('carta-demo');
        const c = await ferramenta(ctx, demo, 'ler_carta', {}).expect(200);
        const l = await ctx
          .http()
          .post(`/v1/public/cartas/${c.body.codigo}/ficheiro`)
          .send({
            mime: 'application/pdf',
            ficheiro_base64: pdf.toString('base64'),
          })
          .expect(200);
        expect(l.body).toMatchObject({
          demonstracao: true,
          leitura: { tipo: 'audiencia_previa', da_camara: true },
          prazo: { estado: 'falta_data' },
        });
      } finally {
        ia.ligada = true;
      }
    });
  });
});
