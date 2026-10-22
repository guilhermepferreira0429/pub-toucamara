/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'crypto';
import { cartaoDe } from '../../src/modules/chat/chat.cartoes';
import { MunicipesService } from '../../src/modules/municipes/municipes.service';
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
  smsPara,
} from './app';

/** Um dia útil daqui a ~3 semanas (AAAA-MM-DD). */
function daquiA(dias = 21): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + dias);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Um NIF válido ao acaso (começa por 2, como os de pessoas singulares). */
function novoNif(): string {
  const base = `2${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
  const soma = [...base].reduce((s, c, i) => s + Number(c) * (9 - i), 0);
  const controlo = 11 - (soma % 11);
  return `${base}${controlo >= 10 ? 0 : controlo}`;
}

const CAFE = {
  atividade: 'restauracao',
  fase: 'abrir',
  abertura: daquiA(40),
  esplanada: true,
  publicidade: true,
  obras: false,
  musica: true,
  eventos_rua: false,
  horario_alargado: false,
  centro_historico: false,
  area_esplanada_m2: 20,
};

/**
 * Balcão para empresas: a lista do que a empresa precisa (página pública,
 * ferramenta do agente com SMS), o calendário de obrigações em .ics (pelas
 * licenças reais de quem está identificado) e o catálogo no painel, com
 * permissões e auditoria.
 */
describe('Balcão para empresas (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  let atendimento: Record<string, string>;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
    atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
  });
  afterAll(() => ctx.fechar());

  // ------------------------------------------------------------------
  // Público
  // ------------------------------------------------------------------

  let codigoPublico = '';

  it('público: o perfil → a lista e o calendário, sem guardar dados pessoais', async () => {
    await ctx
      .http()
      .post(`/v1/public/empresas/${MUNICIPIO}/lista`)
      .send({ esplanada: true })
      .expect(400);
    await ctx
      .http()
      .post('/v1/public/empresas/nao-existe/lista')
      .send(CAFE)
      .expect(404);

    const r = await ctx
      .http()
      .post(`/v1/public/empresas/${MUNICIPIO}/lista`)
      .send(CAFE)
      .expect(201);
    expect(r.body).toMatchObject({
      tipo: 'lista',
      atividade: 'Restaurante, café ou bar',
      valores_de_demonstracao: true,
    });
    codigoPublico = r.body.codigo;
    expect(codigoPublico).toMatch(/^[A-Z0-9]{8}$/);
    expect(r.body.link).toMatch(new RegExp(`/empresas/${codigoPublico}$`));
    const chaves = r.body.lista.itens.map((i: { chave: string }) => i.chave);
    expect(chaves).toEqual(
      expect.arrayContaining([
        'registo_atividade',
        'esplanada',
        'publicidade',
        'ruido',
        'seguranca_alimentar',
      ]),
    );
    expect(chaves).not.toContain('obras');
    const esplanada = r.body.lista.itens.find(
      (i: { chave: string }) => i.chave === 'esplanada',
    );
    expect(esplanada).toMatchObject({
      onde: 'camara',
      como: { tipo: 'agente', ferramenta: 'pedir_licenca_esplanada' },
      demonstracao: true,
    });
    // A taxa vem das regras em vigor da câmara (20 m² × 12 meses × 3 €).
    expect(esplanada.taxa).toMatchObject({ total_cent: 72_000 });
    const tipos = r.body.calendario.eventos.map(
      (e: { tipo: string }) => e.tipo,
    );
    expect(tipos).toEqual(expect.arrayContaining(['abertura', 'tratar']));

    const guardada = await linha(
      ctx.db,
      `SELECT canal, municipe_id, conversa_id, perfil FROM empresa_listas WHERE codigo = $1`,
      [codigoPublico],
    );
    expect(guardada).toMatchObject({
      canal: 'web',
      municipe_id: null,
      conversa_id: null,
    });
    expect(Object.keys(guardada.perfil).sort()).toEqual(
      Object.keys(CAFE).sort(),
    );

    const p = await ctx
      .http()
      .get(`/v1/public/empresas/listas/${codigoPublico.toLowerCase()}`)
      .expect(200);
    expect(p.body.lista.itens).toHaveLength(r.body.lista.itens.length);
    await ctx.http().get('/v1/public/empresas/listas/XXXX').expect(404);
    const inv = await ctx
      .http()
      .get('/v1/public/empresas/listas/ZZZZZZZZ')
      .expect(404);
    expect(inv.body.erro.codigo).toBe('link_invalido');

    const pg = await ctx
      .http()
      .get(`/v1/public/empresas/${MUNICIPIO}/perguntas`)
      .expect(200);
    expect(pg.body.atividades).toHaveLength(7);
    expect(pg.body.perguntas).toHaveLength(10);
  });

  it('público: o calendário em .ics', async () => {
    const r = await ctx
      .http()
      .get(`/v1/public/empresas/listas/${codigoPublico}/calendario.ics`)
      .buffer(true)
      .parse((res, cb) => {
        let s = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (s += c));
        res.on('end', () => cb(null, s));
      })
      .expect(200);
    expect(r.headers['content-type']).toMatch(/^text\/calendar/);
    expect(r.headers['content-disposition']).toContain('.ics');
    const ics = r.body as string;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    const plano = ics.replace(/\r\n /g, '');
    expect(plano).toContain('SUMMARY:Abertura prevista');
    expect(plano).toContain(
      `DTSTART;VALUE=DATE:${CAFE.abertura.replace(/-/g, '')}`,
    );
    expect(plano).toContain('SUMMARY:Tratar: Licença de esplanada');
  });

  // ------------------------------------------------------------------
  // Agente
  // ------------------------------------------------------------------

  it('ferramenta: pergunta o que falta, junta o perfil, diz 3 a 6 pontos e manda o link por SMS', async () => {
    const chamada = novaChamada('emp');
    const r0 = await ferramenta(ctx, chamada, 'o_que_a_empresa_precisa', {});
    expect(r0.status).toBe(200);
    expect(r0.body).toMatchObject({
      respondido: false,
      em_falta: ['atividade'],
    });

    const r1 = await ferramenta(ctx, chamada, 'o_que_a_empresa_precisa', {
      atividade: 'restauracao',
    }).expect(200);
    expect(r1.body.respondido).toBe(false);
    expect(r1.body.perguntar_a_seguir).toHaveLength(2);
    expect(await smsPara(ctx, chamada.telefone)).toHaveLength(0);

    // Só as respostas novas: a atividade ficou guardada na conversa.
    const r2 = await ferramenta(ctx, chamada, 'o_que_a_empresa_precisa', {
      fase: 'abrir',
      esplanada: true,
      musica: true,
      fim: true,
    }).expect(200);
    expect(r2.body).toMatchObject({
      respondido: true,
      atividade: 'Restaurante, café ou bar',
      sms_enviado: true,
      valores_de_demonstracao: true,
    });
    expect(r2.body.itens.length).toBeGreaterThanOrEqual(3);
    expect(r2.body.itens.length).toBeLessThanOrEqual(6);
    expect(r2.body.itens[0]).toMatchObject({
      chave: 'esplanada',
      pedir_com: 'pedir_licenca_esplanada',
    });
    expect(r2.body.dizer).toContain('licença de esplanada');
    expect(r2.body.dizer).toContain('SMS');

    const sms = await smsPara(ctx, chamada.telefone, 'fim_chamada');
    expect(sms).toHaveLength(1);
    expect(sms[0].corpo).toContain(r2.body.link);
    expect(r2.body.link).toMatch(/\/empresas\/[A-Z0-9]{8}$/);

    // Outra vez na mesma conversa: a mesma lista, sem novo SMS.
    const r3 = await ferramenta(ctx, chamada, 'o_que_a_empresa_precisa', {
      publicidade: true,
      fim: true,
    }).expect(200);
    expect(r3.body.link).toBe(r2.body.link);
    expect(await smsPara(ctx, chamada.telefone, 'fim_chamada')).toHaveLength(1);
    const guardadas = await linhas(
      ctx.db,
      `SELECT l.perfil FROM empresa_listas l JOIN conversas c ON c.id = l.conversa_id
       WHERE c.provider_id = $1`,
      [chamada.conversa],
    );
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0].perfil).toMatchObject({
      atividade: 'restauracao',
      esplanada: true,
      publicidade: true,
    });

    // O cartão do chat.
    expect(cartaoDe('o_que_a_empresa_precisa', r2.body)).toMatchObject({
      tipo: 'empresa',
    });
    expect(cartaoDe('obrigacoes_da_empresa', {})).toMatchObject({
      tipo: 'empresa',
    });
  });

  async function pagar(processoId: string) {
    const l = await linha(
      ctx.db,
      `SELECT lc.codigo FROM pagamentos pg
       JOIN links_curtos lc ON lc.destino_tipo = 'pagamento' AND lc.destino_id = pg.id
       WHERE pg.processo_id = $1 ORDER BY lc.expira_em DESC LIMIT 1`,
      [processoId],
    );
    await ctx
      .http()
      .post(`/v1/public/pagamentos/${l.codigo}/simular-pagamento`)
      .send({})
      .expect((r) => expect([200, 201]).toContain(r.status));
  }

  /** Uma esplanada de 2 meses, paga e emitida. */
  async function esplanadaEmitida(chamada: Chamada) {
    const r = await ferramenta(ctx, chamada, 'pedir_licenca_esplanada', {
      estabelecimento: 'Café do Largo',
      morada: 'Largo do Toural 1, Guimarães',
      data_inicio: daquiA(),
      meses: 2,
      area_m2: 10,
      mesas: 4,
      passeio_livre_m: 2,
      nome: 'Café do Largo Lda',
    }).expect(200);
    expect(r.body.proposta).toBe('aprovar');
    const l = await linha(
      ctx.db,
      `SELECT l.id, l.processo_id, l.municipe_id FROM licencas l
       JOIN processos p ON p.id = l.processo_id
       WHERE p.numero = $1 AND p.municipio_id = $2`,
      [r.body.numero, MUNICIPIO_ID],
    );
    await pagar(l.processo_id);
    await ctx.http().get(`/v1/painel/licencas/${l.id}`).set(chefe).expect(200);
    await ctx
      .http()
      .post(`/v1/painel/licencas/${l.id}/aprovar`)
      .set(chefe)
      .expect(200);
    const v = await linha(
      ctx.db,
      `SELECT to_char(valida_ate, 'YYYY-MM-DD') AS valida_ate FROM licencas WHERE id = $1`,
      [l.id],
    );
    return {
      numero: r.body.numero as string,
      municipeId: l.municipe_id as string,
      valida_ate: v.valida_ate as string,
    };
  }

  let municipeEmpresa = '';
  let numeroLicenca = '';

  it('ferramenta obrigacoes_da_empresa: sem licenças nem NIF pede identificação; depois as datas reais por SMS e em .ics', async () => {
    const chamada = novaChamada('obr');
    const sem = await ferramenta(ctx, chamada, 'obrigacoes_da_empresa').expect(
      200,
    );
    expect(sem.body.precisa_identificacao).toBe(true);

    const l = await esplanadaEmitida(chamada);
    municipeEmpresa = l.municipeId;
    numeroLicenca = l.numero;
    expect(l.valida_ate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const r = await ferramenta(ctx, chamada, 'obrigacoes_da_empresa').expect(
      200,
    );
    expect(r.body).toMatchObject({ encontrado: true, sms_enviado: true });
    expect(r.body.licencas).toEqual([
      expect.objectContaining({
        numero: l.numero,
        estado: 'emitida',
        valida_ate: l.valida_ate,
      }),
    ]);
    const tipos = r.body.proximas_datas.map((x: { tipo: string }) => x.tipo);
    expect(tipos).toEqual(expect.arrayContaining(['renovar', 'expira']));
    const expira = r.body.proximas_datas.find(
      (x: { tipo: string }) => x.tipo === 'expira',
    );
    expect(expira.data).toBe(l.valida_ate);
    expect(r.body.dizer).toContain('SMS');
    const sms = await smsPara(ctx, chamada.telefone, 'fim_chamada');
    expect(sms.map((s) => s.corpo).join(' ')).toContain(r.body.link);

    const codigo = String(r.body.link).split('/').pop()!;
    const pag = await ctx
      .http()
      .get(`/v1/public/empresas/listas/${codigo}`)
      .expect(200);
    expect(pag.body).toMatchObject({ tipo: 'obrigacoes', lista: null });
    const ics = await ctx
      .http()
      .get(`/v1/public/empresas/listas/${codigo}/calendario.ics`)
      .buffer(true)
      .parse((res, cb) => {
        let s = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (s += c));
        res.on('end', () => cb(null, s));
      })
      .expect(200);
    const plano = (ics.body as string).replace(/\r\n /g, '');
    expect(plano).toContain(`Renovar a licença de esplanada ${l.numero}`);
    expect(plano).toContain(
      `DTSTART;VALUE=DATE:${l.valida_ate.replace(/-/g, '')}`,
    );

    // O calendário de uma empresa expira (tem os números das licenças).
    await ctx.db.query(
      `UPDATE empresa_listas SET expira_em = now() - interval '1 minute' WHERE codigo = $1`,
      [codigo],
    );
    await ctx.http().get(`/v1/public/empresas/listas/${codigo}`).expect(404);

    // Com a lista do perfil na mesma conversa, a licença que já tem não se
    // repete como "pedir".
    const lista = await ferramenta(ctx, chamada, 'o_que_a_empresa_precisa', {
      atividade: 'restauracao',
      fase: 'aberta',
      esplanada: true,
      fim: true,
    }).expect(200);
    expect(
      lista.body.proximas_datas.map((x: { titulo: string }) => x.titulo),
    ).toEqual(
      expect.arrayContaining([`Renovar a licença de esplanada ${l.numero}`]),
    );
  });

  // ------------------------------------------------------------------
  // Painel
  // ------------------------------------------------------------------

  it('painel: ver é de quem trata processos; mudar o catálogo é de quem gere o agente', async () => {
    await ctx
      .http()
      .get('/v1/painel/empresas/catalogo')
      .set(atendimento)
      .expect(403);
    const r = await ctx
      .http()
      .get('/v1/painel/empresas/catalogo')
      .set(tecnico)
      .expect(200);
    expect(r.body.itens.length).toBeGreaterThan(10);
    expect(r.body.uso.listas_30_dias).toBeGreaterThanOrEqual(1);
    const esplanada = r.body.itens.find(
      (i: { chave: string }) => i.chave === 'esplanada',
    );
    expect(esplanada).toMatchObject({ alterado: false, demonstracao: true });

    const { alterado: _a, novo: _n, omissao: _o, ...requisito } = esplanada;
    void _a;
    void _n;
    void _o;
    const mudado = {
      ...requisito,
      titulo: 'Licença de esplanada (regulamento de Guimarães)',
      demonstracao: false,
    };
    await ctx
      .http()
      .put('/v1/painel/empresas/catalogo/esplanada')
      .set(tecnico)
      .send(mudado)
      .expect(403);
    await ctx
      .http()
      .put('/v1/painel/empresas/catalogo/esplanada')
      .set(chefe)
      .send({ ...mudado, periodicidade: 'semanal' })
      .expect(400);
    await ctx
      .http()
      .put('/v1/painel/empresas/catalogo/outra')
      .set(chefe)
      .send(mudado)
      .expect(400);
    const g = await ctx
      .http()
      .put('/v1/painel/empresas/catalogo/esplanada')
      .set(chefe)
      .send(mudado)
      .expect(200);
    const depois = g.body.itens.find(
      (i: { chave: string }) => i.chave === 'esplanada',
    );
    expect(depois).toMatchObject({
      titulo: 'Licença de esplanada (regulamento de Guimarães)',
      alterado: true,
      omissao: expect.objectContaining({ titulo: 'Licença de esplanada' }),
    });
    const audit = await linha(
      ctx.db,
      `SELECT acao, dados FROM audit_log WHERE objeto_tipo = 'empresa_requisito'
         AND objeto_id = 'esplanada' ORDER BY em DESC LIMIT 1`,
    );
    expect(audit.acao).toBe('mudar_requisito_empresa');
    expect(audit.dados.antes.titulo).toBe('Licença de esplanada');

    // A página pública passa logo a usar o catálogo da câmara.
    const pub = await ctx
      .http()
      .post(`/v1/public/empresas/${MUNICIPIO}/lista`)
      .send(CAFE)
      .expect(201);
    expect(
      pub.body.lista.itens.find(
        (i: { chave: string }) => i.chave === 'esplanada',
      ).titulo,
    ).toBe('Licença de esplanada (regulamento de Guimarães)');

    // Um requisito novo, só da câmara.
    const novo = {
      ...requisito,
      chave: 'mercado_municipal',
      titulo: 'Lugar no mercado municipal',
      tipo_licenca: null,
      atividades: ['comercio'],
      quando: ['vende_alimentos'],
      periodicidade: 'anual',
      ordem: 5,
    };
    await ctx
      .http()
      .put('/v1/painel/empresas/catalogo/mercado_municipal')
      .set(chefe)
      .send(novo)
      .expect(200);
    const pre = await ctx
      .http()
      .post('/v1/painel/empresas/pre-visualizar')
      .set(tecnico)
      .send({ atividade: 'comercio', vende_alimentos: true })
      .expect(200);
    expect(pre.body.lista.itens[0]).toMatchObject({
      chave: 'mercado_municipal',
      como: { tipo: 'camara' },
    });
    expect(
      (
        await linha(
          ctx.db,
          `SELECT acao FROM audit_log WHERE objeto_id = 'mercado_municipal' ORDER BY em DESC LIMIT 1`,
        )
      ).acao,
    ).toBe('criar_requisito_empresa');

    // Repor: volta o do código; o novo desaparece; sem alterações → 404.
    await ctx
      .http()
      .delete('/v1/painel/empresas/catalogo/esplanada')
      .set(tecnico)
      .expect(403);
    const rp = await ctx
      .http()
      .delete('/v1/painel/empresas/catalogo/esplanada')
      .set(chefe)
      .expect(200);
    expect(
      rp.body.itens.find((i: { chave: string }) => i.chave === 'esplanada'),
    ).toMatchObject({ titulo: 'Licença de esplanada', alterado: false });
    const rn = await ctx
      .http()
      .delete('/v1/painel/empresas/catalogo/mercado_municipal')
      .set(chefe)
      .expect(200);
    expect(
      rn.body.itens.some(
        (i: { chave: string }) => i.chave === 'mercado_municipal',
      ),
    ).toBe(false);
    await ctx
      .http()
      .delete('/v1/painel/empresas/catalogo/esplanada')
      .set(chefe)
      .expect(404);
    const reposto = await linha(
      ctx.db,
      `SELECT acao FROM audit_log WHERE objeto_id = 'esplanada' ORDER BY em DESC LIMIT 1`,
    );
    expect(reposto.acao).toBe('repor_requisito_empresa');
  });

  it('painel: o calendário de obrigações de uma empresa pelo NIF (fica registado quem viu)', async () => {
    expect(municipeEmpresa).not.toBe('');
    const nif = novoNif();
    await ctx.app.get(MunicipesService).atualizar(municipeEmpresa, { nif });

    await ctx
      .http()
      .get('/v1/painel/empresas/obrigacoes')
      .query({ nif })
      .set(atendimento)
      .expect(403);
    await ctx
      .http()
      .get('/v1/painel/empresas/obrigacoes')
      .set(chefe)
      .expect(400);
    await ctx
      .http()
      .get('/v1/painel/empresas/obrigacoes')
      .query({ nif: '123456780' })
      .set(chefe)
      .expect(400);
    await ctx
      .http()
      .get('/v1/painel/empresas/obrigacoes')
      .query({ nif: novoNif() })
      .set(chefe)
      .expect(404);

    const r = await ctx
      .http()
      .get('/v1/painel/empresas/obrigacoes')
      .query({ nif })
      .set(tecnico)
      .expect(200);
    expect(r.body.municipe_id).toBe(municipeEmpresa);
    expect(r.body.licencas.map((l: { numero: string }) => l.numero)).toEqual([
      numeroLicenca,
    ]);
    expect(
      r.body.calendario.eventos.map((e: { tipo: string }) => e.tipo),
    ).toEqual(expect.arrayContaining(['renovar', 'expira']));
    const audit = await linha(
      ctx.db,
      `SELECT acao FROM audit_log WHERE objeto_tipo = 'municipe' AND objeto_id = $1
       ORDER BY em DESC LIMIT 1`,
      [municipeEmpresa],
    );
    expect(audit.acao).toBe('ver_obrigacoes_empresa');
  });
});
