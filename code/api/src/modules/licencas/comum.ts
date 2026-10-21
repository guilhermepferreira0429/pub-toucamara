/*
 * O que todos os tipos de licença partilham: a forma da avaliação (regras
 * verificadas, proposta, condições, taxa), a verificação da data e da
 * antecedência e pequenas contas de datas. Sem BD, para testar à parte.
 */
import { z } from 'zod';
import { diasUteisEntre, Feriados } from '../../common/dias-uteis.js';
import type { LinhaTaxa } from '../pagamentos/taxas.js';

export interface RegraAvaliada {
  id: string;
  ok: boolean;
  texto: string;
}

export interface Taxa {
  linhas: LinhaTaxa[];
  total_cent: number;
}

/** O resultado de correr as regras de um tipo sobre um pedido. */
export interface AvaliacaoLicenca {
  regras: RegraAvaliada[];
  proposta: 'aprovar' | 'tecnico';
  condicoes: string[];
  /** A taxa que se paga se for aprovada (mesmo que vá a técnico). */
  taxa: Taxa;
}

/** Campos comuns a todas as configurações de regras. */
export const camposComuns = {
  /** 'funcionario': alguém aprova com um clique; 'automatica': emite logo depois de pago. */
  aprovacao: z.enum(['funcionario', 'automatica']),
  fonte: z.object({
    titulo: z.string().trim().min(3).max(200),
    url: z.url().nullable(),
  }),
  /** Valores por confirmar com o regulamento do município. */
  demonstracao: z.boolean(),
};

export function propostaDe(regras: RegraAvaliada[]): 'aprovar' | 'tecnico' {
  return regras.every((r) => r.ok) ? 'aprovar' : 'tecnico';
}

export function diasEntre(de: string, ate: string): number {
  return Math.round(
    (Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) /
      86_400_000,
  );
}

export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** O mesmo dia n meses depois (31 de jan. + 1 mês → 28/29 de fev.). */
export function somarMeses(dia: string, n: number): string {
  const [a, m, d] = dia.split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1, 12));
  const ultimo = new Date(
    Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

/** 1,5 em vez de 1.5. */
export function num(v: number): string {
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

/** "12,00 €" (sem depender de outros módulos). */
export function euros(cent: number): string {
  return `${Math.floor(cent / 100)},${String(cent % 100).padStart(2, '0')} €`;
}

/**
 * A data pedida: não pode já ter passado, nem ser longe demais, e precisa
 * de um mínimo de dias úteis de antecedência.
 */
export function regraDeData(
  data: string,
  hoje: string,
  c: { antecedencia_min_dias_uteis: number; antecedencia_max_dias: number },
  feriados: Feriados,
): RegraAvaliada {
  const corridos = diasEntre(hoje, data);
  if (corridos < 0) {
    return { id: 'data', ok: false, texto: 'A data já passou.' };
  }
  if (corridos > c.antecedencia_max_dias) {
    return {
      id: 'data',
      ok: false,
      texto: `Só se pede com até ${c.antecedencia_max_dias} dias de antecedência.`,
    };
  }
  const uteis = diasUteisEntre(hoje, data, feriados);
  const ok = uteis >= c.antecedencia_min_dias_uteis;
  return {
    id: 'antecedencia',
    ok,
    texto: ok
      ? `Pedido com ${uteis} dias úteis de antecedência (mínimo ${c.antecedencia_min_dias_uteis}).`
      : `Pedido com ${uteis} dias úteis de antecedência: o mínimo é ${c.antecedencia_min_dias_uteis}.`,
  };
}

/** "sábado, 31 de outubro de 2026". */
export function diaPorExtenso(dia: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${dia}T12:00:00Z`));
}

/** "31 de outubro de 2026". */
export function dataPorExtenso(dia: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${dia}T12:00:00Z`));
}

/** "sáb., 31/10". */
export function diaCurto(dia: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${dia}T12:00:00Z`));
}
