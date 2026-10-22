/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import {
  ChamadasSaidaService,
  ERRO_SIMULADA,
} from '../../src/modules/chamadas-saida/chamadas-saida.service';
import { MensagensService } from '../../src/modules/comunicacao/mensagens.service';
import { geometriaEmergencia } from '../../src/modules/emergencias/emergencias.regras';
import {
  FORMATO_SIMULADO,
  paginaSimulada,
  segmentos,
} from '../../src/modules/emergencias/operadores.regras';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  esperarAte,
  linha,
  linhas,
  MUNICIPIO_ID,
  novoTelefone,
} from './app';

/**
 * Avisos de emergência com a fonte "todas as pessoas na zona" (operadores)
 * SIMULADA e o cell broadcast simulado.
 *
 * A regra de segurança: os números simulados podem ser de pessoas reais e
 * NUNCA saem para o Twilio nem para o ElevenLabs, mesmo com SMS_PROVIDER=twilio.
 * Aqui o Twilio está "configurado" e o fetch é falso: regista cada pedido, e
 * o teste falha se algum for para um número simulado. Os munícipes reais
 * continuam a receber.
 */
const ESCALA = 0.02;

describe('Avisos de emergência · operadores e cell broadcast simulados (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  const fetchOriginal = global.fetch;
  /** Destinos de todos os pedidos que chegaram ao "Twilio". */
  const pedidosTwilio: string[] = [];
  /** Qualquer outro pedido para fora (não devia haver). */
  const outrosPedidos: string[] = [];
  /** Corpos dos pedidos de chamada ao ElevenLabs (falso). */
  const chamadasElevenLabs: string[] = [];
  const ambienteAntes = { ...process.env };

  const letras = Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + randomInt(26)),
  ).join('');
  // Longe das coordenadas dos outros ficheiros. Quadrado de ~1,6 km de lado.
  const base = {
    lat: 37.3 + Math.random() * 0.2,
    lng: -8.4 + Math.random() * 0.2,
  };
  const dLat = 0.8 / 111.195;
  const dLng = 0.8 / (111.195 * Math.cos((base.lat * Math.PI) / 180));
  const zona = {
    tipo: 'poligono' as const,
    pontos: [
      { lat: base.lat - dLat, lng: base.lng - dLng },
      { lat: base.lat - dLat, lng: base.lng + dLng },
      { lat: base.lat + dLat, lng: base.lng + dLng },
      { lat: base.lat + dLat, lng: base.lng - dLng },
    ],
    descricao: `Vale do rio (teste ${letras})`,
  };
  // Os números que a fonte simulada vai gerar para esta zona (mesmas regras).
  const segs = segmentos(MUNICIPIO_ID, geometriaEmergencia(zona), ESCALA);
  const N = segs.reduce((s, x) => s + x.total, 0);
  const gerados = paginaSimulada(segs, 0, N).numeros.map(
    (x) => x.telefone_e164,
  );

  /** Munícipe real cujo telemóvel coincide com um número simulado. */
  const M = { id: randomUUID(), tel: gerados[0] };
  /** Munícipe real com outro número, também na zona. */
  const R = { id: randomUUID(), tel: novoTelefone() };

  const NOVA = (extra: object = {}) => ({
    tipo: 'cheia',
    gravidade: 'emergencia',
    titulo: `Cheia no vale ${letras}`,
    mensagem_sms: 'Risco de cheia esta noite no vale do rio',
    zona,
    fontes: ['municipes', 'operadores'],
    ...extra,
  });
  const criar = (corpo: object, h = chefe) =>
    ctx.http().post('/v1/painel/emergencias').set(h).send(corpo);
  const enviar = (id: string, n: number, h = chefe) =>
    ctx
      .http()
      .post(`/v1/painel/emergencias/${id}/enviar`)
      .set(h)
      .send({ confirmo_destinatarios: n, confirmo_texto: 'ENVIAR' });
  const detalhe = (id: string) =>
    ctx.http().get(`/v1/painel/emergencias/${id}`).set(chefe).expect(200);

  beforeAll(async () => {
    Object.assign(process.env, {
      EMERGENCIAS_OPERADORES: 'simulada',
      EMERGENCIAS_CELL_BROADCAST: 'simulada',
      EMERGENCIAS_SIMULADA_ESCALA: String(ESCALA),
      EMERGENCIAS_SIMULADA_LATENCIA_MS: '1',
      EMERGENCIAS_SIMULADA_TAXA_ERRO: '0',
    });
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);

    // O Twilio "configurado": o envio real iria para lá.
    const config = ctx.app.get(ConfigService);
    config.set('comunicacao.smsProvider', 'twilio');
    config.set('comunicacao.twilio', { accountSid: 'ACemg', authToken: 'tok' });
    config.set('webhooks.elevenlabsApiKey', 'xi_emg');
    let sid = 0;
    global.fetch = jest.fn(
      (url: string | URL | Request, init?: RequestInit) => {
        const u =
          typeof url === 'string'
            ? url
            : url instanceof URL
              ? url.href
              : url.url;
        if (u.includes('api.twilio.com')) {
          const para =
            new URLSearchParams(init?.body as string).get('To') ?? '';
          pedidosTwilio.push(para);
          return Promise.resolve(
            new Response(JSON.stringify({ sid: `SMemg${++sid}` }), {
              status: 201,
            }),
          );
        }
        outrosPedidos.push(u);
        return Promise.reject(new Error(`Pedido inesperado para ${u}`));
      },
    ) as typeof fetch;
    // O ElevenLabs também é falso: nenhuma chamada de saída pode sair.
    ctx.app.get(ChamadasSaidaService).buscar = (_url, init) => {
      chamadasElevenLabs.push(
        typeof init?.body === 'string' ? init.body : JSON.stringify(init?.body),
      );
      return Promise.reject(new Error('ElevenLabs falso nos testes.'));
    };

    for (const [m, nome] of [
      [M, 'Marta Real'],
      [R, 'Rui Real'],
    ] as const) {
      await ctx.db.query(
        `INSERT INTO municipes (id, municipio_id, telefone_e164, nome) VALUES ($1, $2, $3, $4)`,
        [m.id, MUNICIPIO_ID, m.tel, nome],
      );
    }
    const cat = await linha<{ id: string }>(
      ctx.db,
      `SELECT id FROM categorias_ocorrencia WHERE municipio_id = $1 LIMIT 1`,
      [MUNICIPIO_ID],
    );
    for (const m of [M, R]) {
      await ctx.db.query(
        `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng, municipe_id)
         VALUES ($1, $2, $3, 'Teste de emergência', 'Rua do Vale', $4, $5, $6)`,
        [
          MUNICIPIO_ID,
          `EMO-${letras}-${randomInt(1e9)}`,
          cat!.id,
          base.lat,
          base.lng,
          m.id,
        ],
      );
    }
  });

  afterAll(async () => {
    global.fetch = fetchOriginal;
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('EMERGENCIAS_') && !(k in ambienteAntes)) {
        delete process.env[k];
      }
    }
    Object.assign(process.env, ambienteAntes);
    await ctx.fechar();
  });

  it('o cenário: a zona gera números simulados, no formato, e um coincide com um munícipe real', () => {
    expect(N).toBeGreaterThan(10);
    expect(new Set(gerados).size).toBe(N);
    for (const g of gerados) expect(g).toMatch(FORMATO_SIMULADO);
  });

  it('permissões: o técnico não simula; o atendimento simula com a fonte simulada mas não envia', async () => {
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    await criar({ ...NOVA(), simular: true }, tecnico).expect(403);
    const atend = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    const sim = await criar({ ...NOVA(), simular: true }, atend).expect(201);
    expect(sim.body.operadores).toMatchObject({ simulada: true });
    const c = await criar(NOVA(), atend).expect(201);
    const r = await enviar(c.body.id, N + 1, atend).expect(403);
    expect(r.body.erro.detalhes).toEqual({ recurso: 'agente' });
    await ctx
      .http()
      .post(`/v1/painel/emergencias/${c.body.id}/encerrar`)
      .set(chefe)
      .send({})
      .expect(200);
  });

  it('simular: quantos vêm de cada fonte, sem duplicar, e tempo e custo com a fonte externa', async () => {
    const r = await criar({ ...NOVA(), simular: true }).expect(201);
    const p = r.body;
    const op = p.fontes.find(
      (f: { fonte: string }) => f.fonte === 'operadores',
    );
    expect(op).toMatchObject({
      estado: 'ok',
      simulada: true,
      encontrados: N,
      nota: expect.stringContaining('SIMULADO'),
    });
    // M está nas duas fontes (conta uma vez e é real); R só nos munícipes.
    expect(p.destinatarios).toMatchObject({
      total: N + 1,
      por_fonte: { municipes: 2, operadores: N },
      so_desta_fonte: { municipes: 1, operadores: N - 1 },
      em_varias_fontes: 1,
      simulados: N - 1,
      reais: 2,
    });
    expect(p.operadores).toMatchObject({
      modo: 'simulada',
      simulada: true,
      novos: N - 1,
      ja_conhecidos: 1,
      estimativa: { gerados: N, demonstracao: true },
      escala_real: { demonstracao: true },
    });
    expect(p.operadores.escala_real.sms).toBe(
      p.operadores.estimativa.com_telemovel,
    );
    expect(p.operadores.escala_real.sms).toBeGreaterThan(N * 10);
    expect(p.aviso_simulado).toMatch(/SIMULADOS/);
    expect(p.fonte_externa.operadores.nota).toMatch(/ANEPC/);
    // Tempo e custo do plano já contam com a fonte externa (SMS e chamada a todos).
    expect(p.sms.total).toBe(N + 1);
    expect(p.chamadas.total).toBe(N + 1);
    expect(p.custo).toMatchObject({ demonstracao: true });
    expect(p.custo.sms).toBeGreaterThan(0);
    // Os reais primeiro na amostra.
    expect(p.amostra[0].simulado).toBe(false);
    expect(p.amostra.some((a: { simulado: boolean }) => a.simulado)).toBe(true);
    // Nada gravado nem enviado.
    expect(
      await linhas(
        ctx.db,
        `SELECT 1 FROM mensagens_saida WHERE destino = ANY($1)`,
        [gerados],
      ),
    ).toHaveLength(0);
  });

  it('freguesias: os números simulados são proporcionais à população (demonstração)', async () => {
    const r = await criar({
      ...NOVA(),
      zona: { tipo: 'freguesias', freguesias: ['Azurém', 'Silvares'] },
      fontes: ['operadores'],
      simular: true,
    }).expect(201);
    expect(r.body.fontes[0]).toMatchObject({
      estado: 'ok',
      encontrados: 171 + 45,
    });
    expect(r.body.operadores.estimativa).toMatchObject({
      pessoas: 9_500 + 2_500,
      demonstracao: true,
    });
  });

  let emergenciaId: string;

  it('enviar: registos simulados, zero pedidos ao fornecedor para eles; os munícipes reais recebem', async () => {
    const c = await criar(NOVA()).expect(201);
    emergenciaId = c.body.id;
    await enviar(emergenciaId, N + 1).expect(200);

    const msgs = await linhas<{
      id: string;
      destino: string;
      simulado: boolean;
      municipe_id: string | null;
    }>(
      ctx.db,
      `SELECT id, destino, simulado, municipe_id FROM mensagens_saida
       WHERE relacionado->>'emergencia_id' = $1 AND canal = 'sms'`,
      [emergenciaId],
    );
    expect(msgs).toHaveLength(N + 1);
    const simulados = msgs.filter((x) => x.simulado);
    expect(simulados).toHaveLength(N - 1);
    expect(simulados.every((x) => x.municipe_id === null)).toBe(true);
    // M (número coincidente) e R são reais.
    expect(
      msgs
        .filter((x) => !x.simulado)
        .map((x) => x.destino)
        .sort(),
    ).toEqual([M.tel, R.tel].sort());

    // O envio de todas (como o worker faz), com o Twilio configurado.
    const mensagens = ctx.app.get(MensagensService);
    for (const x of msgs) await mensagens.enviarAgora(x.id);
    await esperarAte(async () => {
      const r = await linhas(
        ctx.db,
        `SELECT 1 FROM mensagens_saida
         WHERE relacionado->>'emergencia_id' = $1 AND estado IN ('pendente','agendada')`,
        [emergenciaId],
      );
      return r.length === 0;
    });

    const simuladosDepois = new Set(simulados.map((x) => x.destino));
    expect(pedidosTwilio.filter((t) => simuladosDepois.has(t))).toEqual([]);
    expect(
      pedidosTwilio.filter((t) => FORMATO_SIMULADO.test(t) && t !== M.tel),
    ).toEqual([]);
    expect(pedidosTwilio).toEqual(expect.arrayContaining([M.tel, R.tel]));
    expect(outrosPedidos).toEqual([]);

    const estados = await linhas<{
      destino: string;
      estado: string;
      provider_id: string;
      simulado: boolean;
    }>(
      ctx.db,
      `SELECT destino, estado::text AS estado, provider_id, simulado FROM mensagens_saida
       WHERE relacionado->>'emergencia_id' = $1 AND canal = 'sms'`,
      [emergenciaId],
    );
    for (const x of estados) {
      expect(x.estado).toBe('enviada');
      if (x.simulado) expect(x.provider_id).toBe('simulado');
      else expect(x.provider_id).toMatch(/^SMemg/);
    }

    // Chamadas: os reais na campanha; os simulados só registados.
    const dest = await linhas<{
      telefone_e164: string;
      simulado: boolean;
      municipe_id: string | null;
      campanha_destinatario_id: string | null;
      chamada_simulada: boolean;
      fontes: string[];
    }>(
      ctx.db,
      `SELECT telefone_e164, simulado, municipe_id, campanha_destinatario_id, chamada_simulada, fontes
       FROM emergencia_destinatarios WHERE emergencia_id = $1`,
      [emergenciaId],
    );
    for (const d of dest.filter((x) => x.simulado)) {
      expect(d).toMatchObject({
        municipe_id: null,
        campanha_destinatario_id: null,
        chamada_simulada: true,
        fontes: ['operadores'],
      });
    }
    const marta = dest.find((x) => x.telefone_e164 === M.tel)!;
    expect(marta).toMatchObject({
      simulado: false,
      municipe_id: M.id,
      fontes: ['municipes', 'operadores'],
      campanha_destinatario_id: expect.any(String),
    });
    // Nenhum número simulado virou munícipe nem chamada de saída.
    const outrosSimulados = gerados.filter((g) => g !== M.tel);
    expect(
      await linhas(
        ctx.db,
        `SELECT 1 FROM chamadas_saida WHERE telefone_e164 = ANY($1)`,
        [outrosSimulados],
      ),
    ).toHaveLength(0);
    expect(
      await linhas(
        ctx.db,
        `SELECT 1 FROM municipes WHERE telefone_e164 = ANY($1)`,
        [outrosSimulados],
      ),
    ).toHaveLength(0);
    expect(
      chamadasElevenLabs.filter((b) =>
        outrosSimulados.some((g) => b.includes(g)),
      ),
    ).toEqual([]);

    // O acompanhamento: contagens por fonte e estado, "enviado (simulado)".
    const d = (await detalhe(emergenciaId)).body;
    expect(d.simulados).toEqual({
      total: N - 1,
      sms_enviados_simulado: N - 1,
      sms_por_sair: 0,
      chamadas_simuladas: N - 1,
      enviados_ao_fornecedor: 0,
    });
    expect(d.por_fonte).toMatchObject({ municipes: 2, operadores: N });
    expect(d.por_fonte_estado.operadores).toMatchObject({
      total: N,
      avisado: N,
    });
    expect(d.por_fonte_estado.municipes.total).toBe(2);
    expect(d.aviso_simulado).toMatch(/SIMULADOS/);
    const linhaSimulada = d.destinatarios.find(
      (x: { simulado: boolean }) => x.simulado,
    );
    expect(linhaSimulada).toMatchObject({
      resultado: 'avisado',
      chamada_simulada: true,
      fontes: ['operadores'],
    });

    const audit = await linha(
      ctx.db,
      `SELECT dados FROM audit_log WHERE acao = 'enviar_emergencia' AND objeto_id = $1`,
      [emergenciaId],
    );
    expect(audit.dados.simulados).toEqual({
      destinatarios: N - 1,
      sms: N - 1,
      chamadas: N - 1,
    });

    await ctx
      .http()
      .post(`/v1/painel/emergencias/${emergenciaId}/encerrar`)
      .set(chefe)
      .send({})
      .expect(200);
  });

  it('a BD recusa uma mensagem simulada com a referência de um fornecedor', async () => {
    await expect(
      ctx.db.query(
        `UPDATE mensagens_saida SET provider_id = 'SMfalso'
         WHERE relacionado->>'emergencia_id' = $1 AND simulado`,
        [emergenciaId],
      ),
    ).rejects.toThrow(/mensagens_saida_simulado_sem_fornecedor/);
  });

  it('chamadas de saída: uma chamada simulada nunca é pedida ao ElevenLabs', async () => {
    const tel = gerados[1];
    const mun = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, telefone_e164, nome) VALUES ($1, $2, 'Simulado')
       RETURNING id`,
      [MUNICIPIO_ID, tel],
    );
    const ch = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO chamadas_saida (municipio_id, municipe_id, telefone_e164, motivo, forcar_horario,
         simulado, recurso)
       VALUES ($1, $2, $3, 'campanha', true, true, $4) RETURNING id`,
      [
        MUNICIPIO_ID,
        mun!.id,
        tel,
        JSON.stringify({
          corpo: 'recurso',
          chave: `rec-${letras}`,
          motivo: 'aviso',
          relacionado: {},
        }),
      ],
    );
    const feita = await ctx.app.get(ChamadasSaidaService).despachar(ch!.id);
    expect(feita).toBe(false);
    expect(chamadasElevenLabs.filter((b) => b.includes(tel))).toEqual([]);
    expect(
      await linha(
        ctx.db,
        `SELECT estado, erro FROM chamadas_saida WHERE id = $1`,
        [ch!.id],
      ),
    ).toEqual({ estado: 'cancelada', erro: ERRO_SIMULADA });
    // Nem o SMS de recurso.
    expect(
      await linhas(
        ctx.db,
        `SELECT 1 FROM mensagens_saida WHERE chave_idempotencia = $1`,
        [`rec-${letras}`],
      ),
    ).toHaveLength(0);
    expect(pedidosTwilio).not.toContain(tel);
  });

  it('cell broadcast simulado: área + texto + estado da difusão, sem números', async () => {
    const sim = await criar({
      ...NOVA(),
      fontes: [],
      cell_broadcast: true,
      simular: true,
    }).expect(201);
    expect(sim.body.destinatarios.total).toBe(0);
    expect(sim.body.cell_broadcast).toMatchObject({
      modo: 'simulada',
      simulada: true,
      estado: 'ok',
      demonstracao: true,
      custo: null,
      custo_nota: expect.stringContaining('a confirmar'),
    });
    expect(sim.body.cell_broadcast.pessoas_estimadas).toBeGreaterThan(0);

    const c = await criar({
      ...NOVA(),
      fontes: [],
      cell_broadcast: true,
    }).expect(201);
    expect(c.body.cell_broadcast).toBe(true);
    const r = await enviar(c.body.id, 0).expect(200);
    expect(r.body).toMatchObject({
      estado: 'ativa',
      destinatarios_total: 0,
      cell_broadcast_difusao: {
        modo: 'simulada',
        simulado: true,
        estado: 'pedida',
        referencia_externa: expect.stringMatching(/^CB-DEMO-[0-9A-F]{8}$/),
        texto: expect.stringMatching(/^EMERGENCIA - CM /),
        demonstracao: true,
      },
    });
    // Passado um minuto já está em difusão.
    await ctx.db.query(
      `UPDATE emergencia_difusoes SET pedida_em = now() - interval '1 minute' WHERE emergencia_id = $1`,
      [c.body.id],
    );
    expect((await detalhe(c.body.id)).body.cell_broadcast_difusao.estado).toBe(
      'em_difusao',
    );
    expect(
      await linha(
        ctx.db,
        `SELECT dados FROM audit_log WHERE acao = 'pedir_cell_broadcast' AND objeto_id = $1`,
        [c.body.id],
      ),
    ).toMatchObject({ dados: { simulado: true, estado: 'pedida' } });
    await ctx
      .http()
      .post(`/v1/painel/emergencias/${c.body.id}/encerrar`)
      .set(chefe)
      .send({})
      .expect(200);
    expect((await detalhe(c.body.id)).body.cell_broadcast_difusao.estado).toBe(
      'cancelada',
    );
    expect(outrosPedidos).toEqual([]);
  });

  it('cell broadcast real sem configuração: o plano diz "por configurar" e o envio recusa', async () => {
    process.env.EMERGENCIAS_CELL_BROADCAST = 'cell_broadcast';
    try {
      const sim = await criar({
        ...NOVA(),
        fontes: ['municipes'],
        cell_broadcast: true,
        simular: true,
      }).expect(201);
      expect(sim.body.cell_broadcast).toMatchObject({
        modo: 'cell_broadcast',
        simulada: false,
        configurada: false,
        estado: 'nao_configurada',
        nota_estimativa:
          'Cell broadcast por configurar — falta acordo com a ANEPC / operadores.',
      });
      const c = await criar({
        ...NOVA(),
        fontes: ['municipes'],
        cell_broadcast: true,
      }).expect(201);
      const r = await enviar(c.body.id, 2).expect(503);
      expect(r.body.erro).toMatchObject({
        codigo: 'cell_broadcast_por_configurar',
        mensagem: expect.stringContaining(
          'falta acordo com a ANEPC / operadores',
        ),
        detalhes: {
          em_falta: ['CELL_BROADCAST_URL', 'CELL_BROADCAST_CREDENCIAL'],
        },
      });
      // Nada saiu.
      expect((await detalhe(c.body.id)).body.estado).toBe('rascunho');
    } finally {
      process.env.EMERGENCIAS_CELL_BROADCAST = 'simulada';
    }
  });

  it('sem fontes nem cell broadcast: pedido inválido', async () => {
    const r = await criar({ ...NOVA(), fontes: [], simular: true }).expect(400);
    expect(r.body.erro.codigo).toBe('pedido_invalido');
  });
});
