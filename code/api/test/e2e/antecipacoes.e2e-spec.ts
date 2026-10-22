/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomInt } from 'crypto';
import { somarDiasUteis } from '../../src/common/dias-uteis';
import { AntecipacoesDemoService } from '../../src/modules/antecipacoes/antecipacoes.demo';
import { AntecipacoesService } from '../../src/modules/antecipacoes/antecipacoes.service';
import { recuarDiasUteis } from '../../src/modules/antecipacoes/regras';
import { local } from '../../src/modules/chamadas-saida/regras';
import { passosDemo } from '../../src/modules/demo/demo.service';
import {
  Municipio,
  MunicipiosService,
} from '../../src/modules/municipios/municipios.service';
import { ProcessosAvisosService } from '../../src/modules/processos/processos-avisos.service';
import {
  arrancarApp,
  Contexto,
  criarUtilizador,
  entrarPainel,
  ferramenta,
  linha,
  linhas,
  MUNICIPIO_ID,
  novaConversa,
  novoTelefone,
  TIPO_CP_ID,
} from './app';

/**
 * "A câmara liga-lhe antes de o problema existir": o job encontra os
 * momentos e cria o contacto certo uma só vez; o painel, a configuração
 * (com permissões e auditoria), o alerta interno, a ferramenta do agente e
 * os processos da demonstração.
 */
describe('Antecipações (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let tecnico: Record<string, string>;
  let atendimento: Record<string, string>;
  let svc: AntecipacoesService;
  let m: Municipio;
  let feriados: Set<string>;
  let hoje: string;
  let configChamadas: unknown;

  beforeAll(async () => {
    ctx = await arrancarApp();
    chefe = await entrarPainel(ctx);
    tecnico = await entrarPainel(ctx, await criarUtilizador(ctx, 'tecnico'));
    atendimento = await entrarPainel(
      ctx,
      await criarUtilizador(ctx, 'atendimento'),
    );
    svc = ctx.app.get(AntecipacoesService);
    const municipios = ctx.app.get(MunicipiosService);
    m = await municipios.porId(MUNICIPIO_ID);
    feriados = await municipios.feriados(MUNICIPIO_ID);
    hoje = local(new Date(), m.fuso).dia;
    const a = await linha(
      ctx.db,
      'SELECT chamadas_saida FROM agente_config WHERE municipio_id = $1',
      [MUNICIPIO_ID],
    );
    configChamadas = a?.chamadas_saida;
    await desligarChamadas();
  });
  afterAll(async () => {
    await ctx.db.query(
      'UPDATE agente_config SET chamadas_saida = $2 WHERE municipio_id = $1',
      [MUNICIPIO_ID, JSON.stringify(configChamadas)],
    );
    await ctx.db.query(
      'DELETE FROM antecipacao_config WHERE municipio_id = $1',
      [MUNICIPIO_ID],
    );
    await ctx.fechar();
  });

  const desligarChamadas = () =>
    ctx.db.query(
      `UPDATE agente_config SET chamadas_saida = '{"ativo": false, "motivos": [], "numero_id": null, "via": "twilio"}'
       WHERE municipio_id = $1`,
      [MUNICIPIO_ID],
    );

  async function municipe(preferido: string | null = null) {
    const telefone = novoTelefone();
    const r = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO municipes (municipio_id, telefone_e164, nome, canal_preferido)
       VALUES ($1, $2, 'Munícipe Antecipação', $3) RETURNING id`,
      [MUNICIPIO_ID, telefone, preferido],
    );
    return { id: r!.id, telefone };
  }

  async function processo(o: {
    municipeId: string;
    fase?: string;
    tipoId?: string;
    prazoFim?: string | null;
    decidido?: string | null;
  }) {
    const numero = `CP ${randomInt(100_000, 999_999)}/E2E`;
    const r = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, municipe_id, assunto, morada,
         fase, prazo_inicio, prazo_fim, decisao, decidido_em)
       VALUES ($1, $2, $3, $4, 'Obra de teste', 'Rua de Teste, 1', $5::fase_processo,
         $6::date, $7::date, $8, $9::timestamptz)
       RETURNING id`,
      [
        MUNICIPIO_ID,
        numero,
        o.tipoId ?? TIPO_CP_ID,
        o.municipeId,
        o.fase ?? 'apreciacao',
        o.prazoFim ? recuarDiasUteis(hoje, 15, feriados) : null,
        o.prazoFim ?? null,
        o.decidido ? 'admitido' : null,
        o.decidido ?? null,
      ],
    );
    return { id: r!.id, numero };
  }

  /** Um pedido de elementos feito há `ha` dias úteis, com o prazo dado. */
  async function pedido(processoId: string, ha: number, prazo: string) {
    const dia = recuarDiasUteis(hoje, ha, feriados);
    const ev = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, em)
       VALUES ($1, 'documento_pedido', 'Pedido: certidão', 'sistema', $2::date + time '11:00')
       RETURNING id`,
      [processoId, dia],
    );
    const p = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO processo_pedidos (processo_id, evento_id, descricao, pedido_em, prazo)
       VALUES ($1, $2, 'Certidão do registo predial', $3::date + time '11:00', $4)
       RETURNING id`,
      [processoId, ev!.id, dia, prazo],
    );
    return p!.id;
  }

  const antecipacoesDe = (processoId: string) =>
    linhas(
      ctx.db,
      `SELECT * FROM antecipacoes WHERE processo_id = $1 ORDER BY criado_em`,
      [processoId],
    );

  // ------------------------------------------------------------------

  it('prazo do munícipe: um SMS (sem chamadas ativas), uma só vez, e o lembrete não repete', async () => {
    const pessoa = await municipe();
    const p = await processo({ municipeId: pessoa.id, fase: 'documentos' });
    const prazo = somarDiasUteis(hoje, 2, feriados);
    const pedidoId = await pedido(p.id, 8, prazo);

    await svc.correrMunicipio(m);
    const [a] = await antecipacoesDe(p.id);
    expect(a).toMatchObject({
      tipo: 'prazo_municipe',
      gravidade: 'alta',
      canal_previsto: 'chamada',
      canal: 'sms',
      motivo_sem_chamada: 'desligado',
      pedido_id: pedidoId,
      demonstracao: true,
    });
    expect(a.texto).toContain('Certidão do registo predial');
    const sms = await linhas(
      ctx.db,
      `SELECT * FROM mensagens_saida WHERE relacionado->>'antecipacao_id' = $1`,
      [a.id],
    );
    expect(sms).toHaveLength(1);
    expect(sms[0].destino).toBe(pessoa.telefone);

    // A marca é a do lembrete de prazo: o lembrete já não sai.
    const pp = await linha(
      ctx.db,
      'SELECT lembrete_enviado_em FROM processo_pedidos WHERE id = $1',
      [pedidoId],
    );
    expect(pp.lembrete_enviado_em).not.toBeNull();
    await ctx.app.get(ProcessosAvisosService).lembrarPrazos();
    const lembretes = await linhas(
      ctx.db,
      `SELECT 1 FROM processo_eventos WHERE processo_id = $1 AND tipo = 'lembrete_prazo'`,
      [p.id],
    );
    expect(lembretes).toHaveLength(0);

    // Idempotente: correr outra vez não cria outro contacto.
    await svc.correrMunicipio(m);
    expect(await antecipacoesDe(p.id)).toHaveLength(1);
    const eventos = await linhas(
      ctx.db,
      `SELECT * FROM processo_eventos WHERE processo_id = $1 AND tipo = 'antecipacao'`,
      [p.id],
    );
    expect(eventos).toHaveLength(1);
    expect(eventos[0].interno).toBe(true);
  });

  it('pedido já lembrado: regista "já avisado" sem novo contacto', async () => {
    const pessoa = await municipe();
    const p = await processo({ municipeId: pessoa.id, fase: 'documentos' });
    const pedidoId = await pedido(p.id, 8, somarDiasUteis(hoje, 1, feriados));
    await ctx.db.query(
      'UPDATE processo_pedidos SET lembrete_enviado_em = now() WHERE id = $1',
      [pedidoId],
    );
    await svc.correrMunicipio(m);
    const [a] = await antecipacoesDe(p.id);
    expect(a.canal).toBe('ja_avisado');
    const sms = await linhas(
      ctx.db,
      `SELECT 1 FROM mensagens_saida WHERE relacionado->>'antecipacao_id' = $1`,
      [a.id],
    );
    expect(sms).toHaveLength(0);
  });

  it('audiência prévia: o técnico abre e o agente liga (motivo antecipacao) uma só vez', async () => {
    await ctx.db.query(
      `UPDATE agente_config SET chamadas_saida = $2 WHERE municipio_id = $1`,
      [
        MUNICIPIO_ID,
        JSON.stringify({
          ativo: true,
          motivos: ['antecipacao'],
          numero_id: 'numero-saida-e2e',
          via: 'twilio',
        }),
      ],
    );
    try {
      const pessoa = await municipe();
      const p = await processo({ municipeId: pessoa.id });
      await ctx
        .http()
        .post(`/v1/painel/antecipacoes/processos/${p.id}/audiencia-previa`)
        .set(atendimento)
        .send({ fundamento: 'A obra excede a altura permitida.' })
        .expect(403);
      const r = await ctx
        .http()
        .post(`/v1/painel/antecipacoes/processos/${p.id}/audiencia-previa`)
        .set(tecnico)
        .send({ fundamento: 'A obra excede a altura permitida.' })
        .expect(200);
      expect(r.body.previstos[0]).toMatchObject({
        tipo: 'audiencia_previa',
        devido: true,
        confirmar_jurista: true,
      });

      await svc.correrMunicipio(m);
      await svc.correrMunicipio(m);
      const [a] = await antecipacoesDe(p.id);
      expect(a).toMatchObject({ tipo: 'audiencia_previa', canal: 'chamada' });
      const chamadas = await linhas(
        ctx.db,
        `SELECT * FROM chamadas_saida WHERE processo_id = $1`,
        [p.id],
      );
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]).toMatchObject({
        motivo: 'antecipacao',
        id: a.chamada_id,
      });
      expect(chamadas[0].contexto.o_que_mudou).toMatch(/indeferir/);
      expect(chamadas[0].contexto.nota).toMatch(/explicar_momento/);
      expect(chamadas[0].recurso.corpo).toMatch(/responder por escrito/);
    } finally {
      await desligarChamadas();
    }
  });

  it('prazo da câmara (licenciamento): aviso ao munícipe e alerta interno à chefia', async () => {
    const tipoLo = await linha<{ id: string }>(
      ctx.db,
      `INSERT INTO tipos_processo (municipio_id, codigo, nome, prazo_dias_uteis, formulario)
       VALUES ($1, 'LO', 'Licenciamento de obras', 45, '[]')
       ON CONFLICT (municipio_id, codigo) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
      [MUNICIPIO_ID],
    );
    const pessoa = await municipe();
    const p = await processo({
      municipeId: pessoa.id,
      tipoId: tipoLo!.id,
      prazoFim: somarDiasUteis(hoje, 1, feriados),
    });
    await svc.correrMunicipio(m);
    const linhasA = await antecipacoesDe(p.id);
    const municipe_ = linhasA.find((x) => x.destinatario === 'municipe');
    const chefia = linhasA.find((x) => x.destinatario === 'chefia');
    expect(municipe_).toMatchObject({ tipo: 'prazo_camara', canal: 'sms' });
    expect(municipe_.dizer).toMatch(/confirme connosco/);
    expect(chefia).toMatchObject({
      tipo: 'prazo_camara',
      canal: 'interno',
      gravidade: 'alta',
    });
    expect(chefia.texto).toMatch(/tacitamente deferido em 1 dia útil/);
    const ev = await linha(
      ctx.db,
      `SELECT * FROM processo_eventos WHERE processo_id = $1 AND tipo = 'alerta_prazo_camara'`,
      [p.id],
    );
    expect(ev.interno).toBe(true);
    const audit = await linha(
      ctx.db,
      `SELECT * FROM audit_log WHERE acao = 'alertar_prazo_camara' AND objeto_id = $1`,
      [p.id],
    );
    expect(audit).toBeTruthy();

    await svc.correrMunicipio(m);
    expect(await antecipacoesDe(p.id)).toHaveLength(2);

    // No painel: o alerta e o prazo da câmara.
    const r = await ctx
      .http()
      .get('/v1/painel/antecipacoes?dias=14')
      .set(chefe)
      .expect(200);
    expect(
      r.body.alertas.some(
        (a: { processo_id: string }) => a.processo_id === p.id,
      ),
    ).toBe(true);
    const prazo = r.body.prazos_camara.find(
      (x: { processo_id: string }) => x.processo_id === p.id,
    );
    expect(prazo.alerta).toMatch(/tacitamente deferido/);
  });

  it('caducidade e taxa por pagar aparecem no painel com o contacto e o resultado', async () => {
    const pessoa = await municipe();
    // Admitida há 12 meses menos 10 dias: caduca daqui a 10 dias.
    const decidido = new Date();
    decidido.setUTCFullYear(decidido.getUTCFullYear() - 1);
    decidido.setUTCDate(decidido.getUTCDate() + 10);
    const p = await processo({
      municipeId: pessoa.id,
      fase: 'notificado',
      decidido: decidido.toISOString(),
    });
    await svc.correrMunicipio(m);
    const r = await ctx
      .http()
      .get('/v1/painel/antecipacoes?dias=14')
      .set(tecnico)
      .expect(200);
    const mo = r.body.momentos.find(
      (x: { processo: { id: string } | null }) => x.processo?.id === p.id,
    );
    expect(mo).toMatchObject({
      tipo: 'caducidade_alvara',
      gravidade: 'alta',
      devido: true,
      confirmar_jurista: true,
      demonstracao: true,
    });
    expect(mo.o_agente_diz).toMatch(/caducar/);
    expect(mo.contacto.canal).toBe('sms');
    expect(mo.contacto.resultado).toMatch(/O agente ligaria/);
    expect(r.body.config).toHaveLength(6);

    const f = await ctx
      .http()
      .get(`/v1/painel/antecipacoes/processos/${p.id}`)
      .set(tecnico)
      .expect(200);
    expect(f.body.previstos).toHaveLength(1);
    expect(f.body.feitos).toHaveLength(1);
  });

  it('painel: sem o recurso processos dá 403', async () => {
    await ctx
      .http()
      .get('/v1/painel/antecipacoes')
      .set(atendimento)
      .expect(403);
  });

  it('configuração: só a chefia muda, fica auditada e a antecedência conta', async () => {
    const corpo = {
      tipos: [
        {
          tipo: 'prazo_municipe',
          ativo: true,
          antecedencia_dias_uteis: 1,
          canal: 'notificacao',
        },
      ],
    };
    await ctx
      .http()
      .put('/v1/painel/antecipacoes/config')
      .set(tecnico)
      .send(corpo)
      .expect(403);
    await ctx
      .http()
      .put('/v1/painel/antecipacoes/config')
      .set(chefe)
      .send({ tipos: [{ ...corpo.tipos[0], antecedencia_dias_uteis: 99 }] })
      .expect(400);
    const r = await ctx
      .http()
      .put('/v1/painel/antecipacoes/config')
      .set(chefe)
      .send(corpo)
      .expect(200);
    const t = r.body.tipos.find(
      (x: { tipo: string }) => x.tipo === 'prazo_municipe',
    );
    expect(t).toMatchObject({
      antecedencia_dias_uteis: 1,
      canal: 'notificacao',
      demonstracao: false,
    });
    const audit = await linha(
      ctx.db,
      `SELECT * FROM audit_log WHERE acao = 'configurar_antecipacoes' ORDER BY em DESC LIMIT 1`,
    );
    expect(audit.dados.depois.prazo_municipe.antecedencia_dias_uteis).toBe(1);

    // Com 1 dia útil, um prazo daqui a 2 ainda não é contactado.
    const pessoa = await municipe();
    const p = await processo({ municipeId: pessoa.id, fase: 'documentos' });
    await pedido(p.id, 8, somarDiasUteis(hoje, 2, feriados));
    await svc.correrMunicipio(m);
    expect(await antecipacoesDe(p.id)).toHaveLength(0);

    await ctx.db.query(
      `DELETE FROM antecipacao_config WHERE municipio_id = $1`,
      [MUNICIPIO_ID],
    );
  });

  it('correr agora: só a chefia, e devolve o resumo', async () => {
    await ctx
      .http()
      .post('/v1/painel/antecipacoes/correr')
      .set(tecnico)
      .expect(403);
    const r = await ctx
      .http()
      .post('/v1/painel/antecipacoes/correr')
      .set(chefe)
      .expect(200);
    expect(r.body).toHaveProperty('devidos');
    expect(r.body).toHaveProperty('contactos');
  });

  it('explicar_momento: o agente explica a data da pessoa que liga', async () => {
    const pessoa = await municipe();
    const p = await processo({ municipeId: pessoa.id, fase: 'documentos' });
    await pedido(p.id, 8, somarDiasUteis(hoje, 2, feriados));
    await svc.correrMunicipio(m);

    const chamada = {
      conversa: novaConversa('antecipa'),
      telefone: pessoa.telefone,
    };
    const r = await ferramenta(ctx, chamada, 'explicar_momento', {}).expect(
      200,
    );
    expect(r.body).toMatchObject({ encontrado: true });
    expect(r.body.momentos[0]).toMatchObject({
      o_que_e: 'Prazo do munícipe a acabar',
      numero_processo: p.numero,
    });
    expect(r.body.dizer).toMatch(/Certidão do registo predial/);
    const [a] = await antecipacoesDe(p.id);
    expect(a.explicado_em).not.toBeNull();

    const desconhecido = await ferramenta(
      ctx,
      { conversa: novaConversa('antecipa'), telefone: novoTelefone() },
      'explicar_momento',
      {},
    ).expect(200);
    // Um número novo fica munícipe sem assuntos: nada a explicar.
    expect(desconhecido.body).toMatchObject({
      encontrado: false,
      motivo: 'sem_momentos',
    });
    expect(desconhecido.body.dizer).toMatch(/Está tudo em dia/);
  });

  it('demonstração: os três processos dão os três momentos', async () => {
    expect(
      passosDemo().find((x) => x.passo === 'antecipacoes')?.chaves,
    ).toEqual([
      'antecipacao:pedido',
      'antecipacao:prazo_camara',
      'antecipacao:alvara',
    ]);
    const demo = ctx.app.get(AntecipacoesDemoService);
    const ids: string[] = [];
    for (const chave of [
      'antecipacao:pedido',
      'antecipacao:prazo_camara',
      'antecipacao:alvara',
    ] as const) {
      const pessoa = await municipe();
      ids.push((await demo.criar(m, chave, pessoa.id))!);
    }
    const r = await ctx
      .http()
      .get('/v1/painel/antecipacoes?dias=14')
      .set(chefe)
      .expect(200);
    const momentos = r.body.momentos as {
      tipo: string;
      processo: { id: string } | null;
    }[];
    const tipos = ids.map(
      (id) => momentos.find((x) => x.processo?.id === id)?.tipo,
    );
    expect(tipos).toEqual([
      'prazo_municipe',
      'prazo_camara',
      'caducidade_alvara',
    ]);
    for (const id of ids) {
      const mo = r.body.momentos.find(
        (x: { processo: { id: string } | null }) => x.processo?.id === id,
      );
      expect(mo.devido).toBe(true);
    }
  });
});
