/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { assinaturaTwilio } from '../../src/common/twilio';
import {
  dentroDaJanela,
  proximaJanela,
} from '../../src/modules/avisos-zona/avisos-zona.regras';
import { AgoraService } from '../../src/modules/agora/agora.service';
import { AgoraSubscricoesService } from '../../src/modules/agora/agora.subscricoes';
import { NotificacoesService } from '../../src/modules/notificacoes/notificacoes.service';
import { instanteLocal } from '../../src/modules/marcacoes/vagas';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO,
  MUNICIPIO_ID,
  novaChamada,
  novoTelefone,
  TIPO_CP_ID,
} from './app';

const URL_SMS = 'https://api.teste.pt/v1/webhooks/sms/entrada';
const TOKEN = 'token-sms-agora-e2e';
const NUMERO_SMS = '+351939000222';

// Um sítio afastado dos dados dos outros testes (Beira Interior).
const PONTO = { lat: 40.1, lng: -7.5 };
const norte = (metros: number) => ({
  lat: PONTO.lat + metros / 111_195,
  lng: PONTO.lng,
});
const FREGUESIA = 'São Agora';
const RUA = 'Rua do Feed';

const REPORTOU = { nome: 'Zeferino Reportador', telefone: novoTelefone() };
const REQUERENTE = 'Bernardete Requerente';

/** O feed "o que se passa perto de mim": fontes, privacidade, ferramentas, SMS, subscrições, painel. */
describe('O que se passa perto de mim (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let sid = 0;
  const ids: Record<string, string> = {};

  async function processo(): Promise<string> {
    const [p] = (
      await ctx.db.query<{ id: string }>(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, fase)
         VALUES ($1, $2, $3, 'Licença', 'notificado') RETURNING id`,
        [MUNICIPIO_ID, `AG ${randomInt(1, 999_999)}/2026`, TIPO_CP_ID],
      )
    ).rows;
    return p.id;
  }

  async function licenca(
    tipo: string,
    dados: Record<string, unknown>,
    municipeId: string | null = null,
  ): Promise<string> {
    const [l] = (
      await ctx.db.query<{ id: string }>(
        `INSERT INTO licencas (municipio_id, processo_id, tipo, municipe_id, dados, avaliacao,
           config_usada, proposta, estado, taxa_cent, codigo_verificacao, decidida_em, valida_ate)
         VALUES ($1, $2, $3, $4, $5, '{}', '{}', 'aprovar', 'emitida', 0, $6, now(), current_date + 10)
         RETURNING id`,
        [
          MUNICIPIO_ID,
          await processo(),
          tipo,
          municipeId,
          JSON.stringify(dados),
          `ag-${randomUUID()}`,
        ],
      )
    ).rows;
    return l.id;
  }

  async function municipe(
    nome: string | null,
    telefone: string,
  ): Promise<string> {
    const r = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, $3) RETURNING id`,
      [MUNICIPIO_ID, telefone, nome],
    );
    return r!.id;
  }

  async function ocorrencia(
    p: { lat: number; lng: number },
    morada: string,
    municipeId: string | null,
  ) {
    const cat = await linha<{ id: string }>(
      ctx.db,
      `SELECT id FROM categorias_ocorrencia WHERE municipio_id = $1 AND nome = 'Buraco na via'`,
      [MUNICIPIO_ID],
    );
    const r = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng, municipe_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        MUNICIPIO_ID,
        `OC-A${randomInt(100_000, 999_999)}`,
        cat!.id,
        `Buraco enorme à porta do ${REPORTOU.nome}, liguem para ${REPORTOU.telefone}`,
        morada,
        p.lat,
        p.lng,
        municipeId,
      ],
    );
    return r!.id;
  }

  async function avisoZona(
    tipo: string,
    titulo: string,
    quando: Date,
  ): Promise<string> {
    const r = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO avisos_zona (municipio_id, titulo, mensagem, tipo, zona, geometria, zona_descricao,
         desde, estado, agendado_para, confirmado_em)
       VALUES ($1, $2, 'Rua fechada ao trânsito das 9h às 18h.', $3, $4, $5, $6, now(), 'enviado', $7, now())
       RETURNING id`,
      [
        MUNICIPIO_ID,
        titulo,
        tipo,
        JSON.stringify({ tipo: 'ponto', ...PONTO, raio_m: 200 }),
        JSON.stringify({
          circulos: [{ ...PONTO, raio_m: 200 }],
          poligono: null,
          ruas: [],
          ruas_sem_coordenadas: [],
        }),
        RUA,
        quando,
      ],
    );
    return r!.id;
  }

  function sms(de: string, corpo: string) {
    const p = {
      MessageSid: `SMag${++sid}-${randomUUID()}`,
      From: de,
      To: NUMERO_SMS,
      Body: corpo,
    };
    return ctx
      .http()
      .post('/v1/webhooks/sms/entrada')
      .type('form')
      .set('X-Twilio-Signature', assinaturaTwilio(TOKEN, URL_SMS, p))
      .send(p)
      .expect(200);
  }

  const respostaSms = async (de: string) =>
    (await linha<{ corpo: string }>(
      ctx.db,
      `SELECT corpo FROM mensagens_saida WHERE destino = $1 AND motivo = 'resposta_sms'
       ORDER BY enviar_em DESC, id DESC LIMIT 1`,
      [de],
    ))!.corpo;

  const feed = (q: string) =>
    ctx.http().get(`/v1/public/agora/${MUNICIPIO}?${q}`);
  // A app manda o sítio e a freguesia (as emergências por freguesia não têm geometria).
  const perto = `lat=${PONTO.lat}&lng=${PONTO.lng}&raio_m=1000&freguesia=${encodeURIComponent(FREGUESIA)}`;

  beforeAll(async () => {
    ctx = await arrancarApp();
    const config = ctx.app.get(ConfigService);
    config.set('comunicacao.twilio', { accountSid: 'ACag', authToken: TOKEN });
    config.set('app.apiUrl', 'https://api.teste.pt');
    await ctx.db.query(
      `UPDATE municipios SET telefone_sms = $2 WHERE id = $1`,
      [MUNICIPIO_ID, NUMERO_SMS],
    );
    chefe = await entrarPainel(ctx);

    ctx.geo.moradas.set(`${RUA}, ${FREGUESIA}`, PONTO);
    ctx.geo.moradas.set(RUA, norte(100));

    // A freguesia passa a ser conhecida (é de uma consulta pública aberta).
    ids.consulta = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO consultas_publicas (municipio_id, codigo, titulo, resumo, perguntas, freguesias,
         abre_em, fecha_em, relatorio_em, estado, aberta_em)
       VALUES ($1, $2, 'Requalificação do largo', 'Um largo novo.', '[]', ARRAY[$3],
         current_date - 1, current_date + 10, current_date + 20, 'aberta', now()) RETURNING id`,
      [MUNICIPIO_ID, `AG${randomInt(10_000, 99_999)}`, FREGUESIA],
    ))!.id;

    const reportou = await municipe(REPORTOU.nome, REPORTOU.telefone);
    const requerente = await municipe(REQUERENTE, novoTelefone());
    ids.ocorrencia = await ocorrencia(
      norte(150),
      `${RUA} 45, ${FREGUESIA}`,
      reportou,
    );
    ids.longe = await ocorrencia(norte(5_000), 'Rua Longe 3', reportou);
    const hoje = new Date().toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Lisbon',
    });
    ids.andaime = await licenca(
      'ocupacao_via',
      {
        equipamento: 'andaime',
        descricao: `pintar a casa da ${REQUERENTE}`,
        morada: `${RUA}, 12, ${FREGUESIA}`,
        data_inicio: hoje,
        dias: 5,
        area_m2: 6,
        passeio_livre_m: 1.2,
        ocupa_estrada: false,
        nome: REQUERENTE,
      },
      requerente,
    );
    ids.arraial = await licenca('recinto_improvisado', {
      descricao: 'arraial de São Feed',
      morada: `${RUA}, 12, ${FREGUESIA}`,
      data_inicio: hoje,
      dias: 2,
      lotacao: 150,
      estruturas: ['palco'],
      musica: true,
      nome: 'Associação Recreativa do Feed',
    });
    ids.festaPrivada = await licenca(
      'ruido',
      {
        atividade: 'festa_privada',
        descricao: 'anos da Bernardete',
        morada: `${RUA}, 12, ${FREGUESIA}`,
        data: hoje,
        hora_inicio: '20:00',
        hora_fim: '23:00',
      },
      requerente,
    );
    ids.aviso = await avisoZona(
      'transito',
      'Corte de trânsito na Rua do Feed',
      new Date(),
    );
    ids.emergencia = (await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO emergencias (municipio_id, tipo, gravidade, titulo, mensagem_sms, guiao, instrucoes,
         zona, geometria, zona_descricao, valida_ate, chamadas, fontes, estado, enviada_em)
       VALUES ($1, 'cheia', 'alerta', 'Cheia em São Agora', 'Saia das zonas baixas.',
         '{"dizer":"Há uma cheia.","perguntas":["Está bem?"]}', 'Suba para um andar alto.',
         $2, $3, 'Freguesia de São Agora', now() + interval '1 day', 'nenhuma', '{municipes}', 'ativa', now())
       RETURNING id`,
      [
        MUNICIPIO_ID,
        JSON.stringify({ tipo: 'freguesias', freguesias: [FREGUESIA] }),
        JSON.stringify({ geo: null, freguesias: [FREGUESIA] }),
      ],
    ))!.id;

    // O job geocodifica a rua (sem número) das licenças e ocorrências.
    await ctx.app.get(AgoraService).atualizarLocais(500);
  });
  afterAll(() => ctx.fechar());

  describe('painel: comunicados e eventos', () => {
    it('quem atende escreve e publica; o técnico não; o vereador só vê', async () => {
      const atendimento = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'atendimento'),
      );
      const tecnico = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'tecnico'),
      );
      const vereador = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'vereador'),
      );
      const corpo = {
        tipo: 'comunicado',
        titulo: 'Recolha de monos em São Agora',
        texto: 'Na próxima semana a recolha passa à terça-feira.',
        freguesias: [FREGUESIA],
      };
      await ctx
        .http()
        .post('/v1/painel/comunicados')
        .set(tecnico)
        .send(corpo)
        .expect(403);
      await ctx
        .http()
        .post('/v1/painel/comunicados')
        .set(vereador)
        .send(corpo)
        .expect(403);
      const c = await ctx
        .http()
        .post('/v1/painel/comunicados')
        .set(atendimento)
        .send(corpo)
        .expect(201);
      expect(c.body).toMatchObject({
        estado: 'rascunho',
        publicado_em: null,
        freguesias: [FREGUESIA],
      });
      ids.comunicado = c.body.id;
      await ctx.http().get('/v1/painel/comunicados').set(vereador).expect(200);

      // Rascunho não aparece no feed.
      let f = await feed(perto).expect(200);
      expect(f.body.itens.map((i: { id: string }) => i.id)).not.toContain(
        ids.comunicado,
      );

      const p = await ctx
        .http()
        .post(`/v1/painel/comunicados/${ids.comunicado}/publicar`)
        .set(atendimento)
        .expect(200);
      expect(p.body.estado).toBe('publicado');
      await ctx
        .http()
        .post(`/v1/painel/comunicados/${ids.comunicado}/publicar`)
        .set(atendimento)
        .expect(409);
      const e = await ctx
        .http()
        .patch(`/v1/painel/comunicados/${ids.comunicado}`)
        .set(chefe)
        .send({ titulo: 'Recolha de monos muda de dia' })
        .expect(200);
      expect(e.body.titulo).toBe('Recolha de monos muda de dia');
      f = await feed(`freguesia=${encodeURIComponent(FREGUESIA)}`).expect(200);
      expect(
        f.body.itens.find((i: { id: string }) => i.id === ids.comunicado),
      ).toMatchObject({
        fonte: 'comunicado',
        etiqueta: 'Comunicado',
        tipo: 'avisos',
      });

      const auditoria = await linhas(
        ctx.db,
        `SELECT acao FROM audit_log WHERE objeto_id = $1 ORDER BY em`,
        [ids.comunicado],
      );
      expect(auditoria.map((a) => a.acao)).toEqual(
        expect.arrayContaining([
          'criar_comunicado',
          'publicar_comunicado',
          'editar_comunicado',
        ]),
      );

      // Evento da câmara, publicado logo.
      await ctx
        .http()
        .post('/v1/painel/eventos')
        .set(chefe)
        .send({
          titulo: 'Mau',
          descricao: 'x',
          local: 'Largo',
          inicio: '2026-11-02T10:00:00Z',
          fim: '2026-11-01T10:00:00Z',
        })
        .expect(400);
      const inicio = new Date(Date.now() + 2 * 86_400_000);
      const ev = await ctx
        .http()
        .post('/v1/painel/eventos')
        .set(atendimento)
        .send({
          titulo: 'Concerto no largo do Feed',
          descricao: 'Banda municipal.',
          local: 'Largo do Feed',
          ...norte(300),
          inicio: inicio.toISOString(),
          freguesia: FREGUESIA,
          publicar: true,
        })
        .expect(201);
      expect(ev.body.estado).toBe('publicado');
      ids.evento = ev.body.id;
      await ctx
        .http()
        .post('/v1/painel/eventos')
        .set(tecnico)
        .send({})
        .expect(403);
      // Um rascunho apagado.
      const r = await ctx
        .http()
        .post('/v1/painel/eventos')
        .set(chefe)
        .send({
          titulo: 'Rascunho',
          descricao: 'Um rascunho',
          local: 'Largo',
          inicio: inicio.toISOString(),
        })
        .expect(201);
      await ctx
        .http()
        .delete(`/v1/painel/eventos/${r.body.id}`)
        .set(tecnico)
        .expect(403);
      await ctx
        .http()
        .delete(`/v1/painel/eventos/${r.body.id}`)
        .set(chefe)
        .expect(200);
      await ctx
        .http()
        .get(`/v1/painel/eventos/${r.body.id}`)
        .set(chefe)
        .expect(404);
    });
  });

  describe('feed público', () => {
    it('tem itens de cada fonte e nenhum dado pessoal', async () => {
      const r = await feed(`${perto}&limite=100`).expect(200);
      expect(r.headers['cache-control']).toMatch(/max-age=60/);
      const itens = r.body.itens as {
        id: string;
        fonte: string;
        tipo: string;
        resumo: string;
        rua: string | null;
      }[];
      const porId = new Map(itens.map((i) => [i.id, i]));
      for (const k of [
        'ocorrencia',
        'andaime',
        'arraial',
        'aviso',
        'emergencia',
        'consulta',
        'comunicado',
        'evento',
      ]) {
        expect(porId.has(ids[k])).toBe(true);
      }
      expect(new Set(itens.map((i) => i.fonte))).toEqual(
        new Set([
          'licenca',
          'aviso_zona',
          'emergencia',
          'ocorrencia',
          'comunicado',
          'evento',
          'consulta_publica',
        ]),
      );
      // Festa privada não aparece; arraial com o organizador (é uma associação).
      expect(porId.has(ids.festaPrivada)).toBe(false);
      expect(porId.get(ids.arraial)!.resumo).toContain(
        'Associação Recreativa do Feed',
      );
      expect(porId.get(ids.andaime)).toMatchObject({
        tipo: 'obras',
        rua: RUA,
        freguesia: FREGUESIA,
      });
      expect(porId.get(ids.ocorrencia)).toMatchObject({
        tipo: 'incidentes',
        rua: RUA,
        titulo: 'Buraco na via',
      });

      // Nem quem reportou (nome, telefone, descrição), nem quem pediu, nem o número de porta.
      const json = JSON.stringify(r.body);
      expect(json).not.toContain('Zeferino');
      expect(json).not.toContain(REPORTOU.telefone);
      expect(json).not.toContain(REPORTOU.telefone.slice(4));
      expect(json).not.toContain('Buraco enorme');
      expect(json).not.toContain(REQUERENTE);
      expect(json).not.toContain('Bernardete');
      expect(json).not.toMatch(/Rua do Feed,? (45|12)\b/);
      expect(json).not.toContain('municipe');

      // A emergência (alerta) vem antes de tudo o que não é emergência... e
      // o item mais perto e a decorrer antes do evento daqui a dois dias.
      const ordem = itens.map((i) => i.id);
      expect(ordem.indexOf(ids.andaime)).toBeLessThan(
        ordem.indexOf(ids.evento),
      );
    });

    it('detalhe sem dados pessoais; 404 para o que não existe', async () => {
      const d = await ctx
        .http()
        .get(`/v1/public/agora/${MUNICIPIO}/incidentes/${ids.ocorrencia}`)
        .expect(200);
      expect(d.body.item).toMatchObject({ id: ids.ocorrencia, rua: RUA });
      expect(JSON.stringify(d.body)).not.toMatch(
        /Zeferino|Buraco enorme|Rua do Feed,? 45/,
      );
      const c = await ctx
        .http()
        .get(`/v1/public/agora/${MUNICIPIO}/avisos/${ids.comunicado}`)
        .expect(200);
      expect(c.body.texto).toContain('terça-feira');
      await ctx
        .http()
        .get(`/v1/public/agora/${MUNICIPIO}/incidentes/${randomUUID()}`)
        .expect(404);
      await ctx
        .http()
        .get(`/v1/public/agora/${MUNICIPIO}/obras/${ids.ocorrencia}`)
        .expect(404);
      await ctx.http().get(`/v1/public/agora/nao-existe`).expect(404);
    });

    it('filtra por raio, freguesia, tipos e datas; pagina', async () => {
      const ids1 = (r: { body: { itens: { id: string }[] } }) =>
        r.body.itens.map((i) => i.id);
      const pertoR = await feed(
        `lat=${PONTO.lat}&lng=${PONTO.lng}&raio_m=1000&limite=100`,
      ).expect(200);
      expect(ids1(pertoR)).not.toContain(ids.longe);
      expect(ids1(pertoR)).toContain(ids.andaime);
      // Só pelo sítio, a emergência por freguesia não entra (não tem geometria).
      expect(ids1(pertoR)).not.toContain(ids.emergencia);
      const largo = await feed(
        `lat=${PONTO.lat}&lng=${PONTO.lng}&raio_m=10000&limite=100`,
      ).expect(200);
      expect(ids1(largo)).toContain(ids.longe);

      const freg = await feed(
        `freguesia=${encodeURIComponent('sao agora')}&limite=100`,
      ).expect(200);
      expect(freg.body.filtro.freguesia).toBe(FREGUESIA);
      expect(ids1(freg)).toEqual(
        expect.arrayContaining([
          ids.andaime,
          ids.emergencia,
          ids.consulta,
          ids.evento,
        ]),
      );
      expect(ids1(freg)).not.toContain(ids.longe);

      const eventos = await feed(`${perto}&tipos=eventos&limite=100`).expect(
        200,
      );
      const tipos = new Set(
        eventos.body.itens.map((i: { tipo: string; fonte: string }) =>
          i.fonte === 'emergencia' ? 'emergencia' : i.tipo,
        ),
      );
      expect([...tipos].sort()).toEqual(['emergencia', 'eventos']);

      const depois = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const futuro = await feed(`${perto}&de=${depois}&limite=100`).expect(200);
      expect(ids1(futuro)).not.toContain(ids.andaime);

      await feed('tipos=lixo').expect(400);
      await feed('lat=40').expect(400);

      const p1 = await feed(`${perto}&limite=2`).expect(200);
      expect(p1.body.itens).toHaveLength(2);
      const p2 = await feed(
        `${perto}&limite=2&cursor=${p1.body.proximo_cursor}`,
      ).expect(200);
      expect(ids1(p2)).not.toContain(p1.body.itens[0].id);
      await feed('cursor=lixo').expect(400);
    });
  });

  describe('ferramenta o_que_se_passa', () => {
    it('sem morada pede-a; com a rua devolve o que há perto e guarda-a', async () => {
      const chamada = novaChamada('agora');
      const sem = await ferramenta(ctx, chamada, 'o_que_se_passa', {
        tipos: ['obras'],
      }).expect(200);
      expect(sem.body.precisa_morada).toBe(true);

      const r = await ferramenta(ctx, chamada, 'o_que_se_passa', {
        tipos: ['obras'],
        morada: `${RUA} 7`,
      }).expect(200);
      expect(r.body.local).toMatchObject({ descricao: RUA, origem: 'dita' });
      expect(r.body.itens.length).toBeGreaterThan(0);
      expect(r.body.itens.length).toBeLessThanOrEqual(5);
      expect(r.body.itens.map((i: { titulo: string }) => i.titulo)).toContain(
        'Andaime na via pública',
      );
      expect(r.body.dizer).toContain('Andaime na via pública');
      expect(r.body.link).toBe(`http://web.e2e.local/agora/${MUNICIPIO}`);
      expect(JSON.stringify(r.body)).not.toMatch(/Bernardete|Zeferino/);
      const m = await linha(
        ctx.db,
        `SELECT morada_rua, morada_lat FROM municipes WHERE telefone_e164 = $1`,
        [chamada.telefone],
      );
      expect(m).toMatchObject({ morada_rua: RUA });

      // Da segunda vez já sabe onde a pessoa mora.
      const outra = await ferramenta(
        ctx,
        { ...chamada, conversa: `agora-${randomUUID()}` },
        'o_que_se_passa',
        {
          quando: 'proximos_dias',
        },
      ).expect(200);
      expect(outra.body.local.origem).toBe('guardada');
      expect(outra.body.periodo).toBe('nos próximos dias');
    });

    it('rua desconhecida e concelho todo', async () => {
      const chamada = novaChamada('agora');
      const r = await ferramenta(ctx, chamada, 'o_que_se_passa', {
        morada: 'Rua Que Não Existe',
      }).expect(200);
      expect(r.body.morada_nao_encontrada).toBe(true);
      const t = await ferramenta(ctx, chamada, 'o_que_se_passa', {
        todo_concelho: true,
        tipos: ['consultas'],
      }).expect(200);
      expect(t.body.local).toBeNull();
      expect(t.body.itens.length).toBeGreaterThan(0);
    });
  });

  describe('SMS', () => {
    it('OBRAS com morada conhecida: os 3 mais perto e o link', async () => {
      const tel = novoTelefone();
      const id = await municipe('Rui', tel);
      await ctx.db.query(
        `UPDATE municipes SET morada_rua = $2, morada_lat = $3, morada_lng = $4 WHERE id = $1`,
        [id, RUA, PONTO.lat, PONTO.lng],
      );
      await sms(tel, 'OBRAS');
      const t = await respostaSms(tel);
      expect(t).toMatch(
        /^CM Teste - obras e cortes perto de Rua do Feed: 1\) /,
      );
      expect(t).toContain('Andaime na via publica');
      expect(t).toContain(`Tudo: http://web.e2e.local/agora/${MUNICIPIO}`);
      expect(t.length).toBeLessThanOrEqual(306);
      const r = await linha(
        ctx.db,
        `SELECT intencao FROM sms_recebidos WHERE de = $1`,
        [tel],
      );
      expect(r).toMatchObject({ intencao: 'obras' });
    });

    it('/obras sem morada: pede a rua, guarda-a quando responde e responde', async () => {
      const tel = novoTelefone();
      await sms(tel, '/obras');
      expect(await respostaSms(tel)).toContain(
        'responda com o nome da sua rua ou freguesia',
      );
      const espera = await linha(
        ctx.db,
        `SELECT sms_espera FROM municipes WHERE telefone_e164 = $1`,
        [tel],
      );
      expect(espera).toMatchObject({ sms_espera: 'obras' });

      await sms(tel, 'Rua Inventada');
      expect(await respostaSms(tel)).toContain(
        'nao encontramos "Rua Inventada"',
      );

      await sms(tel, RUA);
      const t = await respostaSms(tel);
      expect(t).toContain('Andaime na via publica');
      const m = await linha(
        ctx.db,
        `SELECT morada_rua, sms_espera FROM municipes WHERE telefone_e164 = $1`,
        [tel],
      );
      expect(m).toMatchObject({ morada_rua: RUA, sms_espera: null });
      const ints = await linhas(
        ctx.db,
        `SELECT intencao FROM sms_recebidos WHERE de = $1 ORDER BY recebido_em`,
        [tel],
      );
      expect(ints.map((i) => i.intencao)).toEqual([
        'obras',
        'morada',
        'morada',
      ]);

      // Depois disso, o nome de uma rua sozinho volta a ser "ajuda".
      await sms(tel, 'AJUDA');
      expect(await respostaSms(tel)).toContain(
        'OBRAS, AVISOS, EVENTOS ou INCIDENTES',
      );
    });

    it('INCIDENTES e EVENTOS com barra também', async () => {
      const tel = novoTelefone();
      const id = await municipe(null, tel);
      await ctx.db.query(
        `UPDATE municipes SET morada_freguesia = $2 WHERE id = $1`,
        [id, FREGUESIA],
      );
      await sms(tel, '/incidentes');
      const inc = await respostaSms(tel);
      expect(inc).toMatch(
        /^CM Teste - incidentes na freguesia de Sao Agora: 1\) /,
      );
      expect(inc).toContain('Buraco na via');
      await sms(tel, 'EVENTOS');
      expect(await respostaSms(tel)).toContain('Arraial ou festa ao ar livre');
    });
  });

  describe('subscrições "avise-me"', () => {
    /** Uma hora em que se pode avisar (das 9h às 21h em Lisboa). */
    const deDia = () => {
      const agora = new Date(Date.now() + 5_000);
      return dentroDaJanela(agora, 'Europe/Lisbon')
        ? agora
        : proximaJanela(agora, 'Europe/Lisbon');
    };

    it('avisar_me → item novo → um SMS só (idempotente)', async () => {
      const chamada = novaChamada('agora');
      const r = await ferramenta(ctx, chamada, 'avisar_me', {
        tipos: ['obras'],
        morada: RUA,
      }).expect(200);
      expect(r.body).toMatchObject({
        subscrito: true,
        tipos: ['obras'],
        zona: `${RUA} (300 m à volta)`,
      });
      expect(r.body.dizer).toContain('avisamos por SMS');

      // O que já existia antes da subscrição não dispara.
      const servico = ctx.app.get(AgoraSubscricoesService);
      await servico.processar(deDia());
      const avisos = () =>
        linhas(
          ctx.db,
          `SELECT corpo FROM mensagens_saida WHERE destino = $1 AND motivo = 'aviso'`,
          [chamada.telefone],
        );
      expect(await avisos()).toHaveLength(0);

      // Um corte novo na rua.
      await new Promise((ok) => setTimeout(ok, 20));
      const novo = await avisoZona(
        'obras',
        'Obras na conduta da Rua do Feed',
        new Date(),
      );
      await servico.processar(deDia());
      await servico.processar(deDia());
      const enviados = await avisos();
      expect(enviados).toHaveLength(1);
      expect(enviados[0].corpo).toMatch(
        /^CM Teste: Obras perto de si - Obras na conduta da Rua do Feed/,
      );
      expect(enviados[0].corpo).toContain('responda PARAR');
      const reg = await linhas(
        ctx.db,
        `SELECT canal FROM agora_avisos_enviados WHERE item = $1`,
        [`aviso_zona:${novo}`],
      );
      expect(reg).toEqual([{ canal: 'sms' }]);

      // De noite não sai (salvo emergência); de dia sai.
      const noite = instanteLocal(
        new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE', {
          timeZone: 'Europe/Lisbon',
        }),
        '23:00',
        'Europe/Lisbon',
      );
      const outro = await avisoZona(
        'obras',
        'Segunda obra na Rua do Feed',
        new Date(),
      );
      await servico.processar(noite);
      expect(
        await linhas(
          ctx.db,
          `SELECT 1 FROM agora_avisos_enviados WHERE item = $1`,
          [`aviso_zona:${outro}`],
        ),
      ).toHaveLength(0);
      await servico.processar(deDia());
      expect(await avisos()).toHaveLength(2);
    });

    it('PARAR corta os avisos da subscrição (o canal SMS respeita o opt-out)', async () => {
      const chamada = novaChamada('agora');
      await ferramenta(ctx, chamada, 'avisar_me', {
        tipos: ['incidentes'],
        freguesia: FREGUESIA,
      }).expect(200);
      await ctx.db.query(
        `UPDATE municipes SET aceita_avisos = false WHERE telefone_e164 = $1`,
        [chamada.telefone],
      );
      await ocorrencia(norte(50), `${RUA} 9, ${FREGUESIA}`, null);
      await ctx.app.get(AgoraService).atualizarLocais(500);
      await ctx.app.get(AgoraSubscricoesService).processar(deDia());
      expect(
        await linhas(
          ctx.db,
          `SELECT 1 FROM mensagens_saida WHERE destino = $1 AND motivo = 'aviso'`,
          [chamada.telefone],
        ),
      ).toHaveLength(0);
      const r = await linha(
        ctx.db,
        `SELECT e.canal FROM agora_avisos_enviados e JOIN municipes m ON m.id = e.municipe_id WHERE m.telefone_e164 = $1`,
        [chamada.telefone],
      );
      expect(r).toEqual({ canal: null });
    });

    it('AVISAR OBRAS por SMS cria a subscrição na morada conhecida', async () => {
      const tel = novoTelefone();
      const id = await municipe(null, tel);
      await ctx.db.query(
        `UPDATE municipes SET morada_rua = $2, morada_lat = $3, morada_lng = $4 WHERE id = $1`,
        [id, RUA, PONTO.lat, PONTO.lng],
      );
      await sms(tel, 'AVISAR OBRAS');
      expect(await respostaSms(tel)).toContain(
        'avisamos por SMS quando houver obras e cortes novos em Rua do Feed',
      );
      const s = await linha(
        ctx.db,
        `SELECT tipos, canal, raio_m FROM agora_subscricoes WHERE municipe_id = $1`,
        [id],
      );
      expect(s).toMatchObject({ tipos: ['obras'], canal: 'sms', raio_m: 300 });
      // Pedir outra vez com outro tipo junta na mesma subscrição.
      await sms(tel, '/avisar eventos');
      const todas = await linhas(
        ctx.db,
        `SELECT tipos FROM agora_subscricoes WHERE municipe_id = $1`,
        [id],
      );
      expect(todas).toEqual([{ tipos: ['eventos', 'obras'] }]);
    });

    it('a notificação vai por push na app e, sem app, por SMS', () => {
      expect(ctx.app.get(NotificacoesService).nomesDosCanais()).toEqual([
        'push',
        'sms',
      ]);
    });
  });
});
