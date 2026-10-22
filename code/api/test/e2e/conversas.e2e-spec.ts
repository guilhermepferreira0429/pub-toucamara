/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { createHmac, randomInt, randomUUID } from 'crypto';
import { SEGREDO_AGENTE, SEGREDO_ELEVENLABS } from './ambiente';
import {
  arrancarApp,
  Chamada,
  Contexto,
  conversaId,
  entrarPainel,
  esperarAte,
  esperarSmsEnviado,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
  novoTelefone,
  seguirLink,
  smsPara,
} from './app';

const AGENTE = 'agente-e2e'; // agente_config.elevenlabs_agent_id do seed
const LINHA = '+351253000000'; // telefone_linha do município de teste

/** NIF português válido aleatório (9 dígitos com dígito de controlo). */
function novoNif(): string {
  const base = `2${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const soma = [...base].reduce((s, d, i) => s + Number(d) * (9 - i), 0);
  const controlo = 11 - (soma % 11);
  return `${base}${controlo >= 10 ? 0 : controlo}`;
}

/** O header `ElevenLabs-Signature` como o ElevenLabs o calcula. */
function assinatura(
  raw: string,
  t = Math.floor(Date.now() / 1000),
  segredo = SEGREDO_ELEVENLABS,
): string {
  const hex = createHmac('sha256', segredo).update(`${t}.${raw}`).digest('hex');
  return `t=${t},v0=${hex}`;
}

/** POST do fim da chamada com o corpo tal como foi assinado. */
function webhookFim(ctx: Contexto, corpo: object, header?: string | null) {
  const raw = JSON.stringify(corpo);
  const r = ctx
    .http()
    .post('/v1/webhooks/elevenlabs/conversa-terminada')
    .set('Content-Type', 'application/json');
  if (header !== null) r.set('ElevenLabs-Signature', header ?? assinatura(raw));
  return r.send(raw);
}

const TURNOS = [
  {
    role: 'agent',
    message: 'Olá, fala com o Tou, Câmara?',
    time_in_call_secs: 0,
  },
  {
    role: 'user',
    message: 'Quero abrir uma porta na fachada.',
    time_in_call_secs: 4,
  },
  { role: 'agent', message: null, time_in_call_secs: 6 }, // só ferramenta
  {
    role: 'agent',
    message: 'Isso é comunicação prévia, posso preencher consigo.',
    time_in_call_secs: 9,
  },
];

/** Payload `post_call_transcription` de uma chamada. */
function transcricao(
  chamada: Partial<Chamada> & { conversa: string },
  opcoes: {
    inicioS?: number;
    duracaoS?: number;
    turnos?: object[];
    variaveis?: Record<string, string>;
    consentimento?: boolean;
    agente?: string;
  } = {},
) {
  const agora = Math.floor(Date.now() / 1000);
  const duracaoS = opcoes.duracaoS ?? 120;
  return {
    type: 'post_call_transcription',
    event_timestamp: agora,
    data: {
      agent_id: opcoes.agente ?? AGENTE,
      conversation_id: chamada.conversa,
      status: 'done',
      transcript: opcoes.turnos ?? TURNOS,
      metadata: {
        start_time_unix_secs: opcoes.inicioS ?? agora - duracaoS,
        call_duration_secs: duracaoS,
        termination_reason: 'client disconnected',
      },
      analysis: {
        call_successful: 'success',
        transcript_summary: 'Porta na fachada.',
        data_collection_results: opcoes.consentimento
          ? { consentimento_gravacao: { value: true } }
          : {},
      },
      conversation_initiation_client_data: {
        dynamic_variables: {
          ...(chamada.telefone ? { system__caller_id: chamada.telefone } : {}),
          ...(opcoes.variaveis ?? {}),
        },
      },
    },
  };
}

function inicioChamada(ctx: Contexto, chamada: Chamada, agente = AGENTE) {
  return ctx
    .http()
    .post('/v1/webhooks/elevenlabs/inicio-chamada')
    .set('X-Agente-Segredo', SEGREDO_AGENTE)
    .send({
      caller_id: chamada.telefone,
      agent_id: agente,
      called_number: LINHA,
      call_sid: `CA${randomUUID().slice(0, 8)}`,
      conversation_id: chamada.conversa,
    });
}

const VARIAVEIS_VAZIAS = {
  nome_municipe: '',
  ja_ligou: 'nao',
  ultima_conversa_quando: '',
  ultima_conversa_resumo: '',
  pendentes: '',
  ultima_conversa_id: '',
  tipo_chamada: 'entrada',
};

/** Conversas e webhooks do ElevenLabs, retomar, painel e resumo público. */
describe('Conversas (e2e)', () => {
  let ctx: Contexto;
  let painel: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    painel = await entrarPainel(ctx);
  });
  afterAll(() => ctx.fechar());

  describe('início da chamada', () => {
    it('sem segredo → 401 nao_autenticado', async () => {
      const r = await ctx
        .http()
        .post('/v1/webhooks/elevenlabs/inicio-chamada')
        .send({ caller_id: '+351912345678', agent_id: AGENTE })
        .expect(401);
      expect(r.body.erro.codigo).toBe('nao_autenticado');
    });

    it('número desconhecido → todas as variáveis, vazias, e não cria nada', async () => {
      const chamada = novaChamada();
      const r = await inicioChamada(ctx, chamada).expect(200);
      expect(r.body).toEqual({
        type: 'conversation_initiation_client_data',
        dynamic_variables: expect.objectContaining(VARIAVEIS_VAZIAS),
      });
      // Todas strings (o ElevenLabs recusa a chamada se faltar alguma).
      for (const v of Object.values(r.body.dynamic_variables)) {
        expect(typeof v).toBe('string');
      }
      const m = await linha(
        ctx.db,
        'SELECT 1 FROM municipes WHERE telefone_e164 = $1',
        [chamada.telefone],
      );
      expect(m).toBeUndefined();
      const c = await linha(
        ctx.db,
        'SELECT 1 FROM conversas WHERE provider_id = $1',
        [chamada.conversa],
      );
      expect(c).toBeUndefined();
    });

    it('agente desconhecido e número que não é a linha → sem contexto (nunca falha)', async () => {
      const r = await ctx
        .http()
        .post('/v1/webhooks/elevenlabs/inicio-chamada')
        .set('X-Agente-Segredo', SEGREDO_AGENTE)
        .send({ caller_id: '+351912345678', agent_id: 'outro-agente' })
        .expect(200);
      expect(r.body.dynamic_variables).toMatchObject(VARIAVEIS_VAZIAS);
    });
  });

  describe('fim da chamada (post_call_transcription)', () => {
    it('grava os turnos, tempos e resultado; repetir o webhook não duplica', async () => {
      const chamada = novaChamada();
      const corpo = transcricao(chamada, { duracaoS: 120 });
      const r = await webhookFim(ctx, corpo).expect(200);
      const id = await conversaId(ctx, chamada.conversa);
      expect(r.body).toEqual({ conversa_id: id, turnos: 3 });

      const turnos = await linhas(
        ctx.db,
        `SELECT ordem, papel::text AS papel, texto, inicio_ms, fim_ms
         FROM conversa_turnos WHERE conversa_id = $1 ORDER BY ordem`,
        [id],
      );
      expect(turnos).toEqual([
        {
          ordem: 1,
          papel: 'agente',
          texto: 'Olá, fala com o Tou, Câmara?',
          inicio_ms: 0,
          fim_ms: 4000,
        },
        {
          ordem: 2,
          papel: 'municipe',
          texto: 'Quero abrir uma porta na fachada.',
          inicio_ms: 4000,
          fim_ms: 9000,
        },
        {
          ordem: 3,
          papel: 'agente',
          texto: 'Isso é comunicação prévia, posso preencher consigo.',
          inicio_ms: 9000,
          fim_ms: 120000,
        },
      ]);
      const c = await linha(
        ctx.db,
        `SELECT c.canal::text AS canal, c.duracao_s, c.resultado::text AS resultado,
                c.consentimento_em, c.fora_de_horas,
                extract(epoch FROM c.terminada_em - c.iniciada_em)::int AS segundos,
                m.telefone_e164
         FROM conversas c LEFT JOIN municipes m ON m.id = c.municipe_id
         WHERE c.id = $1`,
        [id],
      );
      expect(c).toMatchObject({
        canal: 'telefone',
        duracao_s: 120,
        resultado: 'resolvida',
        consentimento_em: null,
        fora_de_horas: expect.any(Boolean),
        segundos: 120,
        telefone_e164: chamada.telefone,
      });

      // O ElevenLabs repete o mesmo payload: mesma resposta, mesmos turnos.
      const outra = await webhookFim(ctx, corpo).expect(200);
      expect(outra.body).toEqual(r.body);
      const n = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM conversa_turnos WHERE conversa_id = $1',
        [id],
      );
      expect(n?.n).toBe(3);
      const conversas = await linha<{ n: number }>(
        ctx.db,
        'SELECT count(*)::int AS n FROM conversas WHERE provider_id = $1',
        [chamada.conversa],
      );
      expect(conversas?.n).toBe(1);
    });

    it('completa a conversa criada pelas ferramentas e cita o trecho na resposta do agente', async () => {
      const chamada = novaChamada();
      // A chamada começou há 5 s; a pesquisa acontece "agora".
      const inicioS = Math.floor(Date.now() / 1000) - 5;
      await ferramenta(ctx, chamada, 'procurar_conhecimento', {
        pergunta: 'Preciso de licença para abrir uma porta na fachada?',
      }).expect(200);
      const id = await conversaId(ctx, chamada.conversa);

      const turnos = [
        { role: 'agent', message: 'Olá!', time_in_call_secs: 0 },
        {
          role: 'user',
          message: 'Posso abrir uma porta na fachada?',
          time_in_call_secs: 1,
        },
        {
          role: 'agent',
          message: 'É comunicação prévia, diz o RJUE.',
          time_in_call_secs: 30,
        },
      ];
      const r = await webhookFim(
        ctx,
        transcricao(chamada, { inicioS, duracaoS: 60, turnos }),
      ).expect(200);
      expect(r.body.conversa_id).toBe(id);

      const citacoes = await linhas<{ ordem: number; referencia: string }>(
        ctx.db,
        `SELECT t.ordem, tr.referencia FROM citacoes ct
         JOIN conversa_turnos t ON t.id = ct.turno_id
         JOIN trechos tr ON tr.id = ct.trecho_id
         WHERE t.conversa_id = $1`,
        [id],
      );
      expect(citacoes).toEqual(
        expect.arrayContaining([{ ordem: 3, referencia: 'art. 4.º, n.º 4' }]),
      );
    });

    it('sem nada dito pelo munícipe → caiu; com consentimento na análise → consentimento_em', async () => {
      const chamada = novaChamada();
      await webhookFim(
        ctx,
        transcricao(chamada, {
          duracaoS: 30,
          consentimento: true,
          turnos: [{ role: 'agent', message: 'Olá?', time_in_call_secs: 0 }],
        }),
      ).expect(200);
      const c = await linha(
        ctx.db,
        `SELECT resultado::text AS resultado, consentimento_em IS NOT NULL AS consentiu
         FROM conversas WHERE provider_id = $1`,
        [chamada.conversa],
      );
      expect(c).toEqual({ resultado: 'caiu', consentiu: true });
    });

    it('assinatura em falta, errada ou fora de tempo → 401 assinatura_invalida, sem gravar', async () => {
      const chamada = novaChamada();
      const corpo = transcricao(chamada);
      const raw = JSON.stringify(corpo);

      const semCabecalho = await webhookFim(ctx, corpo, null).expect(401);
      expect(semCabecalho.body.erro).toMatchObject({
        codigo: 'assinatura_invalida',
        detalhes: { motivo: 'sem_cabecalho' },
      });
      const errada = await webhookFim(
        ctx,
        corpo,
        assinatura(raw, undefined, 'outro-segredo'),
      ).expect(401);
      expect(errada.body.erro.detalhes.motivo).toBe('nao_confere');
      const velha = await webhookFim(
        ctx,
        corpo,
        assinatura(raw, Math.floor(Date.now() / 1000) - 3600),
      ).expect(401);
      expect(velha.body.erro.detalhes.motivo).toBe('fora_de_tempo');
      const formato = await webhookFim(ctx, corpo, 'v0=abc').expect(401);
      expect(formato.body.erro.detalhes.motivo).toBe('formato');

      const c = await linha(
        ctx.db,
        'SELECT 1 FROM conversas WHERE provider_id = $1',
        [chamada.conversa],
      );
      expect(c).toBeUndefined();
    });

    it('o agente de saída é do mesmo município: início e fim da chamada reconhecem-no', async () => {
      const SAIDA = 'agente-e2e-saida';
      await ctx.db.query(
        `UPDATE agente_config SET elevenlabs_agent_id_saida = $2 WHERE municipio_id = $1`,
        [MUNICIPIO_ID, SAIDA],
      );
      try {
        const chamada = novaChamada();
        await ferramenta(ctx, chamada, 'identificar_municipe', {
          nif: novoNif(),
          nome: 'Rui Saída Pinto',
        }).expect(200);
        // Sem a linha da câmara no número chamado: só o agente diz o município.
        const ini = await ctx
          .http()
          .post('/v1/webhooks/elevenlabs/inicio-chamada')
          .set('X-Agente-Segredo', SEGREDO_AGENTE)
          .send({
            caller_id: chamada.telefone,
            agent_id: SAIDA,
            called_number: '+351210000000',
          })
          .expect(200);
        expect(ini.body.dynamic_variables).toMatchObject({
          nome_municipe: 'Rui',
        });

        const nova = novaChamada();
        await webhookFim(ctx, transcricao(nova, { agente: SAIDA })).expect(200);
        const c = await linha<{ municipio_id: string }>(
          ctx.db,
          'SELECT municipio_id FROM conversas WHERE provider_id = $1',
          [nova.conversa],
        );
        expect(c?.municipio_id).toBe(MUNICIPIO_ID);
      } finally {
        await ctx.db.query(
          'UPDATE agente_config SET elevenlabs_agent_id_saida = NULL WHERE municipio_id = $1',
          [MUNICIPIO_ID],
        );
      }
    });

    it('agente sem município → 422 municipio_desconhecido', async () => {
      const r = await webhookFim(
        ctx,
        transcricao(novaChamada(), { agente: `agente-${randomUUID()}` }),
      ).expect(422);
      expect(r.body.erro.codigo).toBe('municipio_desconhecido');
    });

    it('payload inválido → 400 pedido_invalido; tipo desconhecido → ignorado', async () => {
      const inv = await webhookFim(ctx, {
        type: 'post_call_transcription',
        data: { agent_id: AGENTE },
      }).expect(400);
      expect(inv.body.erro.codigo).toBe('pedido_invalido');
      const ign = await webhookFim(ctx, { type: 'tipo_do_futuro' }).expect(200);
      expect(ign.body).toEqual({ ignorado: true });
    });

    it('post_call_audio: antes da transcrição 503; sem consentimento não guarda', async () => {
      const chamada = novaChamada();
      const audio = {
        type: 'post_call_audio',
        data: {
          agent_id: AGENTE,
          conversation_id: chamada.conversa,
          full_audio: Buffer.from('mp3 falso').toString('base64'),
        },
      };
      const cedo = await webhookFim(ctx, audio).expect(503);
      expect(cedo.body.erro.codigo).toBe('transcricao_por_chegar');

      await webhookFim(ctx, transcricao(chamada)).expect(200);
      const r = await webhookFim(ctx, audio).expect(200);
      expect(r.body).toEqual({ guardada: false, motivo: 'sem_consentimento' });

      // Com consentimento, mas sem S3 nos testes.
      const outra = novaChamada();
      await webhookFim(ctx, transcricao(outra, { consentimento: true })).expect(
        200,
      );
      const r2 = await webhookFim(ctx, {
        ...audio,
        data: { ...audio.data, conversation_id: outra.conversa },
      }).expect(200);
      expect(r2.body).toEqual({ guardada: false, motivo: 'sem_armazenamento' });
    });
  });

  describe('retomar a conversa', () => {
    it('continuacao_de: a chamada seguinte do mesmo número recebe a anterior no início e fica ligada a ela no fim', async () => {
      const telefone = novaChamada().telefone;
      const a: Chamada = { conversa: `conv-${randomUUID()}`, telefone };
      const agora = Math.floor(Date.now() / 1000);
      const nif = novoNif();
      await ferramenta(ctx, a, 'identificar_municipe', {
        nif,
        nome: 'Ana Retoma Costa',
      }).expect(200);
      await webhookFim(
        ctx,
        transcricao(a, { inicioS: agora - 600, duracaoS: 120 }),
      ).expect(200);
      const idA = await conversaId(ctx, a.conversa);

      // Pouco depois, volta a ligar do mesmo número.
      const b: Chamada = { conversa: `conv-${randomUUID()}`, telefone };
      const ini = await inicioChamada(ctx, b).expect(200);
      expect(ini.body.dynamic_variables).toMatchObject({
        nome_municipe: 'Ana',
        ja_ligou: 'sim',
        ultima_conversa_id: idA,
        ultima_conversa_quando: expect.any(String),
        tipo_chamada: 'entrada',
      });
      expect(ini.body.dynamic_variables.ultima_conversa_quando).not.toBe('');

      // As variáveis voltam no fim da chamada: é por aí que se liga.
      await webhookFim(
        ctx,
        transcricao(b, {
          inicioS: agora - 60,
          duracaoS: 50,
          variaveis: ini.body.dynamic_variables,
        }),
      ).expect(200);
      const idB = await conversaId(ctx, b.conversa);
      const cb = await linha<{ continuacao_de: string | null }>(
        ctx.db,
        'SELECT continuacao_de FROM conversas WHERE id = $1',
        [idB],
      );
      expect(cb?.continuacao_de).toBe(idA);

      // Repetir o webhook não muda a ligação.
      await webhookFim(
        ctx,
        transcricao(b, {
          inicioS: agora - 60,
          duracaoS: 50,
          variaveis: ini.body.dynamic_variables,
        }),
      ).expect(200);
      const cb2 = await linha<{ continuacao_de: string | null }>(
        ctx.db,
        'SELECT continuacao_de FROM conversas WHERE id = $1',
        [idB],
      );
      expect(cb2?.continuacao_de).toBe(idA);

      // Painel: o detalhe de B mostra o histórico, com A marcada.
      const d = await ctx
        .http()
        .get(`/v1/painel/conversas/${idB}`)
        .set(painel)
        .expect(200);
      expect(d.body).toMatchObject({
        id: idB,
        continuacao_de: idA,
        municipe: {
          nome: 'Ana Retoma Costa',
          telefone: expect.stringContaining('•'),
          conversas_anteriores: 1,
        },
        historico_municipe: [
          { id: idA, canal: 'telefone', continuada_por_esta: true },
        ],
      });
      expect(JSON.stringify(d.body)).not.toContain(nif);
    });

    it('uma conversa anterior de emergência não serve de contexto', async () => {
      const telefone = novaChamada().telefone;
      const a: Chamada = { conversa: `conv-${randomUUID()}`, telefone };
      await ferramenta(ctx, a, 'emergencia', { situacao: 'incêndio' }).expect(
        200,
      );
      await webhookFim(ctx, transcricao(a)).expect(200);
      const ini = await inicioChamada(ctx, {
        conversa: `conv-${randomUUID()}`,
        telefone,
      }).expect(200);
      expect(ini.body.dynamic_variables).toMatchObject({
        ja_ligou: 'nao',
        ultima_conversa_id: '',
      });
    });

    it('ferramenta conversa_anterior: devolve a última e liga a conversa atual a ela', async () => {
      const telefone = novaChamada().telefone;
      const a: Chamada = { conversa: `conv-${randomUUID()}`, telefone };
      await webhookFim(
        ctx,
        transcricao(a, {
          inicioS: Math.floor(Date.now() / 1000) - 300,
          duracaoS: 60,
        }),
      ).expect(200);
      const idA = await conversaId(ctx, a.conversa);

      const c: Chamada = { conversa: `conv-${randomUUID()}`, telefone };
      const r = await ferramenta(ctx, c, 'conversa_anterior', {}).expect(200);
      expect(r.body).toMatchObject({
        encontradas: 1,
        conversas: [
          {
            canal: 'telefone',
            resultado: 'resolvida',
            quando: expect.any(String),
            resumo: 'Ainda sem resumo (a conversa terminou há pouco).',
            proximos_passos: [],
          },
        ],
        instrucao: expect.any(String),
      });
      const idC = await conversaId(ctx, c.conversa);
      const lig = await linha<{ continuacao_de: string }>(
        ctx.db,
        'SELECT continuacao_de FROM conversas WHERE id = $1',
        [idC],
      );
      expect(lig?.continuacao_de).toBe(idA);
    });

    it('conversa_anterior sem conversas nem identificação', async () => {
      // Número novo: munícipe criado agora, sem conversas antes.
      const novo = await ferramenta(ctx, novaChamada(), 'conversa_anterior', {
        quantas: 3,
      }).expect(200);
      expect(novo.body).toEqual({
        encontradas: 0,
        instrucao: expect.stringContaining('30 dias'),
      });
      // Sem número nem conversa: pede o NIF.
      const anonimo = await ferramenta(
        ctx,
        undefined,
        'conversa_anterior',
        {},
      ).expect(200);
      expect(anonimo.body).toEqual({
        precisa_identificacao: true,
        instrucao: expect.stringContaining('NIF'),
      });
      const inv = await ferramenta(ctx, novaChamada(), 'conversa_anterior', {
        quantas: 9,
      }).expect(400);
      expect(inv.body.erro.codigo).toBe('pedido_invalido');
    });
  });

  describe('Painel · conversas', () => {
    it('sem sessão → 401 nao_autenticado', async () => {
      const r = await ctx.http().get('/v1/painel/conversas').expect(401);
      expect(r.body.erro.codigo).toBe('nao_autenticado');
      await ctx.http().get(`/v1/painel/conversas/${randomUUID()}`).expect(401);
    });

    it('lista: a primeira fonte citada na conversa', async () => {
      const chamada = novaChamada();
      const desde = new Date(Date.now() - 1000).toISOString();
      await webhookFim(
        ctx,
        transcricao(chamada, { inicioS: Math.floor(Date.now() / 1000) }),
      ).expect(200);
      const id = await conversaId(ctx, chamada.conversa);
      // A resposta do agente (ordem 3) citou dois trechos do RJUE do seed.
      await ctx.db.query(
        `INSERT INTO citacoes (turno_id, trecho_id)
         SELECT ct.id, t.id FROM conversa_turnos ct, trechos t
         WHERE ct.conversa_id = $1 AND ct.ordem = 3
           AND t.fonte_versao_id = '00000000-0000-0000-0000-0000000000f2'`,
        [id],
      );
      const l = await ctx
        .http()
        .get('/v1/painel/conversas')
        .query({ de: desde, limite: 200 })
        .set(painel)
        .expect(200);
      const item = (l.body.itens as any[]).find((x) => x.id === id);
      expect(item.fonte).toEqual({
        titulo: 'RJUE',
        url: 'https://exemplo.pt/rjue',
        referencia: 'art. 6.º, n.º 1',
      });
    });

    it('lista e detalhe com turnos e momentos; ver fica na auditoria', async () => {
      const chamada = novaChamada();
      const desde = new Date(Date.now() - 1000).toISOString();
      await ferramenta(ctx, chamada, 'passar_a_humano', {
        motivo: 'pedido',
        resumo: 'Quer falar com uma pessoa sobre a porta na fachada.',
      }).expect(200);
      await webhookFim(
        ctx,
        transcricao(chamada, {
          inicioS: Math.floor(Date.now() / 1000),
          duracaoS: 40,
        }),
      ).expect(200);
      const id = await conversaId(ctx, chamada.conversa);

      const l = await ctx
        .http()
        .get('/v1/painel/conversas')
        .query({
          canal: 'telefone',
          resultado: 'passada_funcionario',
          de: desde,
          limite: 200,
        })
        .set(painel)
        .expect(200);
      const item = (l.body.itens as any[]).find((x) => x.id === id);
      expect(item).toEqual({
        id,
        canal: 'telefone',
        iniciada_em: expect.any(String),
        duracao_s: 40,
        resultado: 'passada_funcionario',
        fora_de_horas: expect.any(Boolean),
        resumo: null,
        revisao: null,
        tema: null,
        municipe: {
          id: expect.any(String),
          nome: null,
          telefone: expect.stringContaining('•'),
        },
        momentos: 1,
        fonte: null,
      });
      expect(JSON.stringify(item)).not.toContain(chamada.telefone);

      // Filtro que exclui: resolvida
      const outras = await ctx
        .http()
        .get('/v1/painel/conversas')
        .query({ resultado: 'resolvida', de: desde, limite: 200 })
        .set(painel)
        .expect(200);
      expect((outras.body.itens as any[]).some((x) => x.id === id)).toBe(false);

      const d = await ctx
        .http()
        .get(`/v1/painel/conversas/${id}`)
        .set(painel)
        .expect(200);
      expect(d.body).toMatchObject({
        id,
        canal: 'telefone',
        duracao_s: 40,
        resultado: 'passada_funcionario',
        tem_gravacao: false,
        continuacao_de: null,
        historico_municipe: [],
        turnos: [
          { ordem: 1, papel: 'agente' },
          {
            ordem: 2,
            papel: 'municipe',
            texto: 'Quero abrir uma porta na fachada.',
          },
          { ordem: 3, papel: 'agente' },
        ],
        momentos: [{ tipo: 'passagem', em_ms: expect.any(Number) }],
        criado: { passagens: [expect.anything()] },
        revisao: { valor: null },
      });
      const aud = await linha<{ n: number }>(
        ctx.db,
        `SELECT count(*)::int AS n FROM audit_log
         WHERE objeto_tipo = 'conversa' AND objeto_id = $1 AND acao = 'ver'`,
        [id],
      );
      expect(aud?.n).toBe(1);
    });

    it('detalhe de conversa inexistente → 404; id inválido → 400; filtro inválido → 400', async () => {
      const a = await ctx
        .http()
        .get(`/v1/painel/conversas/${randomUUID()}`)
        .set(painel)
        .expect(404);
      expect(a.body.erro.codigo).toBe('conversa_nao_encontrada');
      await ctx
        .http()
        .get('/v1/painel/conversas/nao-e-uuid')
        .set(painel)
        .expect(400);
      const f = await ctx
        .http()
        .get('/v1/painel/conversas')
        .query({ resultado: 'talvez' })
        .set(painel)
        .expect(400);
      expect(f.body.erro.codigo).toBe('pedido_invalido');
    });
  });

  describe('resumo público', () => {
    it('o SMS do fim da chamada leva o link do resumo; o link abre a página "O que tem de fazer"', async () => {
      const chamada = novaChamada();
      await webhookFim(ctx, transcricao(chamada)).expect(200);
      const id = await conversaId(ctx, chamada.conversa);

      // O SMS espera 45 s pelo resumo (pg-boss start_after): adianta-se o job.
      await esperarAte(async () => {
        const r = await ctx.db.query(
          `UPDATE pgboss.job SET start_after = now()
           WHERE name = 'sms_fim_chamada' AND singleton_key = $1
             AND state = 'created'
           RETURNING id`,
          [id],
        );
        return (r.rowCount ?? 0) > 0;
      });
      const sms = await esperarSmsEnviado(ctx, chamada.telefone, 'fim_chamada');
      expect(sms.corpo).toMatch(
        /^Teste: obrigado por ligar\. .* http:\/\/web\.e2e\.local\/r\/[A-Z0-9]{6}$/,
      );
      expect(sms.relacionado).toEqual({ conversa_id: id });
      const url = /(http\S+\/r\/[A-Z0-9]+)$/.exec(sms.corpo)![1];

      // Fica um momento 'sms' com o código do link.
      const { destino, token } = await seguirLink(ctx, url);
      expect(destino).toBe('resumo');
      const momento = await linha<{ dados: any }>(
        ctx.db,
        `SELECT dados FROM conversa_momentos WHERE conversa_id = $1 AND tipo = 'sms'`,
        [id],
      );
      expect(momento?.dados).toMatchObject({
        motivo: 'fim_chamada',
        mensagem_id: sms.id,
        link: token,
      });

      const r = await ctx.http().get(`/v1/public/resumos/${token}`).expect(200);
      expect(r.body).toEqual({
        municipio: { nome: 'Teste', telefone: LINHA },
        data: expect.any(String),
        resumo: null, // sem IA não há texto para o munícipe
        resumo_pronto: false,
        proximos_passos: [],
        criado: [],
      });
      // O código também vale em minúsculas; a abertura ficou contada.
      await ctx
        .http()
        .get(`/v1/public/resumos/${token.toLowerCase()}`)
        .expect(200);
      const l = await linha<{ aberturas: number }>(
        ctx.db,
        'SELECT aberturas FROM links_curtos WHERE codigo = $1',
        [token],
      );
      expect(l?.aberturas).toBe(1);
      // Só um SMS de fim de chamada por conversa.
      expect(await smsPara(ctx, chamada.telefone, 'fim_chamada')).toHaveLength(
        1,
      );
    });

    it('código inexistente → 404 link_invalido; código mal formado → 400', async () => {
      const a = await ctx.http().get('/v1/public/resumos/ZZZZ99').expect(404);
      expect(a.body.erro.codigo).toBe('link_invalido');
      const b = await ctx.http().get('/v1/public/resumos/a!').expect(400);
      expect(b.body.erro.codigo).toBe('pedido_invalido');
    });
  });
  describe('chamada pelo browser', () => {
    it('sem system__caller_id, o número vem da variável telefone da página /ligar', async () => {
      const chamada = novaChamada();
      const telefone = novoTelefone();
      await webhookFim(
        ctx,
        transcricao(
          { conversa: chamada.conversa },
          { variaveis: { system__caller_id: '', telefone } },
        ),
      ).expect(200);
      const c = await linha<{ telefone_e164: string | null }>(
        ctx.db,
        `SELECT m.telefone_e164 FROM conversas c
         LEFT JOIN municipes m ON m.id = c.municipe_id
         WHERE c.provider_id = $1`,
        [chamada.conversa],
      );
      expect(c?.telefone_e164).toBe(telefone);
    });
  });
});
