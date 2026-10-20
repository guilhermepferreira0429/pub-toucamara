import { diasUteisEntre } from '../../common/dias-uteis.js';
import {
  agregarCarga,
  AMOSTRA_MINIMA,
  cargaPonderada,
  diasUteis,
  DIAS_SEM_EVENTOS,
  gargalo,
  LinhaCargaBd,
  motivosParado,
  percentil,
  referenciaPara,
  referencias,
  resumoDecididos,
  Segmento,
  temposPorFase,
} from './gestao.js';
import { somarDias } from './periodos.js';

const FERIADOS = new Set(['2026-10-05', '2026-12-08', '2026-12-25']);

describe('diasUteis', () => {
  it('não conta fins de semana nem feriados (de exclusive, até inclusive)', () => {
    // seg 2026-10-05 é feriado; sex 2026-10-02 → sex 2026-10-09: ter a sex = 4
    expect(diasUteis('2026-10-02', '2026-10-09', FERIADOS)).toBe(4);
    expect(diasUteis('2026-10-09', '2026-10-09', FERIADOS)).toBe(0);
    // sáb → dom: 0; sex → seg: 1
    expect(diasUteis('2026-10-10', '2026-10-11', FERIADOS)).toBe(0);
    expect(diasUteis('2026-10-16', '2026-10-19', FERIADOS)).toBe(1);
    // ao contrário, negativo
    expect(diasUteis('2026-10-09', '2026-10-02', FERIADOS)).toBe(-4);
  });

  it('dá o mesmo que diasUteisEntre em qualquer intervalo', () => {
    const inicio = '2025-11-20';
    for (let i = 0; i < 400; i += 7) {
      for (const n of [0, 1, 2, 5, 6, 13, 40, 120]) {
        const de = somarDias(inicio, i);
        const ate = somarDias(de, n);
        expect(diasUteis(de, ate, FERIADOS)).toBe(
          diasUteisEntre(de, ate, FERIADOS),
        );
        expect(diasUteis(ate, de, FERIADOS)).toBe(
          diasUteisEntre(ate, de, FERIADOS),
        );
      }
    }
  });

  it('um feriado ao fim de semana não desconta duas vezes', () => {
    const sabado = new Set(['2026-10-10']);
    expect(diasUteis('2026-10-09', '2026-10-12', sabado)).toBe(1);
  });
});

describe('percentil', () => {
  it('interpola como o percentile_cont', () => {
    expect(percentil([1, 2, 3, 4], 75)).toBe(3.25);
    expect(percentil([10, 1, 5], 50)).toBe(5);
    expect(percentil([7], 75)).toBe(7);
    expect(percentil([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(percentil([1, 2, 3, 4, 5], 100)).toBe(5);
  });

  it('sem valores: null', () => {
    expect(percentil([], 75)).toBeNull();
  });
});

describe('cargaPonderada', () => {
  const zero = {
    abertos: 0,
    atrasados: 0,
    a_terminar: 0,
    aguarda_municipe: 0,
    passagens_em_curso: 0,
    ocorrencias_abertas: 0,
  };

  it('normal 1, a terminar 2, atrasado 3, à espera do munícipe 0,25', () => {
    expect(cargaPonderada({ ...zero, abertos: 1 })).toBe(1);
    expect(cargaPonderada({ ...zero, abertos: 1, a_terminar: 1 })).toBe(2);
    expect(cargaPonderada({ ...zero, abertos: 1, atrasados: 1 })).toBe(3);
    expect(cargaPonderada({ ...zero, abertos: 1, aguarda_municipe: 1 })).toBe(
      0.3, // 0,25 com uma casa decimal
    );
  });

  it('passagens e ocorrências valem meio', () => {
    expect(
      cargaPonderada({
        ...zero,
        passagens_em_curso: 3,
        ocorrencias_abertas: 2,
      }),
    ).toBe(2.5);
  });
});

describe('agregarCarga', () => {
  const l = (p: Partial<LinhaCargaBd>): LinhaCargaBd => ({
    servico_id: 's1',
    tecnico_id: 't1',
    fase: 'apreciacao',
    abertos: 1,
    atrasados: 0,
    a_terminar: 0,
    aguarda_municipe: 0,
    ...p,
  });

  it('soma por técnico, conta por fase e ordena pela carga', () => {
    const r = agregarCarga(
      [
        l({ abertos: 2 }),
        l({ fase: 'documentos', abertos: 4, aguarda_municipe: 4 }),
        l({ tecnico_id: 't2', abertos: 1, atrasados: 1 }),
        l({ tecnico_id: null, abertos: 1 }),
      ],
      'tecnico_id',
      new Map([
        ['t1', 'Ana'],
        ['t2', 'Bruno'],
        ['t3', 'Carla'],
      ]),
      ['t1', 't2', 't3'],
      'Sem técnico',
      { passagens: new Map([['t3', 1]]) },
    );
    expect(r.map((x) => [x.nome, x.carga])).toEqual([
      ['Ana', 3], // 6 abertos − 0,75 × 4
      ['Bruno', 3],
      ['Sem técnico', 1],
      ['Carla', 0.5],
    ]);
    expect(r[0].por_fase).toMatchObject({ apreciacao: 2, documentos: 4 });
    expect(r[0].por_fase).not.toHaveProperty('notificado');
  });

  it('a linha sem id só aparece com algo; os de "sempre" aparecem com zeros', () => {
    const r = agregarCarga(
      [l({})],
      'servico_id',
      new Map([
        ['s1', 'Obras'],
        ['s2', 'Vias'],
      ]),
      ['s1', 's2'],
      'Sem serviço',
      { ocorrencias: new Map([['s2', 4]]) },
    );
    expect(r.map((x) => [x.nome, x.carga, x.ocorrencias_abertas])).toEqual([
      ['Vias', 2, 4],
      ['Obras', 1, 0],
    ]);
  });
});

describe('temposPorFase', () => {
  const s = (
    processo_id: string,
    fase: Segmento['fase'],
    inicio_dia: string,
    fim_dia: string,
  ): Segmento => ({
    processo_id,
    tipo_processo_id: 'cp',
    fase,
    inicio_dia,
    fim_dia,
  });

  it('soma as passagens pela mesma fase e tira média e mediana entre processos', () => {
    const r = temposPorFase(
      [
        // p1: documentos 2 dias úteis + 3 dias úteis = 5; apreciação 5
        s('p1', 'documentos', '2026-09-01', '2026-09-03'),
        s('p1', 'entrada', '2026-09-03', '2026-09-03'),
        s('p1', 'documentos', '2026-09-03', '2026-09-08'),
        s('p1', 'apreciacao', '2026-09-08', '2026-09-15'),
        // p2: apreciação 10
        s('p2', 'apreciacao', '2026-09-01', '2026-09-15'),
        s('p2', 'notificado', '2026-09-15', '2026-09-20'),
      ],
      FERIADOS,
    );
    const f = Object.fromEntries(r.map((x) => [x.fase, x]));
    expect(f.documentos).toMatchObject({ processos: 1, media_dias_uteis: 5 });
    expect(f.apreciacao).toMatchObject({
      processos: 2,
      media_dias_uteis: 7.5,
      mediana_dias_uteis: 7.5,
    });
    expect(f.entrada).toMatchObject({ processos: 1, media_dias_uteis: 0 });
    expect(f.pareceres_externos).toMatchObject({
      processos: 0,
      media_dias_uteis: null,
    });
    expect(f).not.toHaveProperty('notificado');
  });
});

describe('resumoDecididos', () => {
  it('média, mediana e % dentro do prazo (sem prazo não conta)', () => {
    const r = resumoDecididos(
      [
        {
          entrada: '2026-09-01',
          decisao: '2026-09-08',
          prazo_fim: '2026-09-10',
        },
        {
          entrada: '2026-09-01',
          decisao: '2026-09-15',
          prazo_fim: '2026-09-10',
        },
        { entrada: '2026-09-01', decisao: '2026-09-02', prazo_fim: null },
      ],
      FERIADOS,
    );
    expect(r).toEqual({
      decididos: 3,
      media_dias_uteis: 5.3, // (5 + 10 + 1) / 3
      mediana_dias_uteis: 5,
      com_prazo: 2,
      dentro_do_prazo_pct: 50,
    });
  });
});

describe('referências e parados', () => {
  const seg = (
    tipo: string,
    fase: Segmento['fase'],
    dias: number,
  ): Segmento => ({
    processo_id: `${tipo}-${fase}-${dias}`,
    tipo_processo_id: tipo,
    fase,
    // segundas-feiras sem feriados: n semanas = 5n dias úteis
    inicio_dia: '2026-01-05',
    fim_dia: somarDias('2026-01-05', (dias / 5) * 7),
  });

  it('percentil 75 por tipo e fase; com pouca amostra, o da fase', () => {
    const cp = [5, 10, 15, 20, 25].map((d) => seg('cp', 'apreciacao', d));
    const lo = [50, 50].map((d) => seg('lo', 'apreciacao', d));
    const r = referencias([...cp, ...lo], new Set());
    expect(referenciaPara(r, 'cp', 'apreciacao')).toEqual({
      dias_uteis: 20,
      base: 'tipo',
      amostra: 5,
    });
    // LO só tem 2 (< AMOSTRA_MINIMA): usa o das 7 da fase
    expect(AMOSTRA_MINIMA).toBe(5);
    expect(referenciaPara(r, 'lo', 'apreciacao')).toEqual({
      dias_uteis: 37.5,
      base: 'fase',
      amostra: 7,
    });
    expect(referenciaPara(r, 'cp', 'decisao')).toBeNull();
  });

  it('parado: acima do normal ou sem eventos há mais de N dias úteis', () => {
    const ref = { dias_uteis: 20, base: 'tipo' as const, amostra: 9 };
    expect(motivosParado(20, 0, ref)).toEqual([]);
    expect(motivosParado(21, 0, ref)).toEqual(['acima_do_normal']);
    expect(motivosParado(5, DIAS_SEM_EVENTOS + 1, ref)).toEqual([
      'sem_eventos',
    ]);
    expect(motivosParado(30, 30, ref)).toEqual([
      'acima_do_normal',
      'sem_eventos',
    ]);
    // Sem histórico só conta a regra dos eventos.
    expect(motivosParado(300, DIAS_SEM_EVENTOS, null)).toEqual([]);
  });

  it('gargalo: mais dias acumulados; empate pelos processos e pela ordem', () => {
    expect(
      gargalo([
        { fase: 'documentos', parados: 5, dias_parados: 40 },
        { fase: 'apreciacao', parados: 2, dias_parados: 90 },
        { fase: 'decisao', parados: 9, dias_parados: 90 },
      ]),
    ).toEqual({ fase: 'decisao', parados: 9, dias_parados: 90 });
    expect(
      gargalo([
        { fase: 'decisao', parados: 1, dias_parados: 10 },
        { fase: 'entrada', parados: 1, dias_parados: 10 },
      ])?.fase,
    ).toBe('entrada');
    expect(
      gargalo([{ fase: 'entrada', parados: 0, dias_parados: 0 }]),
    ).toBeNull();
  });
});
