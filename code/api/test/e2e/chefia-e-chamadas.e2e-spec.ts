/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import { JobsService } from '../../src/jobs/jobs.service';
import { FILA_CHAMADAS_SAIDA } from '../../src/modules/chamadas-saida/chamadas-saida.module';
import { MunicipiosService } from '../../src/modules/municipios/municipios.service';
import {
  arrancarApp,
  Contexto,
  conversaId,
  criarUtilizador,
  entrarPainel,
  esperarAte,
  esperarSmsEnviado,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
  novaConversa,
  novoTelefone,
  smsPara,
  TIPO_CP_ID,
} from './app';

/** O número da linha da câmara no seed (o "caller_id" de uma chamada de saída). */
const LINHA_CAMARA = '+351253000000';
const FUSO = 'Europe/Lisbon';

/** 'AAAA-MM-DD' e hora no fuso do município. */
function local(d: Date): { dia: string; hora: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    dia: `${v('year')}-${v('month')}-${v('day')}`,
    hora: Number(v('hour')),
  };
}

/**
 * Perguntas da chefia (sem IA) e chamadas de saída do agente (sem
 * ElevenLabs: as chamadas ficam 'falhou' e vai o SMS de recurso).
 */
describe('Perguntas da chefia e chamadas de saída (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  // ------------------------------------------------------------------
  // Perguntas da chefia
  // ------------------------------------------------------------------

  describe('perguntas da chefia', () => {
    it('POST /v1/painel/perguntar sem IA → 503 ia_indisponivel (também no stream, em JSON)', async () => {
      const r = await ctx
        .http()
        .post('/v1/painel/perguntar')
        .set(chefe)
        .send({ pergunta: 'Quantos processos de obras estão atrasados?' })
        .expect(503);
      expect(r.body.erro).toMatchObject({
        codigo: 'ia_indisponivel',
        mensagem: expect.any(String),
      });

      const s = await ctx
        .http()
        .post('/v1/painel/perguntar/stream')
        .set(chefe)
        .send({ pergunta: 'Quantos processos de obras estão atrasados?' })
        .expect(503);
      expect(s.headers['content-type']).toMatch(/application\/json/);
      expect(s.body.erro.codigo).toBe('ia_indisponivel');

      // A validação vem antes da IA.
      const curta = await ctx
        .http()
        .post('/v1/painel/perguntar')
        .set(chefe)
        .send({ pergunta: 'ab' })
        .expect(400);
      expect(curta.body.erro.codigo).toBe('pedido_invalido');
    });

    it('GET /perguntar/sugestoes devolve perguntas exemplo', async () => {
      const r = await ctx
        .http()
        .get('/v1/painel/perguntar/sugestoes')
        .set(chefe)
        .expect(200);
      expect(r.body.sugestoes).toEqual(
        expect.arrayContaining(['Quantos processos de obras estão atrasados?']),
      );
      for (const s of r.body.sugestoes) expect(typeof s).toBe('string');
    });

    it('GET /perguntar/historico: só as do próprio, mais recentes primeiro, paginado', async () => {
      const vereadorId = await criarUtilizador(ctx, 'vereador');
      const outroId = await criarUtilizador(ctx, 'vereador');
      const inserir = (u: string, pergunta: string, minutos: number) =>
        ctx.db.query(
          `INSERT INTO perguntas_chefia (municipio_id, utilizador_id, pergunta, resposta, consultas, fim, ms, criada_em)
           VALUES ($1, $2, $3, $4, $5, 'concluido', 1200, now() - make_interval(mins => $6))`,
          [
            MUNICIPIO_ID,
            u,
            pergunta,
            JSON.stringify({
              resposta: `Resposta a: ${pergunta}`,
              numeros_chave: [],
              tabela: null,
              sugestoes: [],
              sem_dados: false,
            }),
            JSON.stringify([{ id: 'c1', ferramenta: 'processos_atrasados' }]),
            minutos,
          ],
        );
      await inserir(vereadorId, 'Pergunta antiga', 30);
      await inserir(vereadorId, 'Pergunta recente', 5);
      await inserir(outroId, 'Pergunta de outro', 1);

      const vereador = await entrarPainel(ctx, vereadorId);
      const r = await ctx
        .http()
        .get('/v1/painel/perguntar/historico')
        .set(vereador)
        .expect(200);
      expect(r.body).toEqual({
        itens: [
          expect.objectContaining({
            id: expect.any(String),
            pergunta: 'Pergunta recente',
            resposta: 'Resposta a: Pergunta recente',
            consultas: [{ id: 'c1', ferramenta: 'processos_atrasados' }],
            fim: 'concluido',
            ms: 1200,
            criada_em: expect.any(String),
          }),
          expect.objectContaining({ pergunta: 'Pergunta antiga' }),
        ],
        proximo_cursor: null,
      });

      const p1 = await ctx
        .http()
        .get('/v1/painel/perguntar/historico')
        .query({ limite: 1 })
        .set(vereador)
        .expect(200);
      expect(
        p1.body.itens.map((i: { pergunta: string }) => i.pergunta),
      ).toEqual(['Pergunta recente']);
      expect(p1.body.proximo_cursor).toEqual(expect.any(String));
      const p2 = await ctx
        .http()
        .get('/v1/painel/perguntar/historico')
        .query({ limite: 1, cursor: p1.body.proximo_cursor })
        .set(vereador)
        .expect(200);
      expect(
        p2.body.itens.map((i: { pergunta: string }) => i.pergunta),
      ).toEqual(['Pergunta antiga']);
      expect(p2.body.proximo_cursor).toBeNull();
    });

    it("perfil sem 'indicadores' (atendimento) → 403 sem_permissao", async () => {
      const atendimento = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'atendimento'),
      );
      // Um pedido de cada vez (o supertest liga o servidor ao criar o pedido).
      for (const pedido of [
        () => ctx.http().get('/v1/painel/perguntar/sugestoes'),
        () => ctx.http().get('/v1/painel/perguntar/historico'),
        () =>
          ctx
            .http()
            .post('/v1/painel/perguntar')
            .send({ pergunta: 'Quantos?' }),
      ]) {
        const r = await pedido().set(atendimento).expect(403);
        expect(r.body.erro).toMatchObject({
          codigo: 'sem_permissao',
          detalhes: { recurso: 'indicadores' },
        });
      }
    });
  });

  // ------------------------------------------------------------------
  // Chamadas de saída
  // ------------------------------------------------------------------

  describe('chamadas de saída', () => {
    let configOriginal: unknown;
    /** Feriado municipal hoje (só se fomos nós a pô-lo), para "fora de horas". */
    let feriadoId: number | null = null;

    const CONFIG_LIGADA = {
      ativo: true,
      motivos: ['processo_fase'],
      numero_id: 'numero-saida-e2e',
      via: 'twilio',
    };

    /** A cache de feriados do MunicipiosService dura 1 min: esquece-a. */
    const esquecerFeriados = () =>
      ctx.app
        .get<unknown, { cacheFeriados: Map<string, unknown> }>(
          MunicipiosService,
        )
        .cacheFeriados.clear();

    const guardarConfig = (config: object) =>
      ctx
        .http()
        .put('/v1/painel/chamadas-saida/config')
        .set(chefe)
        .send(config);

    /** Munícipe com telemóvel e processo CP na fase 'entrada'. */
    async function novoProcesso(
      preferido: 'telefone' | 'sms' | null = null,
    ): Promise<{
      processoId: string;
      municipeId: string;
      telefone: string;
      numero: string;
    }> {
      const telefone = novoTelefone();
      const m = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO municipes (municipio_id, telefone_e164, nome, canal_preferido)
         VALUES ($1, $2, 'Munícipe E2E', $3) RETURNING id`,
        [MUNICIPIO_ID, telefone, preferido],
      );
      const numero = `CP ${randomInt(100_000, 999_999)}/E2E`;
      const p = await linha<{ id: string }>(
        ctx.db,
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada)
         VALUES ($1, $2, $3, $4, 'Porta na cozinha', 'Rua de Teste, 1') RETURNING id`,
        [MUNICIPIO_ID, numero, TIPO_CP_ID, m!.id],
      );
      return { processoId: p!.id, municipeId: m!.id, telefone, numero };
    }

    const mudarFase = (processoId: string, fase: string) =>
      ctx
        .http()
        .patch(`/v1/painel/processos/${processoId}`)
        .set(chefe)
        .send({ fase })
        .expect(200);

    const ligar = (
      processoId: string,
      headers: Record<string, string>,
      corpo: object = {},
    ) =>
      ctx
        .http()
        .post(`/v1/painel/processos/${processoId}/ligar`)
        .set(headers)
        .send(corpo);

    beforeAll(async () => {
      const a = await linha(
        ctx.db,
        'SELECT chamadas_saida FROM agente_config WHERE municipio_id = $1',
        [MUNICIPIO_ID],
      );
      configOriginal = a?.chamadas_saida;
      // Hoje é feriado municipal: nenhuma chamada sem forcar_horario cai
      // "agora", seja a que horas for que o teste corra.
      const f = await linha<{ id: number }>(
        ctx.db,
        `INSERT INTO feriados (municipio_id, data, nome)
         VALUES ($1, $2::date, 'Feriado E2E (chamadas de saída)')
         ON CONFLICT DO NOTHING RETURNING id`,
        [MUNICIPIO_ID, local(new Date()).dia],
      );
      feriadoId = f?.id ?? null;
      esquecerFeriados();
    });

    afterAll(async () => {
      // A config é do município: repor para os outros ficheiros.
      await ctx.db.query(
        'UPDATE agente_config SET chamadas_saida = $2 WHERE municipio_id = $1',
        [MUNICIPIO_ID, JSON.stringify(configOriginal)],
      );
      if (feriadoId !== null) {
        await ctx.db.query('DELETE FROM feriados WHERE id = $1', [feriadoId]);
      }
    });

    it('GET config: desligada por omissão, com o estado do ElevenLabs', async () => {
      await ctx.db.query(
        `UPDATE agente_config SET chamadas_saida = '{"ativo": false, "motivos": [], "numero_id": null, "via": "twilio"}'
         WHERE municipio_id = $1`,
        [MUNICIPIO_ID],
      );
      const r = await ctx
        .http()
        .get('/v1/painel/chamadas-saida/config')
        .set(chefe)
        .expect(200);
      expect(r.body).toEqual({
        ativo: false,
        motivos: [],
        numero_id: null,
        via: 'twilio',
        agente_configurado: true,
        elevenlabs_disponivel: false,
      });
    });

    it("PUT config: ativo sem número → 422; perfil sem 'agente' → 403", async () => {
      const semNumero = await guardarConfig({
        ...CONFIG_LIGADA,
        numero_id: null,
      }).expect(422);
      expect(semNumero.body.erro.codigo).toBe('sem_numero_saida');

      const invalida = await guardarConfig({
        ativo: true,
        motivos: ['nao_existe'],
        numero_id: 'x',
      }).expect(400);
      expect(invalida.body.erro.codigo).toBe('pedido_invalido');

      const tecnico = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'tecnico'),
      );
      const r = await ctx
        .http()
        .get('/v1/painel/chamadas-saida/config')
        .set(tecnico)
        .expect(403);
      expect(r.body.erro).toMatchObject({
        codigo: 'sem_permissao',
        detalhes: { recurso: 'agente' },
      });
    });

    it('config desligada: o aviso de mudança de fase vai por SMS', async () => {
      const p = await novoProcesso('telefone');
      await mudarFase(p.processoId, 'documentos');

      const sms = await esperarSmsEnviado(ctx, p.telefone, 'processo');
      expect(sms.relacionado).toMatchObject({ processo_id: p.processoId });
      expect(sms.corpo).toContain(p.numero);
      const chamadas = await linhas(
        ctx.db,
        'SELECT id FROM chamadas_saida WHERE processo_id = $1',
        [p.processoId],
      );
      expect(chamadas).toHaveLength(0);
      const ev = await linha(
        ctx.db,
        `SELECT dados FROM processo_eventos WHERE processo_id = $1 AND tipo = 'avisado'`,
        [p.processoId],
      );
      expect(ev.dados).toMatchObject({ fase: 'documentos', canal: 'sms' });
    });

    it('ligar com a config desligada → 409 chamada_nao_permitida', async () => {
      const p = await novoProcesso();
      const r = await ligar(p.processoId, chefe).expect(409);
      expect(r.body.erro).toMatchObject({
        codigo: 'chamada_nao_permitida',
        detalhes: { motivo: 'desligado' },
      });
    });

    it('PUT config liga as chamadas (GET devolve o mesmo)', async () => {
      const r = await guardarConfig({
        ...CONFIG_LIGADA,
        motivos: ['processo_fase', 'processo_fase'],
      }).expect(200);
      expect(r.body).toEqual({
        ...CONFIG_LIGADA,
        agente_configurado: true,
        elevenlabs_disponivel: false,
      });
      const g = await ctx
        .http()
        .get('/v1/painel/chamadas-saida/config')
        .set(chefe)
        .expect(200);
      expect(g.body).toEqual(r.body);
    });

    it('config ligada e canal telefone: o aviso agenda uma chamada; sem ElevenLabs falha e vai o SMS de recurso', async () => {
      const p = await novoProcesso('telefone');
      await mudarFase(p.processoId, 'documentos');

      const c = await linha(
        ctx.db,
        `SELECT id, estado, motivo, municipe_id, telefone_e164, recurso, agendada_para, contexto
         FROM chamadas_saida WHERE processo_id = $1`,
        [p.processoId],
      );
      expect(c).toMatchObject({
        estado: 'agendada',
        motivo: 'processo_fase',
        municipe_id: p.municipeId,
        telefone_e164: p.telefone,
        recurso: {
          motivo: 'processo',
          chave: `processo_fase:${p.processoId}:documentos`,
        },
        contexto: { numero_processo: p.numero },
      });
      // Hoje é feriado: fica para o próximo dia útil às 10h.
      expect(new Date(c.agendada_para).getTime()).toBeGreaterThan(Date.now());
      expect(local(new Date(c.agendada_para)).hora).toBe(10);
      // O SMS fica de recurso: ainda não foi.
      expect(await smsPara(ctx, p.telefone, 'processo')).toHaveLength(0);
      const ev = await linha(
        ctx.db,
        `SELECT dados FROM processo_eventos WHERE processo_id = $1 AND tipo = 'avisado'`,
        [p.processoId],
      );
      expect(ev.dados).toMatchObject({ canal: 'chamada' });

      // Pôr a chamada na hora (como a equipa interna faria) e acordar o job
      // em vez de esperar pelo cron do minuto seguinte.
      await ctx.db.query(
        `UPDATE chamadas_saida SET agendada_para = now(), forcar_horario = true WHERE id = $1`,
        [c.id],
      );
      await ctx.app.get(JobsService).enviar(FILA_CHAMADAS_SAIDA, {});

      const fim = await esperarAte(
        () =>
          linha<{ recurso_sms_id: string | null }>(
            ctx.db,
            `SELECT estado, erro, recurso_sms_id, terminada_em FROM chamadas_saida
             WHERE id = $1 AND estado <> 'agendada'`,
            [c.id],
          ),
        75_000,
      );
      expect(fim).toMatchObject({
        estado: 'falhou',
        erro: expect.stringContaining('ELEVENLABS_API_KEY'),
        recurso_sms_id: expect.any(String),
        terminada_em: expect.any(Date),
      });
      const sms = await esperarSmsEnviado(ctx, p.telefone, 'processo');
      expect(sms.id).toBe(fim.recurso_sms_id);
      expect(sms.relacionado).toMatchObject({
        processo_id: p.processoId,
        chamada_saida_id: c.id,
      });
      const evento = await linha(
        ctx.db,
        `SELECT descricao, interno FROM processo_eventos
         WHERE processo_id = $1 AND tipo = 'chamada_saida'`,
        [p.processoId],
      );
      expect(evento).toMatchObject({ interno: true });
    }, 90_000);

    it('config ligada mas sem preferência: a mudança de fase vai por SMS (não liga)', async () => {
      const p = await novoProcesso(null);
      await mudarFase(p.processoId, 'apreciacao');
      await esperarSmsEnviado(ctx, p.telefone, 'processo');
      expect(
        await linhas(
          ctx.db,
          'SELECT id FROM chamadas_saida WHERE processo_id = $1',
          [p.processoId],
        ),
      ).toHaveLength(0);
    });

    it('POST /processos/:id/ligar fora de horas → agendada para o próximo período', async () => {
      const p = await novoProcesso('sms'); // a manual ignora a preferência
      const r = await ligar(p.processoId, chefe, {
        nota: 'Falta a planta.',
      }).expect(200);
      expect(r.body).toMatchObject({
        id: expect.any(String),
        motivo: 'manual',
        estado: 'agendada',
        tentativas: 0,
        processo_id: p.processoId,
        contexto: expect.objectContaining({
          numero_processo: p.numero,
          nota: 'Falta a planta.',
          link: expect.stringMatching(/\/r\/[A-Z0-9]+$/),
        }),
      });
      const para = new Date(r.body.agendada_para);
      expect(para.getTime()).toBeGreaterThan(Date.now());
      expect(local(para).hora).toBe(10);
      expect(local(para).dia).not.toBe(local(new Date()).dia);

      const c = await linha(
        ctx.db,
        'SELECT criada_por, forcar_horario FROM chamadas_saida WHERE id = $1',
        [r.body.id],
      );
      expect(c).toMatchObject({ forcar_horario: false });
      expect(c.criada_por).toEqual(expect.any(String));

      // Já há uma por fazer a este munícipe.
      const outra = await ligar(p.processoId, chefe).expect(409);
      expect(outra.body.erro.detalhes).toEqual({ motivo: 'ja_tem_chamada' });

      // Aparece na lista do painel.
      const lista = await ctx
        .http()
        .get('/v1/painel/chamadas-saida')
        .query({ estado: 'agendada', limite: 200 })
        .set(chefe)
        .expect(200);
      expect(
        lista.body.itens.find((i: { id: string }) => i.id === r.body.id),
      ).toMatchObject({ processo_numero: p.numero, motivo: 'manual' });
    });

    it('forcar_horario: perfil não interno → 403; a equipa interna liga já (sem ElevenLabs falha e vai o SMS)', async () => {
      const p = await novoProcesso();
      const proibido = await ligar(p.processoId, chefe, {
        forcar_horario: true,
      }).expect(403);
      expect(proibido.body.erro.codigo).toBe('sem_permissao');
      expect(
        await linhas(
          ctx.db,
          'SELECT id FROM chamadas_saida WHERE processo_id = $1',
          [p.processoId],
        ),
      ).toHaveLength(0);

      const admin = await entrarPainel(
        ctx,
        await criarUtilizador(ctx, 'admin'),
      );
      const r = await ligar(p.processoId, admin, {
        forcar_horario: true,
      }).expect(200);
      expect(r.body).toMatchObject({
        estado: 'falhou',
        erro: expect.stringContaining('ELEVENLABS_API_KEY'),
        recurso_sms_id: expect.any(String),
      });
      const sms = await esperarSmsEnviado(ctx, p.telefone, 'processo');
      expect(sms.corpo).toContain(
        `tentámos ligar-lhe sobre o processo ${p.numero}`,
      );
    });

    it('processo inexistente → 404; id inválido → 400', async () => {
      const r = await ligar(randomUUID(), chefe).expect(404);
      expect(r.body.erro.codigo).toBe('nao_encontrado');
      await ligar('nao-e-uuid', chefe).expect(400);
    });

    it('a conversa da chamada de saída (caller = linha da câmara) liga-se ao munícipe chamado; motivo_da_chamada e nao_quero_chamadas', async () => {
      const p = await novoProcesso();
      const r = await ligar(p.processoId, chefe).expect(200);
      expect(r.body.estado).toBe('agendada');
      // O ElevenLabs devolve o conversation_id ao pedir a chamada.
      const ref = novaConversa('saida');
      await ctx.db.query(
        'UPDATE chamadas_saida SET provider_conversa_ref = $2 WHERE id = $1',
        [r.body.id, ref],
      );
      const chamada = { conversa: ref, telefone: LINHA_CAMARA };

      const motivo = await ferramenta(ctx, chamada, 'motivo_da_chamada').expect(
        200,
      );
      expect(motivo.body).toEqual({
        chamada_de_saida: true,
        motivo: 'o técnico pediu para falar consigo sobre o processo',
        numero_processo: p.numero,
        o_que_mudou: expect.any(String),
        o_que_falta: expect.any(String),
        prazo: '',
        instrucao: expect.any(String),
      });

      const cv = await linha(
        ctx.db,
        'SELECT municipe_id FROM conversas WHERE id = $1',
        [await conversaId(ctx, ref)],
      );
      expect(cv?.municipe_id).toBe(p.municipeId);
      const daLinha = await linha(
        ctx.db,
        'SELECT count(*)::int AS n FROM municipes WHERE municipio_id = $1 AND telefone_e164 = $2',
        [MUNICIPIO_ID, LINHA_CAMARA],
      );
      expect(daLinha?.n).toBe(0);

      // "Não me liguem mais": grava a recusa e cancela a chamada agendada.
      const nao = await ferramenta(ctx, chamada, 'nao_quero_chamadas').expect(
        200,
      );
      expect(nao.body).toMatchObject({
        gravado: true,
        dizer: expect.any(String),
      });
      const m = await linha(
        ctx.db,
        'SELECT aceita_chamadas FROM municipes WHERE id = $1',
        [p.municipeId],
      );
      expect(m?.aceita_chamadas).toBe(false);
      const c = await linha(
        ctx.db,
        'SELECT estado, recurso_sms_id FROM chamadas_saida WHERE id = $1',
        [r.body.id],
      );
      expect(c).toMatchObject({
        estado: 'cancelada',
        recurso_sms_id: expect.any(String),
      });
      await esperarSmsEnviado(ctx, p.telefone, 'processo');

      // Nem à mão se volta a ligar.
      const outra = await ligar(p.processoId, chefe).expect(409);
      expect(outra.body.erro.detalhes).toEqual({ motivo: 'recusa_chamadas' });
    });

    it('motivo_da_chamada numa chamada de entrada → chamada_de_saida: false', async () => {
      const r = await ferramenta(
        ctx,
        novaChamada(),
        'motivo_da_chamada',
      ).expect(200);
      expect(r.body).toEqual({
        chamada_de_saida: false,
        instrucao: expect.any(String),
      });
    });

    it('nao_quero_chamadas numa chamada de entrada grava o opt-out do munícipe que liga', async () => {
      const chamada = novaChamada();
      const r = await ferramenta(ctx, chamada, 'nao_quero_chamadas').expect(
        200,
      );
      expect(r.body.gravado).toBe(true);
      const m = await linha(
        ctx.db,
        'SELECT aceita_chamadas FROM municipes WHERE municipio_id = $1 AND telefone_e164 = $2',
        [MUNICIPIO_ID, chamada.telefone],
      );
      expect(m?.aceita_chamadas).toBe(false);
      const audit = await linha(
        ctx.db,
        `SELECT count(*)::int AS n FROM audit_log
         WHERE acao = 'recusar_chamadas' AND objeto_id = (
           SELECT id::text FROM municipes WHERE municipio_id = $1 AND telefone_e164 = $2)`,
        [MUNICIPIO_ID, chamada.telefone],
      );
      expect(audit?.n).toBe(1);

      // Sem telefone nem conversa: não sabe quem é.
      const anonimo = await ferramenta(
        ctx,
        undefined,
        'nao_quero_chamadas',
      ).expect(200);
      expect(anonimo.body).toMatchObject({ gravado: false });
    });

    it('a linha da câmara sem chamada de saída não vira munícipe', async () => {
      const ref = novaConversa('linha');
      await ferramenta(
        ctx,
        { conversa: ref, telefone: LINHA_CAMARA },
        'motivo_da_chamada',
      ).expect(200);
      const cv = await linha(
        ctx.db,
        'SELECT municipe_id FROM conversas WHERE provider_id = $1',
        [ref],
      );
      expect(cv).toEqual({ municipe_id: null });
      const n = await linha(
        ctx.db,
        'SELECT count(*)::int AS n FROM municipes WHERE municipio_id = $1 AND telefone_e164 = $2',
        [MUNICIPIO_ID, LINHA_CAMARA],
      );
      expect(n?.n).toBe(0);
    });
  });
});
