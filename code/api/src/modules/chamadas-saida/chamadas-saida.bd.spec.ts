/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import type { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import type { UtilizadorPainel } from '../../common/pedido.js';
import type { DatabaseService, Tx } from '../../database/database.service.js';
import type { JobsService } from '../../jobs/jobs.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { LinksCurtosService } from '../comunicacao/links-curtos.service.js';
import { MensagensService } from '../comunicacao/mensagens.service.js';
import { esquemaTranscricao } from '../conversas/elevenlabs.js';
import { RetomarService } from '../conversas/retomar.service.js';
import type { Municipio } from '../municipios/municipios.service.js';
import { MunicipiosService } from '../municipios/municipios.service.js';
import { ProcessosAvisosService } from '../processos/processos-avisos.service.js';
import { ProcessosService } from '../processos/processos.service.js';
import { TiposProcessoService } from '../processos/tipos-processo.service.js';
import { ChamadasSaidaService } from './chamadas-saida.service.js';

/*
 * Integração com o Postgres (todas as migrações aplicadas), numa transação
 * desfeita no fim. Só corre com TESTE_BD=1:
 *
 *   TESTE_BD=1 DB_NAME=toucamara_cs npx jest src/modules/chamadas-saida/chamadas-saida.bd.spec.ts
 *
 * O ElevenLabs é um fetch falso; o SMS grava em `mensagens_saida` (fila falsa).
 */
const correr = process.env.TESTE_BD === '1' ? describe : describe.skip;

const MUN = '00000000-0000-0000-0000-00000000c501';
const TIPO = '00000000-0000-0000-0000-00000000c502';
const U = '00000000-0000-0000-0000-00000000c503';
// Terça, 11h em Lisboa: dentro do período.
const TERCA = new Date('2026-10-20T10:00:00Z');

correr('chamadas de saída (BD)', () => {
  let client: Client;
  let chamadas: ChamadasSaidaService;
  let avisos: ProcessosAvisosService;
  let m: Municipio;
  let apiKey = 'xi_teste';
  let n = 0;
  const q = async (sql: string, p?: unknown[]) =>
    (await client.query(sql, p)).rows;
  const buscar = jest.fn();
  const u = {
    id: U,
    nome: 'Equipa',
    email: 'e@t.pt',
    perfil: 'equipa_toucamara',
    municipioId: null,
    servicoId: null,
  } as UtilizadorPainel;

  const respostaOk = (conv: string, sid: string) =>
    new Response(
      JSON.stringify({
        success: true,
        message: 'ok',
        conversation_id: conv,
        callSid: sid,
      }),
    );

  async function municipe(tel: string, preferido: string | null) {
    const [r] = await q(
      `INSERT INTO municipes (municipio_id, telefone_e164, nome, canal_preferido)
       VALUES ($1, $2, 'Maria Silva', $3) RETURNING id`,
      [MUN, tel, preferido],
    );
    return r.id as string;
  }

  async function processo(municipeId: string, fase = 'apreciacao') {
    const [r] = await q(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, fase)
       VALUES ($1, $2, $3, $4, 'Porta na cozinha', $5) RETURNING id, numero`,
      [MUN, `CS ${++n}/2026`, TIPO, municipeId, fase],
    );
    return r as { id: string; numero: string };
  }

  async function pedido(processoId: string, descricao: string) {
    const [e] = await q(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo)
       VALUES ($1, 'documento_pedido', $2, 'sistema') RETURNING id`,
      [processoId, descricao],
    );
    const [p] = await q(
      `INSERT INTO processo_pedidos (processo_id, evento_id, descricao, prazo)
       VALUES ($1, $2, $3, '2026-10-30') RETURNING id`,
      [processoId, e.id, descricao],
    );
    return p.id as string;
  }

  const chamadaDe = async (municipeId: string) =>
    (
      await q(
        'SELECT * FROM chamadas_saida WHERE municipe_id = $1 ORDER BY criada_em DESC LIMIT 1',
        [municipeId],
      )
    )[0];

  beforeAll(async () => {
    client = new Client({
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 54330),
      user: 'toucamara',
      password: process.env.DB_PASSWORD ?? 'toucamara',
      database: process.env.DB_NAME ?? 'toucamara',
    });
    await client.connect();
    await client.query('BEGIN');

    let sp = 0;
    const tx = { query: q };
    const db = {
      query: q,
      transaction: async <T>(fn: (t: Tx) => Promise<T>) => {
        const nome = `sp${++sp}`;
        await client.query(`SAVEPOINT ${nome}`);
        try {
          const r = await fn(tx);
          await client.query(`RELEASE SAVEPOINT ${nome}`);
          return r;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT ${nome}`);
          throw e;
        }
      },
    } as unknown as DatabaseService;
    const config = {
      get: (k: string) =>
        k === 'webhooks'
          ? { elevenlabsApiKey: apiKey }
          : k === 'app.webUrl'
            ? 'https://t.pt'
            : undefined,
      getOrThrow: () => ({ smsTransliterar: false }),
    } as unknown as ConfigService;
    const jobs = { enviar: jest.fn() } as unknown as JobsService;

    const municipios = new MunicipiosService(db);
    const auditoria = new AuditoriaService(db);
    const mensagens = new MensagensService(db, jobs, config);
    const links = new LinksCurtosService(db, config);
    const tipos = new TiposProcessoService(db);
    const processos = new ProcessosService(
      db,
      config,
      tipos,
      municipios,
      links,
      mensagens,
      auditoria,
    );
    chamadas = new ChamadasSaidaService(
      db,
      config,
      municipios,
      mensagens,
      links,
      new RetomarService(db),
      auditoria,
    );
    chamadas.buscar = buscar;
    avisos = new ProcessosAvisosService(
      db,
      processos,
      municipios,
      mensagens,
      chamadas,
    );

    await q(
      `INSERT INTO municipios (id, slug, nome, telefone_linha, email_geral)
       VALUES ($1, 'cs-teste', 'Teste', '+351253000999', 'g@t.pt')`,
      [MUN],
    );
    await q(
      `INSERT INTO agente_config (municipio_id, saudacao, versao, elevenlabs_agent_id, chamadas_saida)
       VALUES ($1, 'Olá', 'v1', 'agent_cs', $2)`,
      [
        MUN,
        JSON.stringify({
          ativo: true,
          motivos: ['processo_fase', 'pedido_documento', 'lembrete_prazo'],
          numero_id: 'phn_1',
          via: 'twilio',
        }),
      ],
    );
    await q(
      `INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, formulario)
       VALUES ($1, $2, 'CS', 'Comunicação prévia', 20, '[]')`,
      [TIPO, MUN],
    );
    await q(
      `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil)
       VALUES ($1, NULL, 'equipa-cs@t.pt', 'Equipa', 'equipa_toucamara')`,
      [U],
    );
    m = await municipios.porId(MUN);
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    await client.end();
  });

  it('mudança de fase de quem prefere telefone: chamada em vez de SMS; 2 sem resposta → SMS de recurso', async () => {
    const a = await municipe('+351912000001', 'telefone');
    const p = await processo(a);
    expect(await avisos.avisarFase(m, p.id, 'apreciacao')).toBe('chamada');

    let c = await chamadaDe(a);
    expect(c).toMatchObject({
      estado: 'agendada',
      motivo: 'processo_fase',
      processo_id: p.id,
      tentativas: 0,
    });
    expect(c.contexto.numero_processo).toBe(p.numero);
    expect(c.contexto.o_que_mudou).toContain('analisado');
    expect(c.contexto.link).toMatch(/^https:\/\/t\.pt\/r\//);
    expect(c.recurso.chave).toBe(`processo_fase:${p.id}:apreciacao`);
    const [ev] = await q(
      `SELECT descricao, dados FROM processo_eventos WHERE processo_id = $1 AND tipo = 'avisado'`,
      [p.id],
    );
    expect(ev.dados.canal).toBe('chamada');
    expect(
      await q('SELECT 1 FROM mensagens_saida WHERE municipe_id = $1', [a]),
    ).toHaveLength(0);

    // 1.ª tentativa: pedida ao ElevenLabs com as variáveis todas.
    buscar.mockResolvedValueOnce(respostaOk('conv_cs_1', 'CA1'));
    expect(await chamadas.despachar(c.id, TERCA)).toBe(true);
    const corpo = JSON.parse(buscar.mock.calls[0][1].body);
    expect(corpo).toMatchObject({
      agent_id: 'agent_cs',
      agent_phone_number_id: 'phn_1',
      to_number: '+351912000001',
    });
    expect(
      corpo.conversation_initiation_client_data.dynamic_variables,
    ).toMatchObject({
      tipo_chamada: 'saida',
      chamada_saida_id: c.id,
      numero_processo: p.numero,
      nome_municipe: 'Maria',
      ja_ligou: 'nao',
    });
    c = await chamadaDe(a);
    expect(c).toMatchObject({
      estado: 'a_ligar',
      tentativas: 1,
      provider_ref: 'CA1',
      provider_conversa_ref: 'conv_cs_1',
    });

    // Não atendeu: volta a agendar.
    await expect(
      chamadas.aoFalharInicio({
        conversation_id: 'conv_cs_1',
        failure_reason: 'no-answer',
      }),
    ).resolves.toEqual({ chamada_saida_id: c.id, estado: 'agendada' });
    // O webhook repetido não muda nada.
    await expect(
      chamadas.aoFalharInicio({
        conversation_id: 'conv_cs_1',
        failure_reason: 'no-answer',
      }),
    ).resolves.toEqual({ chamada_saida_id: c.id, estado: 'agendada' });

    // 2.ª tentativa, ocupado (pelo CallSid): desiste, vai o SMS.
    buscar.mockResolvedValueOnce(respostaOk('conv_cs_2', 'CA2'));
    await chamadas.despachar(c.id, TERCA);
    await expect(
      chamadas.aoFalharInicio({
        conversation_id: null,
        failure_reason: 'busy',
        metadata: { type: 'twilio', body: { CallSid: 'CA2' } },
      }),
    ).resolves.toEqual({ chamada_saida_id: c.id, estado: 'nao_atendida' });
    c = await chamadaDe(a);
    expect(c.tentativas).toBe(2);
    expect(c.erro).toContain('ocupado');
    const [sms] = await q(
      'SELECT id, corpo, chave_idempotencia FROM mensagens_saida WHERE municipe_id = $1',
      [a],
    );
    expect(sms.id).toBe(c.recurso_sms_id);
    expect(sms.chave_idempotencia).toBe(`processo_fase:${p.id}:apreciacao`);
    expect(sms.corpo).toContain('em análise');
  });

  it('pedido de documento sem preferência: liga; atendida liga a conversa e a ferramenta dá o contexto', async () => {
    const b = await municipe('+351912000002', null);
    const p = await processo(b, 'documentos');
    const pedidoId = await pedido(p.id, 'Planta de localização');
    // Como o pedido do painel (avisarPedido): sem `chamada`, pelo pedido_id.
    const canal = await avisos.enviar(
      { query: q },
      {
        municipioId: MUN,
        municipeId: b,
        aviso: { assunto: 'x', texto: 'Teste: envie a planta.' },
        motivo: 'processo',
        chave: `processo_pedido:${pedidoId}`,
        relacionado: { processo_id: p.id, pedido_id: pedidoId },
      },
    );
    expect(canal).toBe('chamada');
    let c = await chamadaDe(b);
    expect(c.motivo).toBe('pedido_documento');
    expect(c.contexto.o_que_mudou).toBe(
      'A câmara pediu-lhe: Planta de localização, até dia 30 de outubro.',
    );
    expect(c.contexto.o_que_falta).toContain('Planta de localização');

    buscar.mockResolvedValueOnce(respostaOk('conv_cs_3', 'CA3'));
    await chamadas.despachar(c.id, TERCA);
    const [cv] = await q(
      `INSERT INTO conversas (municipio_id, canal, provider_id) VALUES ($1, 'telefone', 'conv_cs_3') RETURNING id`,
      [MUN],
    );

    // A ferramenta numa chamada de saída.
    const ctx = {
      municipio: m,
      canal: 'telefone' as const,
      conversaId: cv.id,
      municipeId: null,
      telefone: null,
    };
    await expect(chamadas.motivoDaChamada(ctx)).resolves.toMatchObject({
      chamada_de_saida: true,
      motivo: 'falta um documento',
      numero_processo: p.numero,
    });

    const data = esquemaTranscricao.parse({
      type: 'post_call_transcription',
      data: {
        agent_id: 'agent_cs',
        conversation_id: 'conv_cs_3',
        transcript: [
          { role: 'agent', message: 'Bom dia, fala o Tou, Câmara?' },
          { role: 'user', message: 'Bom dia.' },
        ],
        conversation_initiation_client_data: {
          dynamic_variables: { chamada_saida_id: c.id },
        },
      },
    }).data;
    await expect(chamadas.aoTerminarConversa(data, cv.id)).resolves.toEqual({
      chamada_saida_id: c.id,
      estado: 'atendida',
    });
    // Repetido: igual.
    await expect(chamadas.aoTerminarConversa(data, cv.id)).resolves.toEqual({
      chamada_saida_id: c.id,
      estado: 'atendida',
    });
    c = await chamadaDe(b);
    expect(c).toMatchObject({ estado: 'atendida', conversa_id: cv.id });
    expect(c.recurso_sms_id).toBeNull();
    const [conv] = await q('SELECT municipe_id FROM conversas WHERE id = $1', [
      cv.id,
    ]);
    expect(conv.municipe_id).toBe(b);
    const ev = await q(
      `SELECT interno FROM processo_eventos WHERE processo_id = $1 AND tipo = 'chamada_saida'`,
      [p.id],
    );
    expect(ev).toEqual([{ interno: false }]);
  });

  it('quem prefere SMS não é ligado; dois avisos seguidos: o 2.º vai por SMS', async () => {
    const s = await municipe('+351912000003', 'sms');
    const p1 = await processo(s);
    expect(await avisos.avisarFase(m, p1.id, 'apreciacao')).toBe('sms');

    const d = await municipe('+351912000004', 'telefone');
    const p2 = await processo(d);
    const p3 = await processo(d);
    expect(await avisos.avisarFase(m, p2.id, 'apreciacao')).toBe('chamada');
    expect(await avisos.avisarFase(m, p3.id, 'apreciacao')).toBe('sms');
  });

  it('sem ElevenLabs: falhou e vai o SMS (nunca se finge a chamada)', async () => {
    const e = await municipe('+351912000005', 'telefone');
    const p = await processo(e);
    await avisos.avisarFase(m, p.id, 'apreciacao');
    const c = await chamadaDe(e);
    apiKey = '';
    try {
      expect(await chamadas.despachar(c.id, TERCA)).toBe(false);
    } finally {
      apiKey = 'xi_teste';
    }
    const depois = await chamadaDe(e);
    expect(depois.estado).toBe('falhou');
    expect(depois.erro).toContain('sem ElevenLabs');
    expect(depois.recurso_sms_id).not.toBeNull();
  });

  it('fora de horas reagenda em vez de ligar', async () => {
    const f = await municipe('+351912000006', 'telefone');
    const p = await processo(f);
    await avisos.avisarFase(m, p.id, 'apreciacao');
    const c = await chamadaDe(f);
    const sabado = new Date('2026-10-24T11:00:00Z');
    expect(await chamadas.despachar(c.id, sabado)).toBe(false);
    const depois = await chamadaDe(f);
    expect(depois.estado).toBe('agendada');
    expect(depois.agendada_para).toEqual(new Date('2026-10-26T10:00:00Z'));
  });

  it('nao_quero_chamadas: grava a recusa e cancela as agendadas (o aviso vai por SMS)', async () => {
    const g = await municipe('+351912000007', 'telefone');
    const p = await processo(g);
    await avisos.avisarFase(m, p.id, 'apreciacao');
    const r = await chamadas.naoQueroChamadas({
      municipio: m,
      canal: 'telefone',
      conversaId: null,
      municipeId: g,
      telefone: '+351912000007',
    });
    expect(r.gravado).toBe(true);
    const c = await chamadaDe(g);
    expect(c.estado).toBe('cancelada');
    expect(c.recurso_sms_id).not.toBeNull();
    const [mu] = await q(
      'SELECT aceita_chamadas FROM municipes WHERE id = $1',
      [g],
    );
    expect(mu.aceita_chamadas).toBe(false);
    // E não volta a ser ligado.
    const p2 = await processo(g);
    expect(await avisos.avisarFase(m, p2.id, 'apreciacao')).toBe('sms');
  });

  it('painel: ligar agora (forçado pela equipa interna), cancelar, listar e config', async () => {
    const h = await municipe('+351912000008', 'sms');
    const p = await processo(h);
    buscar.mockResolvedValueOnce(respostaOk('conv_cs_9', 'CA9'));
    const c = await chamadas.ligarManual(m, u, p.id, {
      nota: 'Quero explicar o parecer.',
      forcar_horario: true,
    });
    expect(c).toMatchObject({
      motivo: 'manual',
      estado: 'a_ligar',
      provider_ref: 'CA9',
    });
    expect(c.contexto.nota).toBe('Quero explicar o parecer.');

    // Já há uma por fazer.
    await expect(
      chamadas.ligarManual(m, u, p.id, { forcar_horario: true }),
    ).rejects.toMatchObject({ codigo: 'chamada_nao_permitida' });
    // Forçar só a equipa interna.
    await expect(
      chamadas.ligarManual(m, { ...u, perfil: 'tecnico' }, p.id, {
        forcar_horario: true,
      }),
    ).rejects.toMatchObject({ codigo: 'sem_permissao' });

    // Cancelar uma agendada.
    const k = await municipe('+351912000009', 'telefone');
    const pk = await processo(k);
    await avisos.avisarFase(m, pk.id, 'apreciacao');
    const ck = await chamadaDe(k);
    const cancelada = await chamadas.cancelar(m, u, ck.id, {
      enviar_sms: true,
    });
    expect(cancelada).toMatchObject({ estado: 'cancelada' });
    expect(cancelada.recurso_sms_id).not.toBeNull();
    await expect(
      chamadas.cancelar(m, u, ck.id, { enviar_sms: true }),
    ).rejects.toMatchObject({ codigo: 'estado_invalido' });

    const lista = await chamadas.listar(m, {
      limite: 50,
      cursor: null,
      estado: 'cancelada',
    });
    expect(lista.itens.map((i: any) => i.id)).toContain(ck.id);
    expect(lista.itens.every((i: any) => i.estado === 'cancelada')).toBe(true);

    const config = await chamadas.guardarConfig(m, u, {
      ativo: true,
      motivos: ['pedido_documento', 'pedido_documento'],
      numero_id: 'phn_2',
      via: 'sip_trunk',
    });
    expect(config).toMatchObject({
      ativo: true,
      motivos: ['pedido_documento'],
      numero_id: 'phn_2',
      via: 'sip_trunk',
      agente_configurado: true,
      elevenlabs_disponivel: true,
    });
    await expect(
      chamadas.guardarConfig(m, u, {
        ativo: true,
        motivos: [],
        numero_id: null,
        via: 'twilio',
      }),
    ).rejects.toMatchObject({ codigo: 'sem_numero_saida' });
  });
});
