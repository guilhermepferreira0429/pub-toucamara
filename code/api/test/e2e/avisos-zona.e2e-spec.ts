/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt, randomUUID } from 'crypto';
import {
  arrancarApp,
  codigoDoLink,
  Contexto,
  criarUtilizador,
  entrarPainel,
  esperarAte,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaChamada,
  novoTelefone,
  smsPara,
  TIPO_CP_ID,
} from './app';
import { WEB_URL } from './ambiente';
import {
  dentroDaJanela,
  proximaJanela,
} from '../../src/modules/avisos-zona/avisos-zona.regras';
import { instanteLocal, local } from '../../src/modules/chamadas-saida/regras';

const ENTIDADE_RESIDUOS = '00000000-0000-0000-0000-0000000000e4';

/**
 * Avisos por zona: munícipes com morada dentro e fora da zona (por
 * coordenadas e pelo nome da rua), pré-visualização, confirmação do número,
 * envio só aos de dentro, opt-out (página do aviso e ferramenta),
 * emergência a qualquer hora e a ignorar o opt-out.
 */
describe('Avisos por zona (e2e)', () => {
  let ctx: Contexto;
  let painel: Record<string, string>;

  // Longe das coordenadas dos outros ficheiros (41,3-41,5 / -8,4--8,2).
  const base = {
    lat: 40.0 + Math.random() * 0.2,
    lng: -7.6 + Math.random() * 0.2,
  };
  const aNorte = (metros: number) => ({
    lat: base.lat + metros * 0.000009,
    lng: base.lng,
  });
  // Só letras: um sufixo com algarismos podia passar por número de porta.
  const letras = Array.from({ length: 8 }, () =>
    String.fromCharCode(97 + randomInt(26)),
  ).join('');
  const rua = `Rua das Flores ${letras}`;
  const zona = { tipo: 'ruas', ruas: [rua], raio_m: 150 };

  /** A: ocorrência a 50 m do centro da rua (coordenadas). */
  const A = { id: randomUUID(), tel: novoTelefone() };
  /** B: processo a 1 km, noutra rua (fora). */
  const B = { id: randomUUID(), tel: novoTelefone() };
  /** C: recolha na rua, sem coordenadas, escrita "R. das Flores …, 12". */
  const C = { id: randomUUID(), tel: novoTelefone() };
  /** D: requerimento com obra na rua, mas recusou avisos. */
  const D = { id: randomUUID(), tel: novoTelefone() };
  /** E: dentro, mas só tem telefone fixo. */
  const E = { id: randomUUID(), tel: `+351253${randomInt(100_000, 999_999)}` };
  /** F: processo e ocorrência na rua (um só SMS). */
  const F = { id: randomUUID(), tel: novoTelefone() };
  const todos = [A, B, C, D, E, F];

  const preVisualizar = (corpo: object) =>
    ctx
      .http()
      .post('/v1/painel/avisos-zona/pre-visualizar')
      .set(painel)
      .send(corpo);
  const criar = (corpo: object) =>
    ctx.http().post('/v1/painel/avisos-zona').set(painel).send(corpo);
  const enviar = (id: string, n: number) =>
    ctx
      .http()
      .post(`/v1/painel/avisos-zona/${id}/enviar`)
      .set(painel)
      .send({ confirmo_destinatarios: n });
  const smsAviso = async (tel: string, avisoId: string) =>
    (await smsPara(ctx, tel, 'aviso')).filter(
      (s) => s.relacionado.aviso_zona_id === avisoId,
    );

  beforeAll(async () => {
    ctx = await arrancarApp();
    painel = await entrarPainel(ctx);
    ctx.geo.moradas.set(rua, base);

    for (const [i, m] of todos.entries()) {
      await ctx.db.query(
        `INSERT INTO municipes (id, municipio_id, telefone_e164, nome, aceita_avisos)
         VALUES ($1, $2, $3, $4, $5)`,
        [m.id, MUNICIPIO_ID, m.tel, `Pessoa ${i} Teste`, m !== D],
      );
    }
    const cat = await linha<{ id: string }>(
      ctx.db,
      `SELECT id FROM categorias_ocorrencia WHERE municipio_id = $1 LIMIT 1`,
      [MUNICIPIO_ID],
    );
    const ocorrencia = (municipe: string, morada: string, p: object) =>
      ctx.db.query(
        `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, lat, lng, municipe_id)
         VALUES ($1, $2, $3, 'Teste de aviso', $4, $5, $6, $7)`,
        [
          MUNICIPIO_ID,
          `AVZ-${letras}-${randomInt(1e9)}`,
          cat!.id,
          morada,
          (p as { lat: number }).lat,
          (p as { lng: number }).lng,
          municipe,
        ],
      );
    const processo = (municipe: string, morada: string, p: object | null) =>
      ctx.db.query(
        `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada, lat, lng)
         VALUES ($1, $2, $3, $4, 'Obra', $5, $6, $7)`,
        [
          MUNICIPIO_ID,
          `AVZ ${letras} ${randomInt(1e9)}`,
          TIPO_CP_ID,
          municipe,
          morada,
          (p as { lat: number } | null)?.lat ?? null,
          (p as { lng: number } | null)?.lng ?? null,
        ],
      );

    // Moradas com outro nome de rua: só as coordenadas contam.
    await ocorrencia(A.id, `Travessa ${letras} 3`, aNorte(50));
    await processo(B.id, `Avenida Longe ${letras} 9`, aNorte(1000));
    await ctx.db.query(
      `INSERT INTO recolhas (municipio_id, entidade_id, municipe_id, morada, itens, janela)
       VALUES ($1, $2, $3, $4, '[{"item":"sofá","qtd":1}]',
         tstzrange(now() + interval '2 days', now() + interval '2 days 4 hours'))`,
      [MUNICIPIO_ID, ENTIDADE_RESIDUOS, C.id, `R. das Flores ${letras}, 12`],
    );
    await ctx.db.query(
      `INSERT INTO requerimentos (municipio_id, municipe_id, tipo_processo_id, dados)
       VALUES ($1, $2, $3, $4)`,
      [
        MUNICIPIO_ID,
        D.id,
        TIPO_CP_ID,
        JSON.stringify({ morada_obra: `${rua}, 40` }),
      ],
    );
    await ocorrencia(E.id, `${rua} 2`, aNorte(10));
    await processo(F.id, `${rua}, 77`, null);
    await ocorrencia(F.id, `${rua} 80`, aNorte(-30));
  });
  afterAll(() => ctx.fechar());

  it('pré-visualização: só os de dentro, por origem, amostra mascarada', async () => {
    const r = await preVisualizar({ zona }).expect(200);
    expect(ctx.geo.pedidos).toContain(rua);
    expect(r.body).toMatchObject({
      destinatarios: 3,
      por_origem: { ocorrencia: 2, processo: 1, recolha: 1, requerimento: 0 },
      excluidos: { sem_telefone: 1, recusaram_avisos: 1, anonimizados: 0 },
      ignora_recusas: false,
      zona: { descricao: rua, ruas_sem_coordenadas: [] },
      limite: 5000,
    });
    expect(r.body.amostra).toHaveLength(3);
    // Nunca telefones em claro nem nomes inteiros.
    const json = JSON.stringify(r.body);
    for (const m of todos) expect(json).not.toContain(m.tel);
    expect(json).not.toContain('Pessoa');
    expect(r.body.amostra[0].telefone).toMatch(/•/);
  });

  it('polígono: só moradas com coordenadas dentro dele', async () => {
    const d = 0.0009; // ~100 m
    const r = await preVisualizar({
      zona: {
        tipo: 'poligono',
        pontos: [
          { lat: base.lat, lng: base.lng - d },
          { lat: base.lat, lng: base.lng + d },
          { lat: base.lat + d, lng: base.lng + d },
          { lat: base.lat + d, lng: base.lng - d },
        ],
      },
    }).expect(200);
    // A (50 m a norte) dentro; E fixo; F (30 m a sul) fora; C sem coordenadas.
    expect(r.body).toMatchObject({
      destinatarios: 1,
      excluidos: { sem_telefone: 1 },
      zona: { descricao: 'Na área marcada no mapa' },
    });
  });

  it('sem o perfil do agente não cria avisos', async () => {
    const atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    await ctx
      .http()
      .post('/v1/painel/avisos-zona')
      .set(atendimento)
      .send({ titulo: 'x', mensagem: 'y', tipo: 'obras', zona })
      .expect(403);
    // Ver a lista pode.
    await ctx.http().get('/v1/painel/avisos-zona').set(atendimento).expect(200);
  });

  let avisoAgua: string;

  it('criar → rascunho; confirmação errada → 409; certa → SMS só aos de dentro', async () => {
    const c = await criar({
      titulo: 'Corte de agua',
      mensagem: `Na ${rua} amanha das 9h as 13h.`,
      tipo: 'agua',
      zona,
    }).expect(201);
    expect(c.body).toMatchObject({
      estado: 'rascunho',
      destinatarios_previstos: 3,
      zona_descricao: rua,
      pre_visualizacao: { destinatarios: 3 },
      sms: { segmentos: expect.any(Number) },
    });
    expect(c.body.sms.exemplo).toContain(`${WEB_URL}/r/`);
    avisoAgua = c.body.id;

    const errada = await enviar(avisoAgua, 4).expect(409);
    expect(errada.body.erro).toMatchObject({
      codigo: 'confirmacao_diferente',
      detalhes: { destinatarios: 3, confirmados: 4 },
    });
    expect(
      (await linha(ctx.db, 'SELECT estado FROM avisos_zona WHERE id = $1', [
        avisoAgua,
      ]))!.estado,
    ).toBe('rascunho');

    const agora = new Date();
    const r = await enviar(avisoAgua, 3).expect(200);
    expect(r.body.contagens.destinatarios).toBe(3);

    const auditoria = await linha(
      ctx.db,
      `SELECT dados FROM audit_log WHERE acao = 'enviar_aviso_zona' AND objeto_id = $1`,
      [avisoAgua],
    );
    expect(auditoria!.dados).toMatchObject({ destinatarios: 3 });

    if (!dentroDaJanela(agora, 'Europe/Lisbon')) {
      // Fora das 9h-21h: fica agendado para o período seguinte.
      expect(r.body.estado).toBe('agendado');
      expect(new Date(r.body.agendado_para).getTime()).toBe(
        proximaJanela(agora, 'Europe/Lisbon').getTime(),
      );
      expect(await smsAviso(A.tel, avisoAgua)).toHaveLength(0);
      return;
    }
    const final = await esperarAte(async () => {
      const d = await ctx
        .http()
        .get(`/v1/painel/avisos-zona/${avisoAgua}`)
        .set(painel)
        .expect(200);
      return d.body.estado === 'enviado' && d.body.contagens.enviados === 3
        ? d.body
        : null;
    });
    expect(final.contagens).toMatchObject({
      destinatarios: 3,
      por_enviar: 0,
      enviados: 3,
      falhados: 0,
    });
    for (const m of [A, C, F]) {
      const s = await smsAviso(m.tel, avisoAgua);
      expect(s).toHaveLength(1);
      expect(s[0].corpo).toMatch(
        /^CM Teste: Corte de agua\. .* Mais info\/deixar de receber: http:\/\/web\.e2e\.local\/r\/[A-Z0-9]{6}$/,
      );
    }
    for (const m of [B, D, E]) {
      expect(await smsAviso(m.tel, avisoAgua)).toHaveLength(0);
    }
  });

  it('enviar outra vez → 409 estado_invalido', async () => {
    const r = await enviar(avisoAgua, 3).expect(409);
    expect(r.body.erro.codigo).toBe('estado_invalido');
  });

  let codigoA: string;

  it('emergência: vai já a qualquer hora e ignora quem recusou avisos', async () => {
    const pre = await preVisualizar({ zona }).expect(200);
    expect(pre.body.destinatarios).toBe(3);

    const c = await criar({
      titulo: 'Incendio',
      mensagem:
        'Incendio florestal perto da sua rua: siga as indicacoes da protecao civil.',
      tipo: 'emergencia',
      zona,
    }).expect(201);
    // Quem recusou avisos (D) conta: é segurança.
    expect(c.body.pre_visualizacao).toMatchObject({
      destinatarios: 4,
      ignora_recusas: true,
      excluidos: { recusaram_avisos: 0, sem_telefone: 1 },
    });
    const antes = Date.now();
    const r = await enviar(c.body.id, 4).expect(200);
    expect(new Date(r.body.agendado_para).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(new Date(r.body.agendado_para).getTime()).toBeGreaterThanOrEqual(
      antes - 1000,
    );

    for (const m of [A, C, D, F]) {
      await esperarAte(async () => {
        const s = await smsAviso(m.tel, c.body.id);
        return s.length === 1 && s[0].estado === 'enviada';
      });
    }
    for (const m of [B, E]) {
      expect(await smsAviso(m.tel, c.body.id)).toHaveLength(0);
    }
    const [sms] = await smsAviso(A.tel, c.body.id);
    expect(sms.corpo).toMatch(/^URGENTE - CM Teste: Incendio florestal/);
    codigoA = codigoDoLink(/\S+$/.exec(sms.corpo)![0]);
  });

  it('página pública do aviso e "deixar de receber"', async () => {
    const redir = await ctx.http().get(`/r/${codigoA}`).expect(302);
    expect(redir.headers.location).toBe(`${WEB_URL}/aviso/${codigoA}`);

    const p = await ctx.http().get(`/v1/public/avisos/${codigoA}`).expect(200);
    expect(p.body).toMatchObject({
      municipio: 'Teste',
      titulo: 'Incendio',
      emergencia: true,
      zona: rua,
      recebe_avisos: true,
    });
    expect(JSON.stringify(p.body)).not.toContain(A.tel);

    const s = await ctx
      .http()
      .post(`/v1/public/avisos/${codigoA}/sair`)
      .expect(200);
    expect(s.body).toMatchObject({ gravado: true, recebe_avisos: false });
    expect(
      (await linha(
        ctx.db,
        'SELECT aceita_avisos FROM municipes WHERE id = $1',
        [A.id],
      ))!.aceita_avisos,
    ).toBe(false);
    const audit = await linhas(
      ctx.db,
      `SELECT 1 FROM audit_log WHERE acao = 'recusar_avisos' AND objeto_id = $1`,
      [A.id],
    );
    expect(audit).toHaveLength(1);

    await ctx.http().get('/v1/public/avisos/ZZZZZZ').expect(404);
  });

  it('ferramenta nao_quero_avisos grava o opt-out; a pré-visualização respeita-o', async () => {
    const chamada = { ...novaChamada('avz'), telefone: C.tel };
    const r = await ferramenta(ctx, chamada, 'nao_quero_avisos').expect(200);
    expect(r.body).toMatchObject({
      gravado: true,
      dizer: expect.stringContaining('emergência'),
    });
    expect(
      (await linha(
        ctx.db,
        'SELECT aceita_avisos FROM municipes WHERE id = $1',
        [C.id],
      ))!.aceita_avisos,
    ).toBe(false);

    const pre = await preVisualizar({ zona }).expect(200);
    expect(pre.body).toMatchObject({
      destinatarios: 1, // só o F
      excluidos: { recusaram_avisos: 3 },
    });

    // Número anónimo (sem conversa nem telefone): não grava nada.
    const desconhecido = await ferramenta(
      ctx,
      undefined,
      'nao_quero_avisos',
    ).expect(200);
    expect(desconhecido.body.gravado).toBe(false);
  });

  it('cancelar: rascunho → cancelado; depois não se envia', async () => {
    const c = await criar({
      titulo: 'Obras na rua',
      mensagem: 'Obras de repavimentacao na proxima semana.',
      tipo: 'obras',
      zona,
    }).expect(201);
    const r = await ctx
      .http()
      .post(`/v1/painel/avisos-zona/${c.body.id}/cancelar`)
      .set(painel)
      .expect(200);
    expect(r.body).toMatchObject({ estado: 'cancelado' });
    const e = await enviar(c.body.id, 1).expect(409);
    expect(e.body.erro.codigo).toBe('estado_invalido');

    const lista = await ctx
      .http()
      .get('/v1/painel/avisos-zona?estado=cancelado&limite=5')
      .set(painel)
      .expect(200);
    expect(lista.body.itens.map((a: { id: string }) => a.id)).toContain(
      c.body.id,
    );
  });

  it('não urgente pedido para as 23h30: agenda para as 9h seguintes; cancelado não sai', async () => {
    // Amanhã às 23h30 em Lisboa (fora da janela, seja qual for a hora agora).
    const amanha = local(new Date(Date.now() + 86_400_000), 'Europe/Lisbon');
    const pedido = new Date(
      instanteLocal(amanha.dia, 23, 'Europe/Lisbon').getTime() + 30 * 60_000,
    );
    const c = await criar({
      titulo: 'Recolha do lixo',
      mensagem: 'A recolha passa a ser as tercas e sextas.',
      tipo: 'residuos',
      zona,
      enviar_em: pedido.toISOString(),
    }).expect(201);
    const r = await enviar(c.body.id, c.body.destinatarios_previstos).expect(
      200,
    );
    expect(r.body.estado).toBe('agendado');
    expect(new Date(r.body.agendado_para).getTime()).toBe(
      proximaJanela(pedido, 'Europe/Lisbon').getTime(),
    );
    expect(new Date(r.body.agendado_para).getTime()).toBeGreaterThan(
      pedido.getTime(),
    );

    const x = await ctx
      .http()
      .post(`/v1/painel/avisos-zona/${c.body.id}/cancelar`)
      .set(painel)
      .expect(200);
    expect(x.body).toMatchObject({
      estado: 'cancelado',
      contagens: {
        destinatarios: 1,
        por_enviar: 0,
        enviados: 0,
        excluidos: 0,
        cancelados: 1,
      },
    });
    expect(await smsAviso(F.tel, c.body.id)).toHaveLength(0);

    // Emergência à mesma hora: fica às 23h30 (não espera pelas 9h).
    const u = await criar({
      titulo: 'Cheia',
      mensagem: 'Risco de cheia: nao estacione junto ao rio.',
      tipo: 'emergencia',
      zona,
      enviar_em: pedido.toISOString(),
    }).expect(201);
    const ru = await enviar(u.body.id, u.body.destinatarios_previstos).expect(
      200,
    );
    expect(new Date(ru.body.agendado_para).getTime()).toBe(pedido.getTime());
    await ctx
      .http()
      .post(`/v1/painel/avisos-zona/${u.body.id}/cancelar`)
      .set(painel)
      .expect(200);
  });

  it('mensagem demasiado longa → 422; zona inválida → 400', async () => {
    const longa = await criar({
      titulo: 'Aviso',
      mensagem: 'Mensagem com acentos e muito comprida: ação. '.repeat(10),
      tipo: 'outro',
      zona,
    }).expect(422);
    expect(longa.body.erro.codigo).toBe('mensagem_demasiado_longa');
    await preVisualizar({
      zona: { tipo: 'poligono', pontos: [{ lat: 1, lng: 1 }] },
    }).expect(400);
  });
});
