import { Feriados, somarDiasUteis } from '../../common/dias-uteis.js';

/*
 * Vagas de agendas e janelas de recolha: lógica pura (sem BD). Tudo no fuso
 * do município: o horário diz "09:00-16:00" em hora local e a mudança de
 * hora (último domingo de março/outubro) não pode desalinhar os slots.
 */

export type DiaSemana = 'dom' | 'seg' | 'ter' | 'qua' | 'qui' | 'sex' | 'sab';

/** `agendas.horario`: {"seg":["09:00-12:30","14:00-16:00"], ...}; dia sem chave = fechado. */
export type Horario = Partial<Record<DiaSemana, string[]>>;

export interface Intervalo {
  inicio: Date;
  fim: Date;
}

const DIAS: DiaSemana[] = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

/** Minutos que o fuso está à frente de UTC neste instante (Lisboa: 0 ou 60). */
export function desvioMin(instante: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instante);
  const v = (t: string) => Number(partes.find((p) => p.type === t)?.value);
  const local = Date.UTC(
    v('year'),
    v('month') - 1,
    v('day'),
    v('hour'),
    v('minute'),
  );
  return Math.round((local - instante.getTime()) / 60_000);
}

/** '2026-10-23' + '09:00' em Lisboa → o instante (UTC) correspondente. */
export function instanteLocal(dia: string, hhmm: string, fuso: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const ingenuo = Date.UTC(a, m - 1, d, h, mi);
  // Duas passagens: o desvio certo é o do instante final, não o do ingénuo.
  let t = ingenuo - desvioMin(new Date(ingenuo), fuso) * 60_000;
  t = ingenuo - desvioMin(new Date(t), fuso) * 60_000;
  return new Date(t);
}

/** O dia local de um instante, 'YYYY-MM-DD'. */
export function diaLocal(instante: Date, fuso: string): string {
  return instante.toLocaleDateString('sv-SE', { timeZone: fuso });
}

/** A hora local de um instante, 'HH:MM'. */
export function horaLocal(instante: Date, fuso: string): string {
  return instante.toLocaleTimeString('en-GB', {
    timeZone: fuso,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export function diaDaSemana(dia: string): DiaSemana {
  return DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()];
}

/** n dias de calendário a partir de `inicio` (inclusive). */
export function diasSeguintes(inicio: string, n: number): string[] {
  const d = new Date(`${inicio}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

function minutos(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v <= 24 * 60 ? v : null;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export interface PedidoSlots {
  horario: Horario;
  duracaoMin: number;
  dias: string[];
  fuso: string;
  feriados: Feriados;
  agora: Date;
  /** Não se marca em cima da hora: margem mínima a partir de agora. */
  antecedenciaMin?: number;
  /** Marcações já feitas (estado 'marcada'). */
  ocupados: Intervalo[];
}

/**
 * As vagas livres: slots de `duracaoMin` dentro de cada faixa do horário,
 * sem feriados, sem dias fechados (fim de semana só se o horário o tiver),
 * sem o que já passou e sem o que se sobrepõe a marcações existentes.
 */
export function gerarSlots(p: PedidoSlots): Intervalo[] {
  if (p.duracaoMin <= 0) return [];
  const limite = p.agora.getTime() + (p.antecedenciaMin ?? 0) * 60_000;
  const livres: Intervalo[] = [];
  for (const dia of p.dias) {
    if (p.feriados.has(dia)) continue;
    for (const faixa of p.horario[diaDaSemana(dia)] ?? []) {
      const [a, b] = faixa.split('-').map(minutos);
      if (a === null || b === null || a === undefined || b === undefined) {
        continue;
      }
      for (let t = a; t + p.duracaoMin <= b; t += p.duracaoMin) {
        const inicio = instanteLocal(dia, hhmm(t), p.fuso);
        const fim = instanteLocal(dia, hhmm(t + p.duracaoMin), p.fuso);
        if (inicio.getTime() < limite) continue;
        const ocupado = p.ocupados.some(
          (o) => inicio < o.fim && o.inicio < fim,
        );
        if (!ocupado) livres.push({ inicio, fim });
      }
    }
  }
  return livres.sort((x, y) => x.inicio.getTime() - y.inicio.getTime());
}

/**
 * Poucas opções, fáceis de dizer ao telefone: até `porDia` por dia (a
 * primeira da manhã e, se houver, uma da tarde) até chegar a `limite`.
 */
export function escolherOpcoes(
  slots: Intervalo[],
  fuso: string,
  limite = 6,
  porDia = 2,
): Intervalo[] {
  const porDiaMap = new Map<string, Intervalo[]>();
  for (const s of slots) {
    const d = diaLocal(s.inicio, fuso);
    porDiaMap.set(d, [...(porDiaMap.get(d) ?? []), s]);
  }
  const escolhidas: Intervalo[] = [];
  for (const doDia of porDiaMap.values()) {
    const [primeira, ...resto] = doDia;
    const opcoes = [primeira];
    const tarde =
      resto.find((s) => horaLocal(s.inicio, fuso) >= '13:00') ?? resto[0];
    if (tarde) opcoes.push(tarde);
    escolhidas.push(...opcoes.slice(0, porDia));
    if (escolhidas.length >= limite) break;
  }
  return escolhidas.slice(0, limite);
}

/** Para um dia só: `n` vagas espalhadas pelo dia, não as n primeiras seguidas. */
export function espalhar(slots: Intervalo[], n = 6): Intervalo[] {
  if (slots.length <= n) return slots;
  if (n <= 1) return slots.slice(0, n);
  const passo = (slots.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => slots[Math.round(i * passo)]);
}

/** O slot pedido existe no horário da agenda (ignora ocupação)? */
export function slotNoHorario(
  inicio: Date,
  p: Omit<PedidoSlots, 'dias' | 'ocupados'>,
): Intervalo | null {
  const dia = diaLocal(inicio, p.fuso);
  return (
    gerarSlots({ ...p, dias: [dia], ocupados: [] }).find(
      (s) => s.inicio.getTime() === inicio.getTime(),
    ) ?? null
  );
}

/** Para dizer: 'terça-feira, 20 de outubro, às 9h30'. */
export function dizerQuando(instante: Date, fuso: string): string {
  const data = instante.toLocaleDateString('pt-PT', {
    timeZone: fuso,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return `${data}, ${dizerHora(instante, fuso)}`;
}

/** Para dizer: 'às 9h30', 'às 14h'. */
export function dizerHora(instante: Date, fuso: string): string {
  const [h, m] = horaLocal(instante, fuso).split(':').map(Number);
  return `às ${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

/*
 * Recolha de monos: janelas de meio dia, no máximo CAPACIDADE_JANELA
 * recolhas por janela e por entidade. A primeira janela possível é no dia
 * útil seguinte (a empresa planeia o circuito na véspera); escolhe-se a
 * preferência do munícipe (manhã/tarde) e, se estiver cheia, a outra metade
 * do dia, e depois os dias úteis seguintes.
 */
export type Periodo = 'manha' | 'tarde';

export const JANELAS: Record<Periodo, [string, string]> = {
  manha: ['08:00', '12:00'],
  tarde: ['13:00', '17:00'],
};

export const CAPACIDADE_JANELA = 10;

/** Em que metade do dia começa a janela. */
export function periodoDe(instante: Date, fuso: string): Periodo {
  return horaLocal(instante, fuso) < '12:00' ? 'manha' : 'tarde';
}

/** 'de manhã (entre as 8h e as 12h)'. */
export function dizerPeriodo(periodo: Periodo): string {
  const [de, ate] = JANELAS[periodo].map((h) => `${Number(h.slice(0, 2))}h`);
  return `${periodo === 'manha' ? 'de manhã' : 'à tarde'} (entre as ${de} e as ${ate})`;
}

/** '2026-10-20' → 'terça-feira, 20 de outubro'. */
export function dizerDia(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-PT', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** A janela de uma recolha, para dizer: 'terça-feira, 20 de outubro, à tarde (…)'. */
export function dizerJanela(inicio: Date, fuso: string): string {
  return `${dizerDia(diaLocal(inicio, fuso))}, ${dizerPeriodo(periodoDe(inicio, fuso))}`;
}

export function proximaJanela(p: {
  hoje: string;
  feriados: Feriados;
  preferencia?: Periodo;
  /** Recolhas já marcadas por 'YYYY-MM-DD|periodo'. */
  ocupacao: ReadonlyMap<string, number>;
  capacidade?: number;
  maxDiasUteis?: number;
}): { dia: string; periodo: Periodo } | null {
  const capacidade = p.capacidade ?? CAPACIDADE_JANELA;
  const ordem: Periodo[] =
    p.preferencia === 'tarde' ? ['tarde', 'manha'] : ['manha', 'tarde'];
  let dia = p.hoje;
  for (let i = 0; i < (p.maxDiasUteis ?? 20); i++) {
    dia = somarDiasUteis(dia, 1, p.feriados);
    for (const periodo of ordem) {
      if ((p.ocupacao.get(`${dia}|${periodo}`) ?? 0) < capacidade) {
        return { dia, periodo };
      }
    }
  }
  return null;
}
