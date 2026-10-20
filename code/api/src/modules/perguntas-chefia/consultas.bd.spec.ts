/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import type { ConfigService } from '@nestjs/config';
import { Client } from 'pg';
import type { UtilizadorPainel } from '../../common/pedido.js';
import type { DatabaseService, Tx } from '../../database/database.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { MelhoriasService } from '../conhecimento/melhorias.service.js';
import type {
  Municipio,
  MunicipiosService,
} from '../municipios/municipios.service.js';
import { hojeNoFuso, somarDias } from '../painel/periodos.js';
import { CONSULTAS } from './catalogo.js';
import type { ResultadoConsulta } from './consulta.js';
import { resultados, simulado, usar } from './modelo-simulado.js';
import { PerguntasChefiaService } from './perguntas-chefia.service.js';

/*
 * Todas as consultas contra o Postgres, com dados falsos de dois municípios
 * (o segundo não pode aparecer nunca), numa transação desfeita no fim. Só
 * corre com TESTE_BD=1 (BD já com todas as migrações):
 *
 *   TESTE_BD=1 DB_NAME=toucamara_chefia npx jest src/modules/perguntas-chefia/consultas.bd.spec.ts
 *
 * Com EXPLICAR=1 escreve o plano (EXPLAIN ANALYZE) de cada SELECT.
 */
const correr = process.env.TESTE_BD === '1' ? describe : describe.skip;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = id(1);
const B = id(2);
const ANA = id(11);
const RUI = id(12);
const CHEFE = id(13);
const ANA_B = id(14);
const CP = id(21);
const LO = id(22);
const OV = id(23);
const CP_B = id(24);
const P1 = id(31);
const P2 = id(32);
const P3 = id(33);
const P5 = id(35);
const BURACO = id(41);
const LUZ = id(42);
const BURACO_B = id(43);
const O1 = id(51);
const O2 = id(52);
const OB1 = id(56);
const OBRAS = id(61);
const AGUA = id(62);
const MUNICIPE = id(71);
const MUNICIPE_B = id(72);
const CONVERSA1 = id(81);
const AGENDA = id(91);

const FUSO = 'Europe/Lisbon';

correr('consultas da chefia (BD)', () => {
  let client: Client;
  let db: DatabaseService;
  let svc: PerguntasChefiaService;
  const H = hojeNoFuso(FUSO);
  const m: Municipio = {
    id: A,
    slug: 'chefia-a',
    nome: 'Vila Teste',
    fuso: FUSO,
  };
  const feriados = new Set<string>();
  const planos: string[] = [];

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

    const query = async (sql: string, p?: unknown[]) => {
      if (process.env.EXPLICAR === '1' && /^\s*SELECT/i.test(sql)) {
        const plano = await client.query(
          `EXPLAIN (ANALYZE, COSTS OFF, TIMING ON, SUMMARY ON) ${sql}`,
          p,
        );
        const linhas = plano.rows.map((r) => r['QUERY PLAN'] as string);
        planos.push(
          `${sql.replace(/\s+/g, ' ').slice(0, 90)}…\n  ${linhas[0]}\n  ${linhas[linhas.length - 1]}`,
        );
      }
      return (await client.query(sql, p)).rows;
    };
    let n = 0;
    db = {
      query,
      transaction: async <T>(fn: (t: Tx) => Promise<T>) => {
        const sp = `sp${++n}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          const r = await fn({ query });
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          return r;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          throw e;
        }
      },
    } as unknown as DatabaseService;

    await semear(query, H);

    const municipios = {
      feriados: () => Promise.resolve(feriados),
    } as unknown as MunicipiosService;
    const config = {
      getOrThrow: () => ({ apiKey: '', modelo: 'claude-sonnet-5-5' }),
    } as unknown as ConfigService;
    const melhorias = new MelhoriasService(
      db,
      null as never,
      null as never,
      null as never,
      new AuditoriaService(db),
      null as never,
    );
    svc = new PerguntasChefiaService(
      config,
      db,
      municipios,
      new AuditoriaService(db),
      melhorias,
    );
  });

  afterAll(async () => {
    if (planos.length) console.log(planos.join('\n'));
    await client?.query('ROLLBACK');
    await client?.end();
  });

  const correrConsulta = (nome: string, entrada: Record<string, unknown>) =>
    svc.executar(m, H, feriados, nome, completar(nome, entrada));

  // ------------------------------------------------------------------
  // Processos
  // ------------------------------------------------------------------

  it('contar_processos: obras atrasados = CP + LO, sem o outro município', async () => {
    const r = await correrConsulta('contar_processos', {
      tipo: 'obras',
      atrasados: true,
    });
    expect(r.valores.total).toBe(2);
    expect(r.filtros?.tipos).toEqual([
      'CP · Comunicação prévia · obras de alteração',
      'LO · Licença de obras',
    ]);
  });

  it('contar_processos: em curso por omissão, agrupado por técnico', async () => {
    const r = await correrConsulta('contar_processos', {
      agrupar_por: 'tecnico',
    });
    expect(r.valores).toEqual({ total: 5, atrasados: 2 });
    expect(r.linhas).toEqual([
      { grupo: 'Ana Costa', total: 2, atrasados: 1 },
      { grupo: 'Rui Martins', total: 2, atrasados: 1 },
      { grupo: 'Sem técnico', total: 1, atrasados: 0 },
    ]);
  });

  it('contar_processos: à espera do munícipe, a terminar, decisão, zona e fase', async () => {
    const v = async (e: Record<string, unknown>) =>
      (await correrConsulta('contar_processos', e)).valores.total;
    expect(await v({ aguarda_municipe: true })).toBe(2);
    expect(await v({ a_terminar_dias_uteis: 5 })).toBe(1);
    expect(await v({ decisao: 'admitido' })).toBe(1);
    expect(await v({ zona: 'sao pedro' })).toBe(1);
    expect(await v({ fase: 'notificado' })).toBe(1);
    expect(await v({ tecnico: 'ana' })).toBe(2);
    expect(await v({ sem_tecnico: true })).toBe(1);
    expect(await v({ incluir_fechados: true })).toBe(7);
    expect(await v({ de: somarDias(H, -45), ate: H })).toBe(5);
    expect(await v({ data: 'decisao', de: somarDias(H, -40), ate: H })).toBe(1);
    const r = await correrConsulta('contar_processos', {
      agrupar_por: 'fase',
    });
    expect(r.linhas?.map((l) => l.grupo)).toEqual(
      expect.arrayContaining([
        'Apreciação',
        'Documentos',
        'Decisão',
        'Entrada',
      ]),
    );
  });

  it('contar_processos: tipo que não existe devolve os válidos', async () => {
    await expect(
      correrConsulta('contar_processos', { tipo: 'piscinas' }),
    ).rejects.toMatchObject({
      codigo: 'tipo_desconhecido',
      detalhes: {
        validos: expect.arrayContaining(['OV · Ocupação da via pública']),
      },
    });
  });

  it('listar_processos: atrasados pelo prazo, com ids e dias úteis', async () => {
    const r = await correrConsulta('listar_processos', { atrasados: true });
    expect(r.total_linhas).toBe(2);
    expect(r.objeto).toBe('processo');
    expect(r.linhas?.map((l) => l.id)).toEqual([P1, P3]);
    expect(r.linhas?.[0]).toMatchObject({
      numero: 'CP 1/2026',
      fase: 'Apreciação',
      tecnico: 'Ana Costa',
      atrasado: true,
    });
    expect(r.linhas?.[0].dias_uteis_restantes).toBeLessThan(0);
    const limitado = await correrConsulta('listar_processos', { limite: 1 });
    expect(limitado.linhas).toHaveLength(1);
    expect(limitado.total_linhas).toBe(5);
  });

  it('tempos_processos: média até à decisão e % dentro do prazo', async () => {
    const r = await correrConsulta('tempos_processos', {
      tipo: 'comunicação prévia',
    });
    expect(r.valores).toMatchObject({
      decididos: 2,
      media_dias_corridos: 40,
      dentro_do_prazo_pct: 50,
      prazo_legal_dias_uteis: 20,
      em_curso: 2,
    });
    expect(r.valores.media_dias_uteis).toBeGreaterThan(20);
    expect(r.valores.media_dias_uteis).toBeLessThan(32);
  });

  it('carga_tecnicos: por técnico, com "Sem técnico"', async () => {
    const r = await correrConsulta('carga_tecnicos', {});
    expect(r.valores).toEqual({
      tecnicos: 2,
      em_curso: 5,
      atrasados: 2,
      a_terminar: 1,
    });
    expect(r.linhas?.[0]).toEqual({
      tecnico: 'Ana Costa',
      em_curso: 2,
      atrasados: 1,
      a_terminar: 1,
      aguarda_municipe: 1,
    });
  });

  // ------------------------------------------------------------------
  // Atendimento (vistas do painel)
  // ------------------------------------------------------------------

  it('conversas: últimos 7 dias, por canal e só chamadas', async () => {
    const r = await correrConsulta('conversas', {
      de: somarDias(H, -6),
      ate: H,
      agrupar_por: 'canal',
    });
    expect(r.valores).toMatchObject({
      conversas: 4,
      chamadas: 3,
      escritas: 1,
      fora_de_horas: 2,
      passadas: 1,
      sem_resposta: 1,
      resolvidas_sem_humano: 2,
      resolvidas_sem_humano_pct: 50,
    });
    expect(r.linhas).toHaveLength(2);
    const chamadas = await correrConsulta('conversas', {
      canal: 'telefone',
      agrupar_por: 'dia',
    });
    expect(chamadas.valores).toMatchObject({ conversas: 3, fora_de_horas: 2 });
    expect(chamadas.linhas).toHaveLength(7);
  });

  it('temas_mais_perguntados: com variação e filtro por tema', async () => {
    const r = await correrConsulta('temas_mais_perguntados', {});
    expect(r.linhas?.[0]).toEqual({
      tema: 'Obras dentro de casa',
      total: 2,
      percentagem: 66.7,
      anterior: 1,
      variacao: 100,
    });
    const agua = await correrConsulta('temas_mais_perguntados', {
      tema: 'água',
    });
    expect(agua.valores.conversas).toBe(1);
  });

  it('perguntas_sem_resposta, sms_enviados, melhorias_portal', async () => {
    const psr = await correrConsulta('perguntas_sem_resposta', {});
    expect(psr.valores).toEqual({ perguntas: 1, vezes: 5 });
    const sms = await correrConsulta('sms_enviados', {});
    expect(sms.valores).toEqual({
      enviados: 1,
      entregues: 1,
      segmentos: 2,
      custo_eur: 0.08,
      falhados: 1,
    });
    const mel = await correrConsulta('melhorias_portal', {});
    expect(mel.valores).toMatchObject({ propostas: 1, publicadas: 1 });
    expect(mel.linhas?.[0]).toMatchObject({ vezes: expect.any(Number) });
  });

  it('indicadores_periodo: o resumo da Visão geral', async () => {
    const r = await correrConsulta('indicadores_periodo', {});
    expect(r.valores).toMatchObject({
      conversas: 4,
      chamadas: 3,
      processos_em_curso_agora: 5,
      processos_atrasados_agora: 2,
      ocorrencias_abertas_agora: 3,
      pagamentos_pagos: 1,
      pagos_eur: 25,
      sms_enviados: 1,
    });
    expect(r.unidades?.resolvidas_sem_humano_pct_variacao).toBe(
      'pontos percentuais',
    );
  });

  // ------------------------------------------------------------------
  // Operação
  // ------------------------------------------------------------------

  it('contar_ocorrencias: buracos abertos, duplicados no original, zona', async () => {
    const r = await correrConsulta('contar_ocorrencias', {
      categoria: 'buracos',
    });
    expect(r.valores).toMatchObject({
      total: 2,
      abertas: 2,
      avisos_repetidos: 1,
    });
    const zona = await correrConsulta('contar_ocorrencias', {
      categoria: 'buracos',
      zona: 'Sao Pedro',
    });
    expect(zona.valores.total).toBe(1);
    const todas = await correrConsulta('contar_ocorrencias', {
      categoria: 'buraco',
      estado: 'todas',
      agrupar_por: 'estado',
    });
    expect(todas.valores).toMatchObject({
      total: 3,
      resolvidas: 1,
      tempo_medio_resolucao_h: 48,
      tempo_medio_resolucao_dias: 2,
    });
    expect(todas.linhas?.map((l) => l.grupo).sort()).toEqual([
      'Com a equipa',
      'Nova',
      'Resolvida',
    ]);
  });

  it('listar_ocorrencias: ids para o painel', async () => {
    const r = await correrConsulta('listar_ocorrencias', {
      categoria: 'buracos',
    });
    expect(r.objeto).toBe('ocorrencia');
    expect(r.linhas?.map((l) => l.id)).toEqual([O1, O2]);
    expect(r.linhas?.[0]).toMatchObject({ avisos: 1, estado: 'Nova' });
  });

  it('pagamentos (modo de teste avisado) e marcações', async () => {
    const p = await correrConsulta('pagamentos', {});
    expect(p.valores).toMatchObject({
      pagos: 1,
      pagos_eur: 25,
      emitidos: 3,
      por_pagar_agora: 2,
      por_pagar_agora_eur: 15,
      por_pagar_fora_prazo: 1,
      modo_teste: true,
    });
    expect(p.notas?.[0]).toMatch(/modo de teste/);
    const mb = await correrConsulta('pagamentos', { metodo: 'mbway' });
    expect(mb.valores.por_pagar_agora).toBe(1);

    const mc = await correrConsulta('marcacoes', {});
    expect(mc.valores).toMatchObject({
      total: 1,
      realizadas: 1,
      pelo_agente: 1,
    });
    const futuras = await correrConsulta('marcacoes', {
      de: H,
      ate: somarDias(H, 7),
      agenda: 'licenciamento',
    });
    expect(futuras.valores.marcadas).toBe(1);
  });

  // ------------------------------------------------------------------
  // Segurança
  // ------------------------------------------------------------------

  it('nenhuma consulta devolve dados do outro município', async () => {
    const tudo: ResultadoConsulta[] = [];
    for (const c of CONSULTAS) {
      tudo.push(await correrConsulta(c.nome, {}));
    }
    const json = JSON.stringify(tudo);
    for (const proibido of [OB1, 'Ana Costa B', '99999', 'Município B']) {
      expect(json).not.toContain(proibido);
    }
    // O mesmo pedido no município B só vê os dados de B.
    const b = await svc.executar(
      { ...m, id: B },
      H,
      feriados,
      'contar_processos',
      completar('contar_processos', { atrasados: true }),
    );
    expect(b.valores.total).toBe(1);
  });

  it('as consultas correm numa transação só de leitura', async () => {
    await client.query('SAVEPOINT ro');
    await client.query('SET TRANSACTION READ ONLY');
    await expect(
      client.query(`UPDATE processos SET assunto = 'x' WHERE id = $1`, [P1]),
    ).rejects.toThrow(/read-only/);
    await client.query('ROLLBACK TO SAVEPOINT ro');
  });

  // ------------------------------------------------------------------
  // De ponta a ponta, com o modelo simulado
  // ------------------------------------------------------------------

  it('pergunta → contar_processos → resposta com o número real, histórico e auditoria', async () => {
    const u: UtilizadorPainel = {
      id: CHEFE,
      nome: 'Chefe',
      email: 'chefe@teste.pt',
      perfil: 'chefe_divisao',
      municipioId: A,
      servicoId: null,
    };
    const modelo = simulado([
      {
        blocos: [
          usar('t1', 'contar_processos', {
            ...completar('contar_processos', {}),
            tipo: 'obras',
            atrasados: true,
          }),
        ],
        stop: 'tool_use',
      },
      {
        blocos: [
          usar('t2', 'responder', {
            resposta: 'Há {1} processos de obras atrasados.',
            numeros_chave: [
              {
                rotulo: 'Atrasados',
                consulta: 'c1',
                campo: 'total',
                linha: null,
              },
            ],
            tabela: null,
            sugestoes: ['Quais são?'],
            sem_dados: false,
          }),
        ],
        stop: 'tool_use',
      },
    ]);
    svc.abrirFluxo = modelo.abrir;
    const eventos: string[] = [];
    const r = await svc.perguntar(
      m,
      u,
      'Quantos processos de obras estão atrasados?',
      { emitir: (e) => eventos.push(e.tipo), ip: '127.0.0.1' },
    );
    expect(r.resposta).toBe('Há 2 processos de obras atrasados.');
    expect(r.numeros_chave).toEqual([
      { rotulo: 'Atrasados', valor: 2, unidade: 'processos', consulta: 'c1' },
    ]);
    expect(r.consultas).toEqual([
      expect.objectContaining({
        id: 'c1',
        ferramenta: 'contar_processos',
        linhas_devolvidas: 1,
        erro: null,
      }),
    ]);
    expect(r.fim).toBe('concluido');
    expect(eventos).toEqual(['consulta_inicio', 'consulta_fim']);
    // O modelo recebeu o resultado guardado (c1, total 2).
    const res = resultados(modelo.pedidos[1])[0];
    expect(JSON.parse(res.content as string)).toMatchObject({
      consulta: 'c1',
      valores: { total: 2 },
    });

    const h = await svc.historico(m, u, {});
    expect(h.itens[0]).toMatchObject({
      id: r.id,
      pergunta: 'Quantos processos de obras estão atrasados?',
      resposta: 'Há 2 processos de obras atrasados.',
      fim: 'concluido',
    });
    const linhas = (
      await client.query(
        `SELECT acao, dados->>'fim' AS fim FROM audit_log WHERE objeto_id = $1`,
        [r.id],
      )
    ).rows;
    expect(linhas).toEqual([{ acao: 'perguntar', fim: 'concluido' }]);
  });
});

/** Os parâmetros todos (null por omissão), como a API manda com strict. */
function completar(nome: string, e: Record<string, unknown>) {
  const c = CONSULTAS.find((x) => x.nome === nome)!;
  return {
    ...Object.fromEntries(Object.keys(c.entrada.shape).map((k) => [k, null])),
    ...e,
  };
}

type Q = (sql: string, p?: unknown[]) => Promise<any[]>;

/** Dois municípios; o B tem dados "iscos" que nunca podem aparecer no A. */
async function semear(q: Q, H: string) {
  const d = (n: number) => somarDias(H, n);
  await q(
    `INSERT INTO municipios (id, slug, nome) VALUES ($1, 'chefia-a', 'Vila Teste'), ($2, 'chefia-b', 'Município B')`,
    [A, B],
  );
  const [ea] = await q(
    `INSERT INTO entidades (municipio_id, nome, tipo) VALUES ($1, 'Câmara', 'camara') RETURNING id`,
    [A],
  );
  const [sa] = await q(
    `INSERT INTO servicos (municipio_id, entidade_id, nome) VALUES ($1, $2, 'Obras particulares') RETURNING id`,
    [A, ea.id],
  );
  await q(
    `INSERT INTO utilizadores (id, municipio_id, email, nome, perfil) VALUES
      ($1, $5, 'ana@a.pt', 'Ana Costa', 'tecnico'),
      ($2, $5, 'rui@a.pt', 'Rui Martins', 'tecnico'),
      ($3, $5, 'chefe@a.pt', 'Chefe', 'chefe_divisao'),
      ($4, $6, 'ana@b.pt', 'Ana Costa B', 'tecnico')`,
    [ANA, RUI, CHEFE, ANA_B, A, B],
  );
  await q(
    `INSERT INTO tipos_processo (id, municipio_id, codigo, nome, prazo_dias_uteis, formulario) VALUES
      ($1, $5, 'CP', 'Comunicação prévia · obras de alteração', 20, '[]'),
      ($2, $5, 'LO', 'Licença de obras', 45, '[]'),
      ($3, $5, 'OV', 'Ocupação da via pública', 10, '[]'),
      ($4, $6, 'CP', 'Comunicação prévia · obras de alteração', 20, '[]')`,
    [CP, LO, OV, CP_B, A, B],
  );
  // p1 atrasado (Ana) · p2 documentos, prazo daqui a 3 dias (Ana) · p3 atrasado
  // (Rui) · p4 sem técnico · p5 entrada com pedido por responder (Rui) ·
  // p6 notificado admitido dentro do prazo · p7 arquivado indeferido fora do
  // prazo · pb1 atrasado no município B.
  await q(
    `INSERT INTO processos (id, municipio_id, numero, tipo_processo_id, assunto, morada, freguesia, fase,
                            tecnico_id, prazo_fim, decisao, decidido_em, criado_em) VALUES
      ($1, $9, 'CP 1/2026', $11, 'Porta na cozinha', 'Rua Direita 1', 'São Pedro', 'apreciacao', $13, $15::date, NULL, NULL, now() - interval '40 days'),
      ($2, $9, 'CP 2/2026', $11, 'Janelas', 'Rua A', 'Azurém', 'documentos', $13, $16::date, NULL, NULL, now()),
      ($3, $9, 'LO 1/2026', $12, 'Moradia', 'Rua B', 'Azurém', 'decisao', $14, $17::date, NULL, NULL, now()),
      ($4, $9, 'LO 2/2026', $12, 'Anexo', 'Rua C', 'Creixomil', 'apreciacao', NULL, $18::date, NULL, NULL, now()),
      ($5, $9, 'OV 1/2026', $19, 'Andaime', 'Rua D', 'Creixomil', 'entrada', $14, NULL, NULL, NULL, now()),
      ($6, $9, 'CP 3/2026', $11, 'Muro', 'Rua E', 'Azurém', 'notificado', $13, $20::date, 'admitido', now() - interval '30 days', now() - interval '60 days'),
      ($7, $9, 'CP 4/2026', $11, 'Telhado', 'Rua F', 'Azurém', 'arquivado', NULL, $21::date, 'indeferido', now() - interval '50 days', now() - interval '100 days'),
      ($8, $10, 'CP 1/2026', $22, 'Isco B', 'Rua Isco', 'São Pedro', 'apreciacao', $23, $15::date, NULL, NULL, now())`,
    [
      P1,
      P2,
      P3,
      id(34),
      P5,
      id(36),
      id(37),
      id(38),
      A,
      B,
      CP,
      LO,
      ANA,
      RUI,
      d(-5),
      d(3),
      d(-1),
      d(30),
      OV,
      d(-20),
      d(-60),
      CP_B,
      ANA_B,
    ],
  );
  const [ev] = await q(
    `INSERT INTO processo_eventos (processo_id, tipo, descricao, ator_tipo)
     VALUES ($1, 'documento_pedido', 'Planta', 'utilizador') RETURNING id`,
    [P5],
  );
  await q(
    `INSERT INTO processo_pedidos (processo_id, evento_id, descricao, prazo) VALUES ($1, $2, 'Planta', $3::date)`,
    [P5, ev.id, d(5)],
  );

  // Ocorrências: o1 nova (com um aviso repetido o3) · o2 com a equipa ·
  // o4 resolvida em 48 h · o5 iluminação · ob1 no município B.
  await q(
    `INSERT INTO categorias_ocorrencia (id, municipio_id, nome) VALUES
      ($1, $4, 'Buraco na via'), ($2, $4, 'Iluminação pública'), ($3, $5, 'Buraco na via')`,
    [BURACO, LUZ, BURACO_B, A, B],
  );
  await q(
    `INSERT INTO ocorrencias (id, municipio_id, numero, categoria_id, descricao, morada, estado, duplicada_de, criada_em, resolvida_em) VALUES
      ($1, $7, 'OC-1', $9, 'Buraco', 'Rua Direita 45, São Pedro', 'nova', NULL, now() - interval '2 days', NULL),
      ($2, $7, 'OC-2', $9, 'Buraco', 'Avenida X, Azurém', 'com_equipa', NULL, now() - interval '10 days', NULL),
      ($3, $7, 'OC-3', $9, 'Buraco', 'Rua Direita 47, São Pedro', 'duplicada', $1, now() - interval '1 day', NULL),
      ($4, $7, 'OC-4', $9, 'Buraco', 'Rua Z', 'resolvida', NULL, now() - interval '20 days', now() - interval '18 days'),
      ($5, $7, 'OC-5', $10, 'Candeeiro', 'Rua Y, São Pedro', 'nova', NULL, now() - interval '1 day', NULL),
      ($6, $8, 'OC-1', $11, 'Isco', 'Rua Isco', 'nova', NULL, now() - interval '1 day', NULL)`,
    [O1, O2, id(53), id(54), id(55), OB1, A, B, BURACO, LUZ, BURACO_B],
  );

  // Conversas: 4 nos últimos 7 dias (3 chamadas, 2 fora de horas) + 1 na
  // semana anterior; uma no B.
  await q(
    `INSERT INTO temas (id, municipio_id, nome) VALUES ($1, $3, 'Obras dentro de casa'), ($2, $3, 'Água e saneamento')`,
    [OBRAS, AGUA, A],
  );
  await q(
    `INSERT INTO conversas (id, municipio_id, canal, resultado, fora_de_horas, tema_id, duracao_s, iniciada_em) VALUES
      ($1, $2, 'telefone', 'resolvida', true, $4, 120, now() - interval '1 day'),
      (gen_random_uuid(), $2, 'telefone', 'passada_funcionario', false, $4, 300, now() - interval '2 days'),
      (gen_random_uuid(), $2, 'chat', 'resolvida', false, $5, NULL, now() - interval '2 days'),
      (gen_random_uuid(), $2, 'telefone', 'sem_resposta', true, NULL, 60, now() - interval '3 days'),
      (gen_random_uuid(), $2, 'telefone', 'resolvida', false, $4, 100, now() - interval '10 days'),
      (gen_random_uuid(), $3, 'telefone', 'resolvida', true, NULL, 100, now() - interval '1 day')`,
    [CONVERSA1, A, B, OBRAS, AGUA],
  );

  const [psr1] = await q(
    `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes, estado) VALUES
      ($1, 'Horário do ecocentro ao domingo', 5, 'nova') RETURNING id`,
    [A],
  );
  const [psr2] = await q(
    `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes, estado) VALUES
      ($1, 'Onde pago a água', 2, 'resolvida') RETURNING id`,
    [A],
  );
  await q(
    `INSERT INTO perguntas_sem_resposta (municipio_id, texto, vezes, estado) VALUES ($1, 'Isco B', 9, 'nova')`,
    [B],
  );
  const [m1] = await q(
    `INSERT INTO melhorias_portal (municipio_id, titulo, o_que_falta, sugestao) VALUES
      ($1, 'Horário do ecocentro', 'Horário', 'Texto') RETURNING id`,
    [A],
  );
  const [m2] = await q(
    `INSERT INTO melhorias_portal (municipio_id, titulo, o_que_falta, sugestao, estado, publicada_em) VALUES
      ($1, 'Pagar a água', 'Onde', 'Texto', 'publicada', now() - interval '1 day') RETURNING id`,
    [A],
  );
  await q(
    `INSERT INTO melhoria_perguntas (melhoria_id, psr_id) VALUES ($1, $2), ($3, $4)`,
    [m1.id, psr1.id, m2.id, psr2.id],
  );

  // Pagamentos (modo de teste): 1 pago (25 €), 2 pendentes (10 € fora de prazo, 5 €); 1 no B.
  await q(
    `INSERT INTO pagamentos (municipio_id, processo_id, valor_cent, detalhe, metodo, estado, pago_em, pagar_ate) VALUES
      ($1, $3, 2500, '[]', 'multibanco', 'pago', now() - interval '1 day', NULL),
      ($1, $3, 1000, '[]', 'mbway', 'pendente', NULL, $4::date),
      ($1, $3, 500, '[]', NULL, 'pendente', NULL, $5::date),
      ($2, $6, 9999900, '[]', 'multibanco', 'pago', now() - interval '1 day', NULL)`,
    [A, B, P1, d(-1), d(5), id(38)],
  );

  // Marcações: uma realizada há 2 dias (pelo agente), uma amanhã.
  await q(
    `INSERT INTO municipes (id, municipio_id, nome) VALUES ($1, $3, 'Maria'), ($2, $4, 'Isco')`,
    [MUNICIPE, MUNICIPE_B, A, B],
  );
  await q(
    `INSERT INTO agendas (id, municipio_id, servico_id, nome, horario) VALUES
      ($1, $2, $3, 'Balcão Único · Licenciamento', '{}')`,
    [AGENDA, A, sa.id],
  );
  await q(
    `INSERT INTO marcacoes (agenda_id, municipe_id, conversa_id, periodo, estado) VALUES
      ($1, $2, $3, tstzrange(now() - interval '2 days', now() - interval '2 days' + interval '30 minutes'), 'realizada'),
      ($1, $2, NULL, tstzrange(now() + interval '1 day', now() + interval '1 day' + interval '30 minutes'), 'marcada')`,
    [AGENDA, MUNICIPE, CONVERSA1],
  );

  // SMS: 1 enviado e entregue (2 segmentos, 8 cêntimos), 1 falhado; 1 no B.
  await q(
    `INSERT INTO mensagens_saida (municipio_id, canal, destino, motivo, corpo, segmentos, custo_cent, estado, enviada_em, enviar_em) VALUES
      ($1, 'sms', '+351910000000', 'fim_chamada', 'Olá', 2, 8, 'entregue', now() - interval '1 day', now() - interval '1 day'),
      ($1, 'sms', '+351910000000', 'prazo', 'Olá', NULL, NULL, 'falhou', NULL, now() - interval '1 day'),
      ($2, 'sms', '+351910000001', 'prazo', 'Isco', 1, 99999, 'enviada', now() - interval '1 day', now() - interval '1 day')`,
    [A, B],
  );

  for (const v of [
    'mv_conversas_por_hora',
    'mv_temas_periodo',
    'mv_resultados_periodo',
    'mv_trabalho_feito_semana',
    'mv_processos_fases',
  ]) {
    await q(`REFRESH MATERIALIZED VIEW ${v}`);
  }
}
