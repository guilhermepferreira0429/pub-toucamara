import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { ErroApi } from '../../common/erros.js';
import { validar } from '../../common/validacao.js';

/*
 * Períodos do painel e dos relatórios: dias 'YYYY-MM-DD' no calendário do
 * município, `de` e `ate` inclusive. Tudo puro (sem BD), para testar.
 */

export interface Periodo {
  de: string;
  ate: string;
}

export type Agrupar = 'dia' | 'semana';

/** As vistas guardam 400 dias; pedir mais devolvia zeros enganadores. */
export const MAX_DIAS = 400;

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function deIso(s: string): Date {
  return new Date(`${s}T12:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** '2026-02-31' não é um dia. */
export function diaValido(s: string): boolean {
  const d = deIso(s);
  return !Number.isNaN(d.getTime()) && iso(d) === s;
}

/** Hoje no fuso do município ('Europe/Lisbon', 'Atlantic/Azores'...). */
export function hojeNoFuso(fuso: string, agora = new Date()): string {
  return agora.toLocaleDateString('sv-SE', { timeZone: fuso });
}

export function somarDias(dia: string, n: number): string {
  const d = deIso(dia);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Dias do período, os dois extremos incluídos. */
export function diasNoPeriodo(p: Periodo): number {
  return (
    Math.round((deIso(p.ate).getTime() - deIso(p.de).getTime()) / 864e5) + 1
  );
}

/** O período do mesmo tamanho imediatamente antes. */
export function periodoAnterior(p: Periodo): Periodo {
  const n = diasNoPeriodo(p);
  return { de: somarDias(p.de, -n), ate: somarDias(p.de, -1) };
}

/** 1 = segunda ... 7 = domingo. */
export function diaDaSemana(dia: string): number {
  return deIso(dia).getUTCDay() || 7;
}

/** A segunda-feira da semana do dia. */
export function inicioSemana(dia: string): string {
  return somarDias(dia, 1 - diaDaSemana(dia));
}

/** Esta semana: de segunda até hoje. */
export function semanaAteHoje(hoje: string): Periodo {
  return { de: inicioSemana(hoje), ate: hoje };
}

export function balde(dia: string, agrupar: Agrupar): string {
  return agrupar === 'semana' ? inicioSemana(dia) : dia;
}

/** Os baldes (dias ou segundas-feiras) que tocam o período, por ordem. */
export function baldes(p: Periodo, agrupar: Agrupar): string[] {
  const r: string[] = [];
  const passo = agrupar === 'semana' ? 7 : 1;
  for (let d = balde(p.de, agrupar); d <= p.ate; d = somarDias(d, passo)) {
    r.push(d);
  }
  return r;
}

/** Até 31 dias ao dia; mais do que isso, à semana. */
export function agruparPorOmissao(p: Periodo): Agrupar {
  return diasNoPeriodo(p) <= 31 ? 'dia' : 'semana';
}

/**
 * Variação em % face ao anterior, com uma casa decimal. Sem base (anterior 0)
 * não há percentagem que faça sentido: null.
 */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

/** Parte do todo em %, uma casa decimal; null sem base. */
export function percentagem(parte: number, todo: number): number | null {
  if (!todo) return null;
  return Math.round((parte / todo) * 1000) / 10;
}

export interface Indicador {
  valor: number | null;
  anterior: number | null;
  /** Contagens: variação em %. Percentagens: diferença em pontos. */
  variacao: number | null;
  unidade: 'n' | 'pct' | 's';
}

export function indicador(
  valor: number | null,
  anterior: number | null,
  unidade: Indicador['unidade'] = 'n',
): Indicador {
  let v: number | null = null;
  if (valor !== null && anterior !== null) {
    v =
      unidade === 'pct'
        ? Math.round((valor - anterior) * 10) / 10
        : variacao(valor, anterior);
  }
  return { valor, anterior, variacao: v, unidade };
}

const esquemaQuery = z.object({
  de: z.string().regex(DIA, 'Data no formato AAAA-MM-DD.').optional(),
  ate: z.string().regex(DIA, 'Data no formato AAAA-MM-DD.').optional(),
  agrupar: z.enum(['dia', 'semana']).optional(),
});

/**
 * `?de=&ate=` do painel. Por omissão os últimos 7 dias até hoje; só `de`
 * vai até hoje; só `ate` são os 7 dias até lá.
 */
export function lerPeriodo(
  query: unknown,
  hoje: string,
): Periodo & { agrupar?: Agrupar } {
  const q = validar(esquemaQuery, query ?? {});
  const ate = q.ate ?? hoje;
  const de = q.de ?? somarDias(ate, -6);
  if (!diaValido(de) || !diaValido(ate)) {
    throw new ErroApi(
      HttpStatus.BAD_REQUEST,
      'periodo_invalido',
      'Data inválida.',
    );
  }
  if (de > ate) {
    throw new ErroApi(
      HttpStatus.BAD_REQUEST,
      'periodo_invalido',
      'A data de início é depois da data de fim.',
    );
  }
  if (diasNoPeriodo({ de, ate }) > MAX_DIAS) {
    throw new ErroApi(
      HttpStatus.BAD_REQUEST,
      'periodo_demasiado_longo',
      `O período tem de ter no máximo ${MAX_DIAS} dias.`,
    );
  }
  return { de, ate, agrupar: q.agrupar };
}
