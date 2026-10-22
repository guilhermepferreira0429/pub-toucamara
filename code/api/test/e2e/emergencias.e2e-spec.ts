/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
  novoTelefone,
  smsPara,
} from './app';

/**
 * Avisos de emergência em massa: simulação com as três fontes (munícipes
 * com morada na zona, contactos de cuidado, lista CSV) e a fonte dos
 * operadores real "por configurar" (a simulada está em
 * emergencias-operadores.e2e-spec.ts); envio com SMS a todos (mesmo a quem recusou avisos, a
 * qualquer hora, ao ritmo configurado) e chamadas do agente sem janela de
 * horário; "precisa de ajuda" pela ferramenta nova e pela da campanha, com
 * alerta por email; encerrar; permissões.
 */
describe('Avisos de emergência (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  const letras = Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + randomInt(26)),
  ).join('');
  const freguesia = `Freguesia Emergência ${letras}`;

  // Longe das coordenadas dos outros ficheiros.
  const base = {
    lat: 39.0 + Math.random() * 0.2,
    lng: -6.9 + Math.random() * 0.2,
  };
  const d = 0.002;
  const poligono = {
    tipo: 'poligono',
    pontos: [
      { lat: base.lat - d, lng: base.lng - d },
      { lat: base.lat - d, lng: base.lng + d },
      { lat: base.lat + d, lng: base.lng + d },
      { lat: base.lat + d, lng: base.lng - d },
    ],
    descricao: 'Margens do rio (teste)',
  };

  /** Munícipe com ocorrência dentro da zona; recusou avisos (recebe na mesma). */
  const A = { id: randomUUID(), tel: novoTelefone() };
  /** Munícipe com ocorrência fora da zona. */
  const B = { id: randomUUID(), tel: novoTelefone() };
  /** Contacto de cuidado com morada dentro da zona (telemóvel). */
  const C = { tel: novoTelefone(), morada: `Rua do Rio ${letras} 1` };
  /** Contacto de cuidado com morada dentro, só telefone fixo (é ligado, sem SMS). */
  const F = {
    tel: `+351253${randomInt(100_000, 999_999)}`,
    morada: `Rua do Rio ${letras} 2`,
  };
  /** Contacto de cuidado fora da zona. */
  const G = { tel: novoTelefone(), morada: `Rua Longe ${letras} 3` };
  /** Lista CSV: um número novo e o de A (repetido entre fontes). */
  const L = novoTelefone();

  const csv = () =>
    ['telefone;nome', `${L.replace('+351', '')};Lúcia Lista`, A.tel, 'xx'].join(
      '\n',
    );

  const NOVA = () => ({
    tipo: 'cheia',
    gravidade: 'alerta',
    titulo: `Cheia no rio ${letras}`,
    mensagem_sms: 'Risco de cheia esta noite junto ao rio',
    zona: poligono,
    lista_csv: csv(),
  });

  const criar = (corpo: object, h = chefe) =>
    ctx.http().post('/v1/painel/emergencias').set(h).send(corpo);

  beforeAll(async () => {
    process.env.EMERGENCIAS_OPERADORES = 'simulada';
    process.env.EMERGENCIAS_CELL_BROADCAST = 'simulada';
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    ctx.geo.moradas.set(C.morada, { lat: base.lat, lng: base.lng });
    ctx.geo.moradas.set(F.morada, {
      lat: base.lat + 0.001,
      lng: base.lng,
    });
    ctx.geo.moradas.set(G.morada, { lat: base.lat + 0.5, lng: base.lng });

    for (const [i, m] of [A, B].entries()) {
      await ctx.db.query(
        `INSERT INTO municipes (id, municipio_id, telefone_e164, nome, aceita_avisos)
         VALUES ($1, $2, $3, $4, $5)`,
        [m.id, MUNICIPIO_ID, m.tel, `Pessoa ${i} Emergência`, m !== A],
      );
    }
    const cat = await linha<{ id: string }>(
      ctx.db,
      `SELECT id FROM categorias_ocorrencia WHERE municipio_id = $1 LIMIT 1`,
      [MUNICIPIO_ID],
    );
    for (const [m, p] of [
      [A, base],
      [B, { lat: base.lat + 0.3, lng: base.lng }],
    ] as const) {
      await ctx.db.query(
        `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng, municipe_id)
         VALUES ($1, $2, $3, 'Teste de emergência', 'Rua X', $4, $5, $6)`,
        [
          MUNICIPIO_ID,
          `EMG-${letras}-${randomInt(1e9)}`,
          cat!.id,
          p.lat,
          p.lng,
          m.id,
        ],
      );
    }
    for (const [nome, x] of [
      ['Celeste Cuidado', C],
      ['Fernando Fixo', F],
      ['Graça Longe', G],
    ] as const) {
      await ctx
        .http()
        .post('/v1/painel/campanhas/contactos')
        .set(chefe)
        .send({ nome, telefone: x.tel, morada: x.morada, freguesia })
        .expect(201);
    }
    await ctx
      .http()
      .put('/v1/painel/emergencias/config')
      .set(chefe)
      .send({
        protecao_civil_nome: 'SMPC Teste',
        protecao_civil_email: `smpc-${letras}@teste.pt`,
        sms_por_minuto: 2,
        chamadas_por_minuto: 1,
      })
      .expect(200);
  });
  afterAll(async () => {
    await ctx.db.query(
      'DELETE FROM emergencias_config WHERE municipio_id = $1',
      [MUNICIPIO_ID],
    );
    await ctx.fechar();
  });

  it('permissões: técnico não vê; atendimento simula mas não envia', async () => {
    const tecnico = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'tecnico'),
    );
    const r = await ctx
      .http()
      .get('/v1/painel/emergencias')
      .set(tecnico)
      .expect(403);
    expect(r.body.erro.detalhes).toEqual({ recurso: 'acao_social' });

    const atend = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    const c = await criar(NOVA(), atend).expect(201);
    const e = await ctx
      .http()
      .post(`/v1/painel/emergencias/${c.body.id}/enviar`)
      .set(atend)
      .send({ confirmo_destinatarios: 1, confirmo_texto: 'ENVIAR' })
      .expect(403);
    expect(e.body.erro.detalhes).toEqual({ recurso: 'agente' });
    await ctx
      .http()
      .post(`/v1/painel/emergencias/${c.body.id}/simular`)
      .set(atend)
      .expect(200);
    await ctx
      .http()
      .put('/v1/painel/emergencias/config')
      .set(atend)
      .send({ sms_por_minuto: 1, chamadas_por_minuto: 1 })
      .expect(403);
  });

  it('simular: as três fontes (os operadores só quando pedidos), plano e custo de demonstração, nada gravado', async () => {
    const antes = await linha<{ n: number }>(
      ctx.db,
      'SELECT count(*)::int AS n FROM emergencias',
    );
    const r = await criar({ ...NOVA(), simular: true }).expect(201);
    const p = r.body;
    expect(p).toMatchObject({
      simulacao: true,
      nada_enviado: true,
      zona: 'Margens do rio (teste)',
      aviso_cobertura: expect.stringContaining('não é toda a gente da zona'),
    });
    const porFonte = Object.fromEntries(
      p.fontes.map((f: { fonte: string }) => [f.fonte, f]),
    );
    expect(porFonte.municipes).toMatchObject({ estado: 'ok', encontrados: 1 });
    expect(porFonte.cuidado).toMatchObject({ estado: 'ok', encontrados: 2 });
    expect(porFonte.lista).toMatchObject({ estado: 'ok', encontrados: 2 });
    expect(porFonte.operadores).toBeUndefined();
    expect(p.operadores).toBeNull();
    expect(p.cell_broadcast).toBeNull();
    expect(p.aviso_simulado).toBeNull();
    // A, C, F, L (A está nos munícipes e na lista).
    expect(p.destinatarios).toMatchObject({
      total: 4,
      por_fonte: { municipes: 1, cuidado: 2, lista: 2, operadores: 0 },
      simulados: 0,
      em_varias_fontes: 1,
      vulneraveis: 2,
      so_telefone_fixo: 1,
    });
    expect(p.lista_csv).toMatchObject({ invalidas: [{ linha: 4 }] });
    expect(p.sms).toMatchObject({
      total: 3,
      ignora_recusas: true,
      ignora_horario: true,
      texto: expect.stringMatching(/^ALERTA - CM .*Emergencia: 112$/),
    });
    // Alerta: liga só aos vulneráveis (contactos de cuidado).
    expect(p.chamadas).toMatchObject({
      total: 2,
      politica: 'vulneraveis',
      vulneraveis: 2,
      guiao: {
        perguntas: expect.arrayContaining([
          'Precisa de ajuda para sair de casa?',
        ]),
      },
    });
    expect(p.ritmo).toEqual({
      sms_por_minuto: 2,
      chamadas_por_minuto: 1,
      demonstracao: false,
    });
    expect(p.tempo).toMatchObject({ minutos_sms: 2 });
    expect(p.custo).toMatchObject({ demonstracao: true, moeda: 'EUR' });
    expect(p.amostra[0].telefone).toContain('•');
    const depois = await linha<{ n: number }>(
      ctx.db,
      'SELECT count(*)::int AS n FROM emergencias',
    );
    expect(depois!.n).toBe(antes!.n);
    expect(await smsPara(ctx, L)).toHaveLength(0);
  });

  it('só a fonte dos operadores, real e sem configuração: por configurar, ninguém', async () => {
    process.env.EMERGENCIAS_OPERADORES = 'operadores';
    try {
      const r = await criar({
        ...NOVA(),
        fontes: ['externa'], // o nome antigo ainda é aceite
        lista_csv: undefined,
        simular: true,
      }).expect(201);
      expect(r.body.destinatarios.total).toBe(0);
      expect(r.body.fontes).toEqual([
        expect.objectContaining({
          fonte: 'operadores',
          estado: 'nao_configurada',
          nota: 'Fonte dos operadores por configurar — falta acordo com a ANEPC / operadores.',
        }),
      ]);
      expect(r.body.fonte_externa.operadores).toMatchObject({
        modo: 'operadores',
        simulada: false,
        configurada: false,
        em_falta: ['OPERADORES_URL', 'OPERADORES_CREDENCIAL'],
      });
    } finally {
      process.env.EMERGENCIAS_OPERADORES = 'simulada';
    }
  });

  it('zona por freguesias: contactos de cuidado da freguesia', async () => {
    const r = await criar({
      ...NOVA(),
      zona: { tipo: 'freguesias', freguesias: [freguesia] },
      fontes: ['cuidado'],
      lista_csv: undefined,
      simular: true,
    }).expect(201);
    // C, F e G têm a freguesia (G está fora do polígono, mas na freguesia).
    expect(r.body.destinatarios.por_fonte.cuidado).toBe(3);
  });

  let emergenciaId: string;

  it('enviar: dupla confirmação; SMS a todos ao ritmo, chamadas aos vulneráveis sem janela de horário', async () => {
    const c = await criar(NOVA()).expect(201);
    emergenciaId = c.body.id;
    expect(c.body).toMatchObject({
      estado: 'rascunho',
      destinatarios_previstos: 4,
      cell_broadcast: false,
      fonte_externa: { operadores: { simulada: true } },
      simulacao: { destinatarios: { total: 4 } },
    });
    const enviar = (corpo: object) =>
      ctx
        .http()
        .post(`/v1/painel/emergencias/${emergenciaId}/enviar`)
        .set(chefe)
        .send(corpo);
    await enviar({ confirmo_destinatarios: 4 }).expect(400);
    const errado = await enviar({
      confirmo_destinatarios: 3,
      confirmo_texto: 'ENVIAR',
    }).expect(409);
    expect(errado.body.erro.detalhes).toMatchObject({ destinatarios: 4 });
    const sim = await enviar({ simular: true }).expect(200);
    expect(sim.body.nada_enviado).toBe(true);

    const r = await enviar({
      confirmo_destinatarios: 4,
      confirmo_texto: 'ENVIAR',
    }).expect(200);
    expect(r.body).toMatchObject({
      estado: 'ativa',
      campanha_id: expect.any(String),
      destinatarios_total: 4,
      por_fonte: { municipes: 1, cuidado: 2, lista: 2, operadores: 0 },
      simulados: { total: 0 },
      cell_broadcast_difusao: null,
    });

    // SMS: A recusou avisos e recebe; o fixo não recebe SMS.
    const smsA = (await smsPara(ctx, A.tel, 'aviso')).filter(
      (s) => s.relacionado.emergencia_id === emergenciaId,
    );
    expect(smsA).toHaveLength(1);
    expect(smsA[0].corpo).toMatch(/^ALERTA - CM /);
    expect(await smsPara(ctx, F.tel)).toHaveLength(0);
    // Ritmo de 2 por minuto: o 3.º SMS fica para o minuto seguinte.
    const sms = await linhas<{ estado: string; atraso: number }>(
      ctx.db,
      `SELECT ms.estado::text AS estado,
              extract(epoch FROM (d.sms_em - e.enviada_em))::int AS atraso
       FROM emergencia_destinatarios d
       JOIN emergencias e ON e.id = d.emergencia_id
       JOIN mensagens_saida ms ON ms.id = d.sms_id
       WHERE d.emergencia_id = $1 ORDER BY d.sms_em`,
      [emergenciaId],
    );
    expect(sms).toHaveLength(3);
    expect(sms[2].estado).toBe('agendada');
    expect(sms[2].atraso).toBeGreaterThanOrEqual(55);

    // Chamadas: só os 2 contactos de cuidado, sem janela de horário, 1 por minuto.
    const chamadas = await linhas<{
      telefone_e164: string;
      motivo: string;
      forcar_horario: boolean;
      estado: string;
      agendada_para: Date;
    }>(
      ctx.db,
      `SELECT cs.telefone_e164, cs.motivo, cs.forcar_horario, cs.estado, cs.agendada_para
       FROM emergencia_destinatarios d
       JOIN campanha_destinatarios cd ON cd.id = d.campanha_destinatario_id
       JOIN chamadas_saida cs ON cs.id = cd.chamada_saida_id
       WHERE d.emergencia_id = $1 ORDER BY cs.agendada_para`,
      [emergenciaId],
    );
    expect(chamadas.map((x) => x.telefone_e164).sort()).toEqual(
      [C.tel, F.tel].sort(),
    );
    for (const x of chamadas) {
      expect(x).toMatchObject({
        motivo: 'campanha',
        forcar_horario: true,
        estado: 'agendada',
      });
    }
    expect(
      chamadas[1].agendada_para.getTime() - chamadas[0].agendada_para.getTime(),
    ).toBe(60_000);

    const acesso = await linha(
      ctx.db,
      `SELECT dados FROM audit_log WHERE acao = 'enviar_emergencia' AND objeto_id = $1`,
      [emergenciaId],
    );
    expect(acesso.dados).toMatchObject({ destinatarios: 4, chamadas: 2 });
    // Não se envia duas vezes.
    await enviar({
      confirmo_destinatarios: 4,
      confirmo_texto: 'ENVIAR',
    }).expect(409);
  });

  /** Simula o ElevenLabs a ligar a `tel`: a chamada fica 'a_ligar' com a conversa. */
  const atender = async (tel: string) => {
    const x = await linha<{ id: string }>(
      ctx.db,
      `SELECT cs.id FROM emergencia_destinatarios d
       JOIN campanha_destinatarios cd ON cd.id = d.campanha_destinatario_id
       JOIN chamadas_saida cs ON cs.id = cd.chamada_saida_id
       WHERE d.emergencia_id = $1 AND d.telefone_e164 = $2`,
      [emergenciaId, tel],
    );
    const chamada = { ...novaChamada('emg'), telefone: tel };
    await ctx.db.query(
      `UPDATE chamadas_saida SET estado = 'a_ligar', tentativas = 1, iniciada_em = now(),
         provider_conversa_ref = $2 WHERE id = $1`,
      [x!.id, chamada.conversa],
    );
    const motivo = await ferramenta(ctx, chamada, 'motivo_da_chamada').expect(
      200,
    );
    expect(motivo.body).toMatchObject({
      chamada_de_saida: true,
      perguntas: expect.arrayContaining(['Está em segurança neste momento?']),
    });
    return chamada;
  };

  it('"precisa de ajuda" pela resposta_emergencia: destaque no painel e alerta por email', async () => {
    const chamada = await atender(C.tel);
    const r = await ferramenta(ctx, chamada, 'resposta_emergencia', {
      estado: 'precisa_ajuda',
      ajuda: ['sair_de_casa'],
      nota: 'Água a entrar em casa, não consegue descer.',
    }).expect(200);
    expect(r.body).toMatchObject({ gravado: true });
    expect(r.body.dizer).toContain('112');

    const det = await ctx
      .http()
      .get(`/v1/painel/emergencias/${emergenciaId}`)
      .set(chefe)
      .expect(200);
    expect(det.body.contagens.precisa_ajuda).toBe(1);
    expect(det.body.precisa_ajuda[0]).toMatchObject({
      nome: 'Celeste Cuidado',
      telefone: C.tel,
      ajuda: ['sair_de_casa'],
      nota: 'Água a entrar em casa, não consegue descer.',
      alertado_em: expect.any(String),
      tratado_em: null,
    });
    const emails = await linhas<{ destino: string }>(
      ctx.db,
      `SELECT destino FROM mensagens_saida
       WHERE canal = 'email' AND relacionado->>'emergencia_id' = $1`,
      [emergenciaId],
    );
    expect(emails.map((e) => e.destino)).toContain(`smpc-${letras}@teste.pt`);
    expect(emails.length).toBeGreaterThanOrEqual(2); // + chefias

    // A campanha também ficou a saber.
    const cd = await linha(
      ctx.db,
      `SELECT cd.estado, cd.necessidades FROM emergencia_destinatarios d
       JOIN campanha_destinatarios cd ON cd.id = d.campanha_destinatario_id
       WHERE d.emergencia_id = $1 AND d.telefone_e164 = $2`,
      [emergenciaId, C.tel],
    );
    expect(cd).toMatchObject({
      estado: 'precisa_ajuda',
      necessidades: ['transporte'],
    });

    // Tratar.
    await ctx
      .http()
      .post(
        `/v1/painel/emergencias/${emergenciaId}/destinatarios/${det.body.precisa_ajuda[0].id}/tratar`,
      )
      .set(chefe)
      .send({ nota: 'Bombeiros a caminho.' })
      .expect(200);
    const depois = await ctx
      .http()
      .get(`/v1/painel/emergencias/${emergenciaId}`)
      .set(chefe)
      .expect(200);
    expect(depois.body.precisa_ajuda[0]).toMatchObject({
      tratado_nota: 'Bombeiros a caminho.',
      tratado_em: expect.any(String),
    });
  });

  it('"precisa de ajuda" pela resposta_campanha também chega (no seguimento)', async () => {
    const chamada = await atender(F.tel);
    await ferramenta(ctx, chamada, 'resposta_campanha', {
      estado: 'precisa_ajuda',
      necessidades: ['saude'],
      nota: 'Sem medicação.',
    }).expect(200);
    const det = await ctx
      .http()
      .get(`/v1/painel/emergencias/${emergenciaId}`)
      .set(chefe)
      .expect(200);
    const f = det.body.precisa_ajuda.find(
      (x: { telefone: string }) => x.telefone === F.tel,
    );
    expect(f).toMatchObject({
      nota: 'Sem medicação.',
      alertado_em: expect.any(String),
    });
    expect(det.body.contagens.precisa_ajuda).toBe(2);
  });

  it('quem liga ou escreve por causa do aviso: resposta pelo telefone (chat)', async () => {
    const r = await ferramenta(
      ctx,
      { ...novaChamada('chat'), telefone: L },
      'resposta_emergencia',
      { estado: 'em_seguranca' },
    ).expect(200);
    expect(r.body.gravado).toBe(true);
    const det = await ctx
      .http()
      .get(`/v1/painel/emergencias/${emergenciaId}`)
      .set(chefe)
      .expect(200);
    expect(det.body.contagens.em_seguranca).toBe(1);

    const fora = await ferramenta(ctx, novaChamada(), 'resposta_emergencia', {
      estado: 'precisa_ajuda',
    }).expect(200);
    expect(fora.body).toMatchObject({ gravado: false });
    expect(fora.body.instrucao).toContain('112');
  });

  it('encerrar: cancela os SMS por sair e as chamadas por fazer', async () => {
    const r = await ctx
      .http()
      .post(`/v1/painel/emergencias/${emergenciaId}/encerrar`)
      .set(chefe)
      .send({ nota: 'Caudal normalizado.' })
      .expect(200);
    expect(r.body).toMatchObject({
      estado: 'encerrada',
      encerrada_nota: 'Caudal normalizado.',
    });
    const agendados = await linhas(
      ctx.db,
      `SELECT 1 FROM mensagens_saida
       WHERE relacionado->>'emergencia_id' = $1 AND estado = 'agendada'`,
      [emergenciaId],
    );
    expect(agendados).toHaveLength(0);
    await ctx
      .http()
      .post(`/v1/painel/emergencias/${emergenciaId}/encerrar`)
      .set(chefe)
      .send({})
      .expect(409);
    const lista = await ctx
      .http()
      .get('/v1/painel/emergencias')
      .set(chefe)
      .expect(200);
    expect(
      lista.body.emergencias.find((x: { id: string }) => x.id === emergenciaId),
    ).toMatchObject({ estado: 'encerrada', resumo: { precisa_ajuda: 2 } });
  });

  it('emergência (gravidade máxima): liga a todos, também aos números da lista', async () => {
    const c = await criar({ ...NOVA(), gravidade: 'emergencia' }).expect(201);
    await ctx
      .http()
      .post(`/v1/painel/emergencias/${c.body.id}/enviar`)
      .set(chefe)
      .send({ confirmo_destinatarios: 4, confirmo_texto: 'ENVIAR' })
      .expect(200);
    const chamadas = await linhas<{ telefone_e164: string }>(
      ctx.db,
      `SELECT cs.telefone_e164 FROM emergencia_destinatarios d
       JOIN campanha_destinatarios cd ON cd.id = d.campanha_destinatario_id
       JOIN chamadas_saida cs ON cs.id = cd.chamada_saida_id
       WHERE d.emergencia_id = $1`,
      [c.body.id],
    );
    expect(chamadas.map((x) => x.telefone_e164).sort()).toEqual(
      [A.tel, C.tel, F.tel, L].sort(),
    );
    const smsL = (await smsPara(ctx, L, 'aviso')).filter(
      (s) => s.relacionado.emergencia_id === c.body.id,
    );
    expect(smsL[0].corpo).toMatch(/^EMERGENCIA - CM /);
    await ctx
      .http()
      .post(`/v1/painel/emergencias/${c.body.id}/encerrar`)
      .set(chefe)
      .send({})
      .expect(200);
  });
});
