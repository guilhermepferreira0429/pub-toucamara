/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- os corpos do supertest são `any`; as asserções do jest verificam a forma. */
import { randomUUID } from 'crypto';
import { diasUteisEntre, somarDiasUteis } from '../../src/common/dias-uteis';
import { hojeNoFuso, somarDias } from '../../src/modules/painel/periodos';
import { arrancarApp, Contexto, entrarPainel, linhas } from './app';

/**
 * Gestão e indicadores (V2): carga, tempos, onde param e atrasados.
 *
 * Um município só deste ficheiro (os números são do município inteiro e os
 * outros ficheiros também criam processos no 'teste'). Datas relativas a
 * hoje; os dias úteis esperados contam-se com as mesmas regras da API.
 */

const M = randomUUID();
const ENTIDADE = randomUUID();
const S_OBRAS = randomUUID();
const S_VIAS = randomUUID();
const TIPO = randomUUID();
const CHEFE = randomUUID();
const ATENDIMENTO = randomUUID();
const TEC_A = randomUUID();
const TEC_B = randomUUID();
const TEC_C = randomUUID();

/** Meio-dia UTC: o mesmo dia em Lisboa. */
const em = (dia: string) => `${dia}T12:00:00Z`;

describe('Gestão (e2e)', () => {
  let ctx: Contexto;
  let chefe: Record<string, string>;
  let hoje: string;
  let feriados: Set<string>;
  const ids: Record<string, string> = {};
  /** Dias úteis em apreciação de cada decidido (para a média esperada). */
  const apreciacao: number[] = [];

  async function processo(p: {
    chave: string;
    fase: string;
    criado: string;
    tecnico?: string | null;
    prazo_fim?: string | null;
    decidido?: string | null;
    /** [dia, de, para] */
    fases?: [string, string, string][];
  }): Promise<string> {
    const id = randomUUID();
    ids[p.chave] = id;
    await ctx.db.query(
      `INSERT INTO processos (id, municipio_id, numero, tipo_processo_id, assunto, fase,
         tecnico_id, prazo_fim, decisao, decidido_em, criado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        M,
        `GE ${p.chave}/2026`,
        TIPO,
        `Processo ${p.chave}`,
        p.fase,
        p.tecnico ?? null,
        p.prazo_fim ?? null,
        p.decidido ? 'admitido' : null,
        p.decidido ? em(p.decidido) : null,
        em(p.criado),
      ],
    );
    await ctx.db.query(
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, em)
       VALUES ($1, 'criado', 'Processo aberto.', 'municipe', $2)`,
      [id, em(p.criado)],
    );
    for (const [dia, de, para] of p.fases ?? []) {
      await ctx.db.query(
        `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, dados, em)
         VALUES ($1, 'fase', $2, 'utilizador', $3, $4)`,
        [id, `${de} → ${para}`, JSON.stringify({ de, para }), em(dia)],
      );
    }
    return id;
  }

  beforeAll(async () => {
    ctx = await arrancarApp();
    hoje = hojeNoFuso('Europe/Lisbon');
    const d = (n: number) => somarDias(hoje, -n);

    await ctx.db.query(
      `INSERT INTO municipios (id, slug, nome) VALUES ($1, $2, 'Gestão e2e')`,
      [M, `gestao-${M.slice(0, 8)}`],
    );
    await ctx.db.query(
      `INSERT INTO entidades (id, municipio_id, nome, tipo) VALUES ($1, $2, 'Câmara', 'camara')`,
      [ENTIDADE, M],
    );
    await ctx.db.query(
      `INSERT INTO servicos (id, municipio_id, entidade_id, nome) VALUES
         ($1, $3, $4, 'Obras particulares'), ($2, $3, $4, 'Vias')`,
      [S_OBRAS, S_VIAS, M, ENTIDADE],
    );
    await ctx.db.query(
      `INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, servico_id, formulario)
       VALUES ($1, $2, 'GE', 'Gestão e2e', 20, $3, '[]')`,
      [TIPO, M, S_OBRAS],
    );
    await ctx.db.query(
      `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil, servico_id) VALUES
         ($1, $6, $7 || '-chefe@ge.pt', 'Chefe GE', 'chefe_divisao', NULL),
         ($2, $6, $7 || '-atend@ge.pt', 'Atendimento GE', 'atendimento', NULL),
         ($3, $6, $7 || '-a@ge.pt', 'Ana GE', 'tecnico', $8),
         ($4, $6, $7 || '-b@ge.pt', 'Bruno GE', 'tecnico', $8),
         ($5, $6, $7 || '-c@ge.pt', 'Carla GE', 'tecnico', $9)`,
      [
        CHEFE,
        ATENDIMENTO,
        TEC_A,
        TEC_B,
        TEC_C,
        M,
        M.slice(0, 8),
        S_OBRAS,
        S_VIAS,
      ],
    );

    // Histórico: 6 decididos (entrada 1 dia → apreciação 10 a 20 dias →
    // decisão 2 dias → notificado), mais um importado sem eventos de fase.
    for (let i = 0; i < 6; i++) {
      const criado = d(50 + i);
      const aprec = somarDias(criado, 1);
      const dec = somarDias(aprec, 10 + i * 2);
      const notif = somarDias(dec, 2);
      await processo({
        chave: `H${i}`,
        fase: 'notificado',
        criado,
        tecnico: TEC_A,
        prazo_fim: i < 3 ? somarDias(notif, 5) : somarDias(notif, -1),
        decidido: notif,
        fases: [
          [aprec, 'entrada', 'apreciacao'],
          [dec, 'apreciacao', 'decisao'],
          [notif, 'decisao', 'notificado'],
        ],
      });
    }
    await ctx.db.query(
      `INSERT INTO processos (municipio_id, numero, tipo_processo_id, assunto, fase, decisao, decidido_em, criado_em)
       VALUES ($1, 'GE importado/2026', $2, 'Importado', 'notificado', 'indeferido', $3, $4)`,
      [M, TIPO, em(d(3)), em(d(40))],
    );

    // Em curso.
    await processo({
      chave: 'parado',
      fase: 'apreciacao',
      criado: d(70),
      tecnico: TEC_A,
      prazo_fim: d(10),
      fases: [[d(60), 'entrada', 'apreciacao']],
    });
    await processo({
      chave: 'espera',
      fase: 'documentos',
      criado: d(30),
      tecnico: TEC_B,
    });
    const pedido = await processo({
      chave: 'pedido',
      fase: 'apreciacao',
      criado: d(40),
      tecnico: TEC_B,
      prazo_fim: d(5),
      fases: [[d(1), 'entrada', 'apreciacao']],
    });
    await processo({
      chave: 'urgente',
      fase: 'apreciacao',
      criado: hoje,
      tecnico: TEC_A,
      fases: [[hoje, 'entrada', 'apreciacao']],
    });
    await processo({ chave: 'semtec', fase: 'entrada', criado: hoje });

    // Pedido de documentos por responder: a vez é do munícipe.
    const [ev] = await linhas<{ id: string }>(
      ctx.db,
      `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo, em)
       VALUES ($1, 'documento_pedido', 'Pedida a certidão.', 'utilizador', $2) RETURNING id`,
      [pedido, em(hoje)],
    );
    await ctx.db.query(
      `INSERT INTO processo_pedidos (processo_id, evento_id, descricao, prazo, pedido_em)
       VALUES ($1, $2, 'Certidão do registo predial', $3, $4)`,
      [pedido, ev.id, somarDias(hoje, 10), em(hoje)],
    );

    // Passagem em curso da Ana e uma ocorrência aberta das Vias.
    const [conv] = await linhas<{ id: string }>(
      ctx.db,
      `INSERT INTO conversas (municipio_id, canal) VALUES ($1, 'telefone') RETURNING id`,
      [M],
    );
    await ctx.db.query(
      `INSERT INTO passagens_humano (conversa_id, motivo, resumo, fora_de_horas, atribuida_a, estado)
       VALUES ($1, 'processo', 'Quer saber do processo.', false, $2, 'em_curso')`,
      [conv.id, TEC_A],
    );
    const [cat] = await linhas<{ id: string }>(
      ctx.db,
      `INSERT INTO categorias_ocorrencia (municipio_id, nome, servico_id)
       VALUES ($1, 'Buraco', $2) RETURNING id`,
      [M, S_VIAS],
    );
    await ctx.db.query(
      `INSERT INTO ocorrencias (municipio_id, numero, categoria_id, descricao, morada, servico_id)
       VALUES ($1, 'GE-0001', $2, 'Buraco', 'Rua A', $3)`,
      [M, cat.id, S_VIAS],
    );

    // O job refresca a cada 5 min; aqui refresca-se já.
    await ctx.db.query('REFRESH MATERIALIZED VIEW mv_processos_fases_historia');

    feriados = new Set(
      (
        await linhas<{ dia: string }>(
          ctx.db,
          `SELECT to_char(data, 'YYYY-MM-DD') AS dia FROM feriados
           WHERE municipio_id IS NULL OR municipio_id = $1`,
          [M],
        )
      ).map((f) => f.dia),
    );
    for (let i = 0; i < 6; i++) {
      const aprec = somarDias(d(50 + i), 1);
      apreciacao[i] = diasUteisEntre(
        aprec,
        somarDias(aprec, 10 + i * 2),
        feriados,
      );
    }

    chefe = await entrarPainel(ctx, CHEFE);
  });

  afterAll(() => ctx.fechar());

  const get = (url: string, h = chefe) =>
    ctx.http().get(`/v1/painel/gestao/${url}`).set(h);

  it("perfil sem 'indicadores' (atendimento) → 403", async () => {
    const h = await entrarPainel(ctx, ATENDIMENTO);
    const r = await get('carga', h).expect(403);
    expect(r.body.erro.codigo).toBe('sem_permissao');
  });

  it('carga por serviço e por técnico, ordenada pela carga ponderada', async () => {
    const r = await get('carga').expect(200);
    const b = r.body;
    expect(b.hoje).toBe(hoje);
    expect(b.a_terminar_ate).toBe(somarDiasUteis(hoje, 3, feriados));
    expect(b.formula).toContain('carga =');

    // Só os serviços deste município, a maior carga primeiro.
    expect(b.servicos.map((s: any) => s.servico)).toEqual([
      'Obras particulares',
      'Vias',
    ]);
    expect(b.servicos[0]).toMatchObject({
      servico_id: S_OBRAS,
      abertos: 5,
      por_fase: { entrada: 1, documentos: 1, apreciacao: 3, decisao: 0 },
      atrasados: 2,
      a_terminar: 0,
      aguarda_municipe: 2,
      passagens_em_curso: 1,
      ocorrencias_abertas: 0,
      carga: 8, // 5 + 2×2 − 0,75×2 + 0,5
    });
    expect(b.servicos[1]).toMatchObject({
      servico_id: S_VIAS,
      abertos: 0,
      ocorrencias_abertas: 1,
      carga: 0.5,
    });

    expect(b.tecnicos.map((t: any) => [t.tecnico, t.abertos, t.carga])).toEqual(
      [
        ['Ana GE', 2, 4.5], // 2 + 2 (atrasado) + 0,5 (passagem)
        ['Bruno GE', 2, 2.5], // 2 + 2 − 0,75×2
        ['Sem técnico', 1, 1],
        ['Carla GE', 0, 0],
      ],
    );
    expect(b.tecnicos[0]).toMatchObject({
      tecnico_id: TEC_A,
      servico: 'Obras particulares',
      atrasados: 1,
      passagens_em_curso: 1,
    });
    expect(b.tecnicos[0]).not.toHaveProperty('ocorrencias_abertas');
    expect(b.totais).toMatchObject({ abertos: 5, ocorrencias_abertas: 1 });
  });

  it('a terminar em ≤ 3 dias úteis conta (e pesa) à parte dos atrasados', async () => {
    await ctx.db.query('UPDATE processos SET prazo_fim = $2 WHERE id = $1', [
      ids.urgente,
      somarDiasUteis(hoje, 2, feriados),
    ]);
    const b = (await get('carga').expect(200)).body;
    expect(b.servicos[0]).toMatchObject({ a_terminar: 1, carga: 9 });
    expect(b.tecnicos[0]).toMatchObject({
      tecnico: 'Ana GE',
      a_terminar: 1,
      carga: 5.5,
    });
  });

  it('tempos por tipo e por fase (período pela data da decisão)', async () => {
    const r = await get(`tempos?de=${somarDias(hoje, -60)}&ate=${hoje}`).expect(
      200,
    );
    const b = r.body;
    expect(b.periodo).toEqual({ de: somarDias(hoje, -60), ate: hoje });
    expect(b.tipos).toHaveLength(1);
    const t = b.tipos[0];
    expect(t).toMatchObject({
      tipo_id: TIPO,
      codigo: 'GE',
      prazo_legal_dias_uteis: 20,
      decididos: 7,
      com_historia_de_fases: 6,
      sem_historia_de_fases: 1,
      com_prazo: 6,
      dentro_do_prazo_pct: 50,
    });
    const fases = Object.fromEntries(t.fases.map((f: any) => [f.fase, f]));
    const mediaEsperada =
      Math.round(
        (apreciacao.reduce((s, x) => s + x, 0) / apreciacao.length) * 10,
      ) / 10;
    expect(fases.apreciacao).toMatchObject({
      processos: 6,
      media_dias_uteis: mediaEsperada,
    });
    expect(fases.entrada.processos).toBe(6);
    expect(fases.decisao.processos).toBe(6);
    expect(fases.documentos).toMatchObject({
      processos: 0,
      media_dias_uteis: null,
    });
    expect(b.total.decididos).toBe(7);
    expect(b.notas.length).toBeGreaterThan(0);

    // Sem `de`: os últimos 90 dias. Período ao contrário: 400.
    const omissao = (await get('tempos').expect(200)).body;
    expect(omissao.periodo).toEqual({ de: somarDias(hoje, -89), ate: hoje });
    const e = await get(`tempos?de=${hoje}&ate=${somarDias(hoje, -1)}`).expect(
      400,
    );
    expect(e.body.erro.codigo).toBe('periodo_invalido');
  });

  it('onde param: acima do normal ou sem eventos, os mais parados e o gargalo', async () => {
    const b = (await get('onde-param').expect(200)).body;
    expect(b.regra).toMatchObject({ percentil: 75, dias_sem_eventos: 10 });
    expect(b.total_em_curso).toBe(5);

    const porNumero = Object.fromEntries(
      b.mais_parados.map((p: any) => [p.numero, p]),
    );
    expect(Object.keys(porNumero).sort()).toEqual([
      'GE espera/2026',
      'GE parado/2026',
    ]);
    const diasParado = diasUteisEntre(somarDias(hoje, -60), hoje, feriados);
    expect(b.mais_parados[0]).toMatchObject({
      id: ids.parado,
      fase: 'apreciacao',
      dias_parado: diasParado,
      dias_sem_eventos: diasParado,
      normal_base: 'tipo',
      motivos: ['acima_do_normal', 'sem_eventos'],
      vez: 'camara',
      tecnico_id: TEC_A,
      tecnico: 'Ana GE',
      ultimo_evento: { tipo: 'fase' },
    });
    // Documentos: sem histórico desta fase, só conta a regra dos eventos.
    expect(porNumero['GE espera/2026']).toMatchObject({
      fase: 'documentos',
      normal_dias_uteis: null,
      motivos: ['sem_eventos'],
      vez: 'municipe',
      ultimo_evento: { tipo: 'criado' },
    });

    const fases = Object.fromEntries(b.fases.map((f: any) => [f.fase, f]));
    expect(fases.apreciacao).toMatchObject({ em_curso: 3, parados: 1 });
    expect(fases.documentos).toMatchObject({ em_curso: 1, parados: 1 });
    expect(fases.entrada).toMatchObject({ em_curso: 1, parados: 0 });
    expect(b.gargalo).toMatchObject({
      fase: 'apreciacao',
      parados: 1,
      dias_parados: diasParado,
    });
  });

  it('atrasados: paginados, o mais atrasado primeiro, e de quem é a vez', async () => {
    const p1 = (await get('atrasados?limite=1').expect(200)).body;
    expect(p1.itens).toHaveLength(1);
    expect(p1.itens[0]).toMatchObject({
      id: ids.parado,
      prazo_fim: somarDias(hoje, -10),
      dias_atraso: diasUteisEntre(somarDias(hoje, -10), hoje, feriados),
      dias_atraso_corridos: 10,
      vez: 'camara',
      pedido_por_responder: null,
      tecnico: 'Ana GE',
    });
    expect(p1.proximo_cursor).toBeTruthy();

    const p2 = (
      await get(`atrasados?limite=1&cursor=${p1.proximo_cursor}`).expect(200)
    ).body;
    expect(p2.itens).toHaveLength(1);
    expect(p2.itens[0]).toMatchObject({
      id: ids.pedido,
      vez: 'municipe',
      pedido_por_responder: { descricao: 'Certidão do registo predial' },
    });
    expect(p2.proximo_cursor).toBeNull();

    // Filtros.
    const b = (await get(`atrasados?tecnico_id=${TEC_B}`).expect(200)).body;
    expect(b.itens.map((i: any) => i.id)).toEqual([ids.pedido]);
    const v = (await get(`atrasados?servico_id=${S_VIAS}`).expect(200)).body;
    expect(v.itens).toEqual([]);
    await get('atrasados?tecnico_id=nao-e-id').expect(400);
  });
});
