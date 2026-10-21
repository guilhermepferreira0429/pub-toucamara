/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { ResumoDiarioService } from '../../src/modules/relatorios/resumo-diario.service';
import {
  arrancarApp,
  Contexto,
  entrarPainel,
  linha,
  linhas,
  TIPO_CP_ID,
} from './app';

/**
 * Resumo diário para o presidente: um município só deste ficheiro (os
 * números não apanham dados de outros testes), conversas, emails,
 * ocorrências, processos e pagamentos semeados numa janela de 2019.
 */

const MUN = randomUUID();
const SLUG = `diario-${MUN.slice(0, 8)}`;
const CHEFE = randomUUID();
const DESTINOS = [
  { email: `presidente-${MUN.slice(0, 8)}@teste.pt`, nome: 'Presidente' },
  { email: `vereadora-${MUN.slice(0, 8)}@teste.pt`, nome: 'Vereadora' },
];

/** O pedido: as 24 horas até 12/06/2019 às 07:30 de Lisboa (06:30 UTC). */
const ATE = '2019-06-12T07:30:00+01:00';
const NA_JANELA = (h: number) =>
  new Date(Date.UTC(2019, 5, 11, 7 + h, 0)).toISOString(); // 11/06 08:00 + h (UTC)

/** Frases com dados pessoais que nunca podem sair no resumo. */
const PESSOAIS = [
  '912 345 678',
  'Maria Silva',
  'Rua Direita',
  '123456789',
  'joana@exemplo.pt',
];

describe('Resumo diário (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  const temas = { monos: randomUUID(), recl: randomUUID(), agua: randomUUID() };

  async function conversa(o: {
    canal?: string;
    tema?: string | null;
    resultado?: string;
    em: string;
    foraDeHoras?: boolean;
    resumo?: string;
    turnos?: string[];
  }): Promise<string> {
    const id = randomUUID();
    await ctx.db.query(
      `INSERT INTO conversas (id, municipio_id, canal, iniciada_em, resultado, tema_id, resumo, fora_de_horas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        MUN,
        o.canal ?? 'telefone',
        o.em,
        o.resultado ?? 'resolvida',
        o.tema ?? null,
        o.resumo ?? null,
        o.foraDeHoras ?? false,
      ],
    );
    let ordem = 0;
    for (const texto of o.turnos ?? []) {
      await ctx.db.query(
        `INSERT INTO conversa_turnos (conversa_id, ordem, papel, texto) VALUES ($1, $2, 'agente', 'Olá, em que posso ajudar?'),
                ($1, $3, 'municipe', $4)`,
        [id, ordem, ordem + 1, texto],
      );
      ordem += 2;
    }
    return id;
  }

  beforeAll(async () => {
    ctx = await arrancarApp();
    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome, resumo_diario) VALUES ($1, $2, 'Vila Diária', $3)`,
      [MUN, SLUG, JSON.stringify({ ativo: true, destinatarios: DESTINOS })],
    );
    await ctx.db.query(
      `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil)
       VALUES ($1, $2, $3, 'Chefe Diário', 'chefe_divisao')`,
      [CHEFE, MUN, `chefe-${MUN.slice(0, 8)}@teste.pt`],
    );
    chefe = await entrarPainel(ctx, CHEFE);
    await ctx.db.query(
      `INSERT INTO temas (id, municipio_id, nome) VALUES
         ($1, $4, 'Recolha de monos'), ($2, $4, 'Reclamações'), ($3, $4, 'Água')`,
      [temas.monos, temas.recl, temas.agua, MUN],
    );

    // Conversas na janela: 8 (5 telefone, 2 chat, 1 SMS).
    await conversa({
      tema: temas.monos,
      em: NA_JANELA(0),
      foraDeHoras: true,
      turnos: ['A recolha devia ter passado ontem e não passou ninguém.'],
    });
    await conversa({ tema: temas.monos, em: NA_JANELA(1) });
    await conversa({
      canal: 'chat',
      tema: temas.monos,
      resultado: 'marcacao',
      em: NA_JANELA(2),
    });
    await conversa({ canal: 'sms', tema: temas.monos, em: NA_JANELA(3) });
    const c4 = await conversa({
      tema: temas.monos,
      resultado: 'passada_funcionario',
      em: NA_JANELA(4),
      turnos: [
        'O meu número é 912 345 678, liguem-me depois.',
        'Chamo-me Maria Silva e moro na Rua Direita.',
      ],
    });
    const c6 = await conversa({
      tema: temas.recl,
      resultado: 'passada_funcionario',
      em: NA_JANELA(5),
      turnos: [
        'Já liguei várias vezes e continua tudo igual, ninguém resolve.',
      ],
    });
    await conversa({ resultado: 'emergencia', em: NA_JANELA(6), tema: null });
    await conversa({
      canal: 'chat',
      tema: temas.agua,
      resultado: 'em_curso',
      em: NA_JANELA(7),
      turnos: [
        'O meu NIF é 123456789, confirme por favor.',
        'Respondam para joana@exemplo.pt quando puderem.',
      ],
    });
    // Fora da janela: uma depois das 07:30 e uma nos 7 dias antes (a média).
    await conversa({ tema: temas.agua, em: '2019-06-12T07:00:00Z' });
    await conversa({ tema: temas.monos, em: '2019-06-08T10:00:00Z' });

    // Passagens: uma "outro" com texto de queixa (prazo hoje), uma já atrasada.
    await ctx.db.query(
      `INSERT INTO passagens_humano (conversa_id, motivo, resumo, fora_de_horas, responder_ate, estado, criada_em) VALUES
         ($1, 'outro', 'Queixa-se de que a recolha não passou na data marcada.', false, '2019-06-12T10:00:00Z', 'aberta', $3),
         ($2, 'pedido', 'Quer falar com alguém da câmara.', false, '2019-06-11T12:00:00Z', 'aberta', $3)`,
      [c4, c6, NA_JANELA(5)],
    );

    // Email geral: uma queixa e um pedido; um terceiro fora da janela.
    await ctx.db.query(
      `INSERT INTO emails_entrada (municipio_id, de, assunto, corpo, recebido_em, tema) VALUES
         ($1, 'a@exemplo.pt', 'Barulho', 'x', $2, 'Queixas de ruído'),
         ($1, 'b@exemplo.pt', 'Pedido de ligação', 'x', $2, 'Água'),
         ($1, 'c@exemplo.pt', 'Reclamação antiga', 'x', '2019-06-01T10:00:00Z', null)`,
      [MUN, NA_JANELA(1)],
    );

    // Ocorrências: um buraco já registado, reportado mais 2 vezes na janela; outra resolvida na janela.
    const cat = randomUUID();
    await ctx.db.query(
      `INSERT INTO categorias_ocorrencia (id, municipio_id, nome) VALUES ($1, $2, 'Buraco na via')`,
      [cat, MUN],
    );
    const original = randomUUID();
    await ctx.db.query(
      `INSERT INTO ocorrencias (id, municipio_id, numero, categoria_id, descricao, morada, criada_em) VALUES
         ($1, $2, 'OC-D1', $3, 'Buraco', 'Rua Nova, 5, 4800-000 Vila', '2019-06-01T10:00:00Z')`,
      [original, MUN, cat],
    );
    await ctx.db.query(
      `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, estado, duplicada_de, criada_em) VALUES
         ($1, 'OC-D2', $2, 'Buraco', 'Rua Nova, 7', 'duplicada', $3, $4),
         ($1, 'OC-D3', $2, 'Buraco', 'Rua Nova', 'duplicada', $3, $5)`,
      [MUN, cat, original, NA_JANELA(2), NA_JANELA(3)],
    );
    await ctx.db.query(
      `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, estado, criada_em, resolvida_em) VALUES
         ($1, 'OC-D4', $2, 'Luz', 'Largo', 'resolvida', '2019-06-05T10:00:00Z', $3)`,
      [MUN, cat, NA_JANELA(4)],
    );

    // Requerimento, processo (novo e com prazo a acabar hoje) e pagamento,
    // com um tipo de processo do próprio município (o RLS do painel não deixa
    // ver os tipos de outra câmara).
    const tipo = randomUUID();
    await ctx.db.query(
      `INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, formulario)
       SELECT $1, $2, codigo, nome, prazo_dias_uteis, formulario FROM tipos_processo WHERE id = $3`,
      [tipo, MUN, TIPO_CP_ID],
    );
    const req = randomUUID();
    await ctx.db.query(
      `INSERT INTO requerimentos (id, municipio_id, tipo_processo_id, criado_em) VALUES ($1, $2, $3, $4)`,
      [req, MUN, tipo, NA_JANELA(1)],
    );
    await ctx.db.query(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, fase, prazo_fim, criado_em) VALUES
         ($1, 'CP 1/2019', $2, 'Porta', 'apreciacao', '2019-06-12', $3),
         ($1, 'CP 2/2019', $2, 'Muro', 'notificado', '2019-06-12', '2019-05-01T10:00:00Z')`,
      [MUN, tipo, NA_JANELA(2)],
    );
    await ctx.db.query(
      `INSERT INTO pagamentos (municipio_id, requerimento_id, valor_cent, detalhe, estado, pago_em, modo_teste) VALUES
         ($1, $2, 1500, '[]', 'pago', $3, true)`,
      [MUN, req, NA_JANELA(3)],
    );

    // Uma chamada de saída atendida.
    const municipe = randomUUID();
    await ctx.db.query(
      `INSERT INTO municipes (id, municipio_id, telefone_e164) VALUES ($1, $2, '+351910000001')`,
      [municipe, MUN],
    );
    await ctx.db.query(
      `INSERT INTO chamadas_saida (municipio_id, municipe_id, telefone_e164, motivo, estado, iniciada_em) VALUES
         ($1, $2, '+351910000001', 'manual', 'atendida', $3)`,
      [MUN, municipe, NA_JANELA(6)],
    );
  });

  afterAll(async () => {
    await ctx.fechar();
  });

  async function emailsDo(relatorioId: string) {
    return linhas<{ destino: string; estado: string; corpo: string }>(
      ctx.db,
      `SELECT destino, estado::text AS estado, corpo FROM mensagens_saida
       WHERE relacionado ->> 'relatorio_id' = $1 ORDER BY destino`,
      [relatorioId],
    );
  }

  let id: string;

  it('gera o diário com os números das 24 horas', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/relatorios/gerar')
      .set(chefe)
      .send({ tipo: 'diario', ate: ATE })
      .expect(200);
    id = r.body.id;
    expect(r.body).toMatchObject({
      tipo: 'diario',
      de: '2019-06-12',
      ate: '2019-06-12',
      enviado_em: null,
    });
    const d = r.body.dados;
    expect(d.janela).toEqual({
      de: '2019-06-11T06:30:00.000Z',
      ate: '2019-06-12T06:30:00.000Z',
      fuso: 'Europe/Lisbon',
    });
    expect(d.numeros).toEqual({
      conversas: 8,
      por_canal: { telefone: 5, chat: 2, sms: 1 },
      chamadas: 5,
      escritas: 3,
      resolvidas_sem_humano: 4,
      resolvidas_sem_humano_pct: 57.1,
      passadas: 2,
      fora_de_horas: 1,
      emergencias: 1,
      ocorrencias_novas: 2,
      ocorrencias_resolvidas: 1,
      requerimentos_novos: 1,
      processos_novos: 1,
      pagamentos: { pagos: 1, valor_cent: 1500, modo_teste: 1 },
      chamadas_saida: { total: 1, atendidas: 1 },
    });

    // O que mais pediram: os monos (5, contra 1 nos 7 dias antes) subiram muito.
    expect(d.mais_pedidos[0]).toMatchObject({
      tema: 'Recolha de monos',
      total: 5,
      media_7d: 0.1,
      subiu_muito: true,
    });
    expect(d.atencao.picos.map((t: { tema: string }) => t.tema)).toEqual([
      'Recolha de monos',
    ]);

    // Reclamações: c4 (passagem 'outro' com queixa), c6 (tema) e o email de ruído.
    expect(d.reclamacoes).toMatchObject({
      total: 3,
      conversas: 2,
      emails: 1,
      ocorrencias_repetidas: [
        {
          categoria: 'Buraco na via',
          zona: 'Rua Nova',
          ocorrencias: ['OC-D1'],
          repetidas: 2,
        },
      ],
    });

    // Atenção hoje.
    expect(d.atencao.emergencias.total).toBe(1);
    expect(d.atencao.passagens).toMatchObject({ total: 2, atrasadas: 1 });
    expect(d.atencao.processos_prazo_hoje).toEqual({
      total: 1,
      itens: [{ numero: 'CP 1/2019', tipo: expect.any(String), tecnico: null }],
    });

    // Sem IA nos testes: a abertura é a do modelo, com os números.
    expect(d.abertura.origem).toBe('modelo');
    expect(d.abertura.texto).toContain('8 conversas');
  });

  it('as citações são anónimas: nada de telefones, nomes, moradas, NIF ou emails', async () => {
    const r = await ctx
      .http()
      .get(`/v1/painel/relatorios/${id}`)
      .set(chefe)
      .expect(200);
    const citacoes = r.body.dados.citacoes.map(
      (c: { texto: string }) => c.texto,
    );
    expect(citacoes).toEqual(
      expect.arrayContaining([
        'Já liguei várias vezes e continua tudo igual, ninguém resolve.',
        'A recolha devia ter passado ontem e não passou ninguém.',
      ]),
    );
    expect(citacoes.length).toBeLessThanOrEqual(5);
    const tudo = JSON.stringify(r.body.dados);
    for (const p of PESSOAIS) expect(tudo).not.toContain(p);
  });

  it('enviar: um email a cada destinatário configurado, uma vez por dia', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/relatorios/gerar')
      .set(chefe)
      .send({ tipo: 'diario', ate: ATE, enviar: true })
      .expect(200);
    expect(r.body.id).toBe(id);
    expect(r.body.enviado_em).not.toBeNull();
    const emails = await emailsDo(id);
    expect(emails.map((e) => e.destino)).toEqual(
      DESTINOS.map((x) => x.email).sort(),
    );
    expect(new Set(emails.map((e) => e.estado))).toEqual(new Set(['enviada']));
    expect(emails[0].corpo).toContain('Atenção hoje:');
    for (const p of PESSOAIS) expect(emails[0].corpo).not.toContain(p);

    // Repetir não duplica o relatório nem reenvia.
    const r2 = await ctx
      .http()
      .post('/v1/painel/relatorios/gerar')
      .set(chefe)
      .send({ tipo: 'diario', ate: ATE, enviar: true })
      .expect(200);
    expect(r2.body.id).toBe(id);
    expect(await emailsDo(id)).toHaveLength(2);
    const n = await linha<{ n: number }>(
      ctx.db,
      `SELECT count(*)::int AS n FROM relatorios WHERE municipio_id = $1 AND tipo = 'diario'`,
      [MUN],
    );
    expect(n?.n).toBe(1);
  });

  it('listar ?tipo=diario', async () => {
    const r = await ctx
      .http()
      .get('/v1/painel/relatorios?tipo=diario')
      .set(chefe)
      .expect(200);
    expect(r.body.itens.map((x: { id: string }) => x.id)).toEqual([id]);
    await ctx
      .http()
      .get('/v1/painel/relatorios?tipo=semanal')
      .set(chefe)
      .expect(200);
  });

  it('o job: às 07:30 do fuso gera e envia uma vez; antes das 07:30 nada', async () => {
    const svc = ctx.app.get(ResumoDiarioService);
    await svc.correrJob(new Date('2019-06-13T05:00:00Z')); // 06:00 em Lisboa
    const antes = await linha(
      ctx.db,
      `SELECT 1 FROM relatorios WHERE municipio_id = $1 AND periodo = '[2019-06-13,2019-06-13]'`,
      [MUN],
    );
    expect(antes).toBeUndefined();

    await svc.correrJob(new Date('2019-06-13T06:30:00Z')); // 07:30 em Lisboa
    const r = await linha<{ id: string; enviado_em: Date | null }>(
      ctx.db,
      `SELECT id, enviado_em FROM relatorios
       WHERE municipio_id = $1 AND tipo = 'diario' AND periodo = '[2019-06-13,2019-06-13]'`,
      [MUN],
    );
    expect(r?.enviado_em).not.toBeNull();
    const dados = await linha<{ dados: any }>(
      ctx.db,
      'SELECT dados FROM relatorios WHERE id = $1',
      [r!.id],
    );
    expect(dados?.dados.janela).toMatchObject({
      de: '2019-06-12T06:30:00.000Z',
      ate: '2019-06-13T06:30:00.000Z',
    });
    expect(await emailsDo(r!.id)).toHaveLength(2);

    // A volta seguinte (08:30) não repete.
    await svc.correrJob(new Date('2019-06-13T07:30:00Z'));
    expect(await emailsDo(r!.id)).toHaveLength(2);
  });

  it('município desligado: o job não gera nada', async () => {
    await ctx.db.query(
      `UPDATE municipios SET resumo_diario = '{"ativo": false, "destinatarios": []}' WHERE id = $1`,
      [MUN],
    );
    await ctx.app
      .get(ResumoDiarioService)
      .correrJob(new Date('2019-06-14T06:30:00Z'));
    const r = await linha(
      ctx.db,
      `SELECT 1 FROM relatorios WHERE municipio_id = $1 AND periodo = '[2019-06-14,2019-06-14]'`,
      [MUN],
    );
    expect(r).toBeUndefined();
  });

  it('ate inválido → 400', async () => {
    const r = await ctx
      .http()
      .post('/v1/painel/relatorios/gerar')
      .set(chefe)
      .send({ tipo: 'diario', ate: 'ontem' })
      .expect(400);
    expect(r.body.erro.codigo).toBe('pedido_invalido');
  });
});
