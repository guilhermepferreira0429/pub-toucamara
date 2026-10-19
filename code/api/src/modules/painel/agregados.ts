import {
  Agrupar,
  balde,
  indicador,
  Indicador,
  percentagem,
  variacao,
} from './periodos.js';

/*
 * Contas do painel e dos relatórios a partir das linhas das vistas. Puro:
 * as consultas estão em painel-dados.service.ts.
 */

/** Somas de mv_resultados_periodo (por canal, por balde ou no total). */
export interface LinhaResultados {
  canal?: string;
  balde?: string;
  total: number;
  terminadas: number;
  resolvidas_sem_humano: number;
  passadas: number;
  sem_resposta: number;
  marcacoes: number;
  emergencias: number;
  fora_de_horas: number;
  duracao_total_s: number;
  com_duracao: number;
}

/** Somas de mv_trabalho_feito_semana (ver a migração 0018 para cada número). */
export interface LinhaTrabalho {
  balde?: string;
  requerimentos: number;
  ocorrencias_agente: number;
  consultas_processo: number;
  referencias_mb: number;
  pagamentos_pagos: number;
  pagos_cent: number;
  marcacoes: number;
  recolhas: number;
  passagens: number;
  ocorrencias: number;
  ocorrencias_resolvidas: number;
  horas_resolucao: number;
  sms_enviados: number;
  sms_segmentos: number;
  sms_custo_cent: number;
}

const CAMPOS_RESULTADOS = [
  'total',
  'terminadas',
  'resolvidas_sem_humano',
  'passadas',
  'sem_resposta',
  'marcacoes',
  'emergencias',
  'fora_de_horas',
  'duracao_total_s',
  'com_duracao',
] as const;

const CAMPOS_TRABALHO = [
  'requerimentos',
  'ocorrencias_agente',
  'consultas_processo',
  'referencias_mb',
  'pagamentos_pagos',
  'pagos_cent',
  'marcacoes',
  'recolhas',
  'passagens',
  'ocorrencias',
  'ocorrencias_resolvidas',
  'horas_resolucao',
  'sms_enviados',
  'sms_segmentos',
  'sms_custo_cent',
] as const;

function somar<C extends string>(
  linhas: readonly Partial<Record<C, number>>[],
  campos: readonly C[],
): Record<C, number> {
  const r = Object.fromEntries(campos.map((c) => [c, 0])) as Record<C, number>;
  for (const l of linhas) {
    for (const c of campos) r[c] += Number(l[c] ?? 0);
  }
  return r;
}

export function somarResultados(
  linhas: readonly LinhaResultados[],
): LinhaResultados {
  return somar(linhas, CAMPOS_RESULTADOS);
}

export function somarTrabalho(linhas: readonly LinhaTrabalho[]): LinhaTrabalho {
  return somar(linhas, CAMPOS_TRABALHO);
}

/** Os números de um período, já com as percentagens e médias. */
export interface Resumo {
  conversas: number;
  chamadas: number;
  escritas: number;
  resolvidas_sem_humano: number;
  resolvidas_sem_humano_pct: number | null;
  passadas: number;
  sem_resposta: number;
  marcacoes: number;
  emergencias: number;
  fora_de_horas: number;
  fora_de_horas_pct: number | null;
  duracao_media_s: number | null;
}

/** Recebe as linhas por canal (telefone = chamadas, o resto = escritas). */
export function resumir(porCanal: readonly LinhaResultados[]): Resumo {
  const t = somarResultados(porCanal);
  const chamadas = porCanal
    .filter((l) => l.canal === 'telefone')
    .reduce((s, l) => s + l.total, 0);
  return {
    conversas: t.total,
    chamadas,
    escritas: t.total - chamadas,
    resolvidas_sem_humano: t.resolvidas_sem_humano,
    resolvidas_sem_humano_pct: percentagem(
      t.resolvidas_sem_humano,
      t.terminadas,
    ),
    passadas: t.passadas,
    sem_resposta: t.sem_resposta,
    marcacoes: t.marcacoes,
    emergencias: t.emergencias,
    fora_de_horas: t.fora_de_horas,
    fora_de_horas_pct: percentagem(t.fora_de_horas, t.total),
    duracao_media_s: t.com_duracao
      ? Math.round(t.duracao_total_s / t.com_duracao)
      : null,
  };
}

/** Indicadores da Visão geral: o período e a variação face ao anterior. */
export function indicadoresDoPeriodo(
  atual: Resumo,
  anterior: Resumo,
): Record<string, Indicador> {
  return {
    conversas: indicador(atual.conversas, anterior.conversas),
    chamadas: indicador(atual.chamadas, anterior.chamadas),
    escritas: indicador(atual.escritas, anterior.escritas),
    resolvidas_sem_humano_pct: indicador(
      atual.resolvidas_sem_humano_pct,
      anterior.resolvidas_sem_humano_pct,
      'pct',
    ),
    passadas: indicador(atual.passadas, anterior.passadas),
    sem_resposta: indicador(atual.sem_resposta, anterior.sem_resposta),
    marcacoes: indicador(atual.marcacoes, anterior.marcacoes),
    fora_de_horas_pct: indicador(
      atual.fora_de_horas_pct,
      anterior.fora_de_horas_pct,
      'pct',
    ),
    duracao_media_s: indicador(
      atual.duracao_media_s,
      anterior.duracao_media_s,
      's',
    ),
  };
}

/** "O que o agente tratou": os números que se mostram, com variação. */
export function trabalhoFeito(atual: LinhaTrabalho, anterior?: LinhaTrabalho) {
  const campos = [
    'requerimentos',
    'ocorrencias_agente',
    'consultas_processo',
    'referencias_mb',
    'marcacoes',
    'recolhas',
    'passagens',
  ] as const;
  return Object.fromEntries(
    campos.map((c) => [
      c,
      anterior ? indicador(atual[c], anterior[c]) : atual[c],
    ]),
  ) as Record<(typeof campos)[number], number | Indicador>;
}

export const DIAS_SEMANA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/**
 * Mapa de calor 7 × 24: linha 0 = segunda, coluna = hora local.
 * Recebe (dia_semana 1..7, hora 0..23, total).
 */
export function mapaCalor(
  linhas: readonly { dia_semana: number; hora: number; total: number }[],
): { dias: string[]; celulas: number[][]; maximo: number } {
  const celulas = DIAS_SEMANA.map(() => Array<number>(24).fill(0));
  let maximo = 0;
  for (const l of linhas) {
    if (l.dia_semana < 1 || l.dia_semana > 7 || l.hora < 0 || l.hora > 23) {
      continue;
    }
    const v = (celulas[l.dia_semana - 1][l.hora] += l.total);
    if (v > maximo) maximo = v;
  }
  return { dias: DIAS_SEMANA, celulas, maximo };
}

export interface TemaContado {
  tema_id: string;
  tema: string;
  total: number;
}

/** Os n temas com mais conversas no período, com a variação face ao anterior. */
export function topTemas(
  atual: readonly TemaContado[],
  anterior: readonly { tema_id: string; total: number }[],
  n = 8,
) {
  const antes = new Map(anterior.map((t) => [t.tema_id, t.total]));
  const soma = atual.reduce((s, t) => s + t.total, 0);
  return [...atual]
    .sort((a, b) => b.total - a.total || a.tema.localeCompare(b.tema, 'pt'))
    .slice(0, n)
    .map((t) => {
      const ant = antes.get(t.tema_id) ?? 0;
      return {
        tema_id: t.tema_id,
        tema: t.tema,
        total: t.total,
        percentagem: percentagem(t.total, soma),
        anterior: ant,
        variacao: variacao(t.total, ant),
        novo: ant === 0 && t.total > 0,
      };
    });
}

/** Uma série completa (baldes sem dados a zero) para os gráficos dos Indicadores. */
export function montarSeries(
  baldesDoPeriodo: readonly string[],
  resultados: readonly LinhaResultados[],
  trabalho: readonly LinhaTrabalho[],
  agrupar: Agrupar,
) {
  const res = new Map<string, LinhaResultados[]>();
  for (const l of resultados) {
    const b = balde(l.balde!, agrupar);
    res.set(b, [...(res.get(b) ?? []), l]);
  }
  const trab = new Map<string, LinhaTrabalho[]>();
  for (const l of trabalho) {
    const b = balde(l.balde!, agrupar);
    trab.set(b, [...(trab.get(b) ?? []), l]);
  }
  return baldesDoPeriodo.map((b) => {
    const linhas = res.get(b) ?? [];
    const r = resumir(linhas);
    const t = somarTrabalho(trab.get(b) ?? []);
    const porCanal: Record<string, number> = {};
    for (const l of linhas) {
      if (l.canal) porCanal[l.canal] = (porCanal[l.canal] ?? 0) + l.total;
    }
    return {
      balde: b,
      conversas: { total: r.conversas, por_canal: porCanal },
      resolvidas_sem_humano_pct: r.resolvidas_sem_humano_pct,
      passadas: r.passadas,
      fora_de_horas_pct: r.fora_de_horas_pct,
      duracao_media_s: r.duracao_media_s,
      sms: {
        enviados: t.sms_enviados,
        segmentos: t.sms_segmentos,
        custo_cent: t.sms_custo_cent,
      },
      ocorrencias: {
        registadas: t.ocorrencias,
        resolvidas: t.ocorrencias_resolvidas,
        tempo_medio_resolucao_h: t.ocorrencias_resolvidas
          ? Math.round((t.horas_resolucao / t.ocorrencias_resolvidas) * 10) / 10
          : null,
      },
    };
  });
}

export interface LinhaProcessosFase {
  fase: string;
  tecnico_id: string | null;
  tecnico: string | null;
  total: number;
  atrasados: number;
  dias_medios_na_fase: number | null;
}

const ORDEM_FASES = [
  'entrada',
  'documentos',
  'apreciacao',
  'pareceres_externos',
  'decisao',
  'notificado',
];

/** Processos em curso: por fase (com média ponderada de dias) e por técnico. */
export function resumirProcessos(linhas: readonly LinhaProcessosFase[]) {
  const fases = new Map<
    string,
    { total: number; atrasados: number; dias: number }
  >();
  const tecnicos = new Map<
    string,
    {
      tecnico_id: string | null;
      tecnico: string;
      total: number;
      atrasados: number;
    }
  >();
  for (const l of linhas) {
    const f = fases.get(l.fase) ?? { total: 0, atrasados: 0, dias: 0 };
    f.total += l.total;
    f.atrasados += l.atrasados;
    f.dias += (l.dias_medios_na_fase ?? 0) * l.total;
    fases.set(l.fase, f);
    if (l.fase === 'notificado') continue; // já não é carga de ninguém
    const chave = l.tecnico_id ?? '';
    const t = tecnicos.get(chave) ?? {
      tecnico_id: l.tecnico_id,
      tecnico: l.tecnico ?? 'Sem técnico',
      total: 0,
      atrasados: 0,
    };
    t.total += l.total;
    t.atrasados += l.atrasados;
    tecnicos.set(chave, t);
  }
  const porFase = [...fases.entries()]
    .sort(([a], [b]) => ORDEM_FASES.indexOf(a) - ORDEM_FASES.indexOf(b))
    .map(([fase, f]) => ({
      fase,
      total: f.total,
      atrasados: f.atrasados,
      dias_medios_na_fase: f.total
        ? Math.round((f.dias / f.total) * 10) / 10
        : null,
    }));
  return {
    em_curso: porFase.reduce((s, f) => s + f.total, 0),
    atrasados: porFase.reduce((s, f) => s + f.atrasados, 0),
    por_fase: porFase,
    por_tecnico: [...tecnicos.values()].sort((a, b) => b.total - a.total),
  };
}
