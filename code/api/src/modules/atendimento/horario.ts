/*
 * Horários de atendimento (balcão da câmara e contactos das entidades), tal
 * como estão em `entidade_contactos.horario`:
 *
 *   {"sempre": true}
 *   {"seg-sex": "9:00-16:00"}
 *   {"seg-sex": "9:00-12:30,14:00-17:00", "sab": "9:00-12:00"}
 *   {"seg": ["09:00-16:00"], "qua": "9h-19h", "dom": "fechado"}
 *
 * Chaves: dias (`seg`..`dom`, com ou sem acento, ou o nome inteiro),
 * intervalos de dias (`seg-sex`, `sex-seg` dá a volta) e listas (`seg,qua`).
 * Um dia sozinho sobrepõe-se ao intervalo que o inclui. Contas sempre em
 * minutos na hora local do município; feriados fecham tudo menos `sempre`.
 */
import { somarDiasUteis } from '../../common/dias-uteis.js';

/** [início, fim) em minutos desde as 0h, hora local. */
export type Intervalo = [number, number];

export interface Horario {
  sempre: boolean;
  /** 7 dias, 0 = domingo (como `getUTCDay`). */
  semana: Intervalo[][];
}

/** Sem horário configurado: dias úteis das 9h às 17h. */
export const HORARIO_POR_OMISSAO: Horario = {
  sempre: false,
  semana: [
    [],
    ...Array.from({ length: 5 }, () => [[540, 1020]]),
    [],
  ] as Intervalo[][],
};

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

function semAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** 'seg', 'Sábado', 'terça-feira' → índice; desconhecido → -1. */
function dia(nome: string): number {
  return DIAS.indexOf(semAcentos(nome).slice(0, 3));
}

/** 'seg-sex', 'sab,dom', 'qua' → índices dos dias; chave estranha → []. */
export function diasDaChave(chave: string): number[] {
  const dias = new Set<number>();
  for (const parte of chave.split(',')) {
    const [a, b, ...resto] = parte.split('-');
    if (resto.length) return [];
    const i = dia(a);
    if (i < 0) return [];
    if (b === undefined) {
      dias.add(i);
      continue;
    }
    const f = dia(b);
    if (f < 0) return [];
    for (let d = i; ; d = (d + 1) % 7) {
      dias.add(d);
      if (d === f) break;
    }
  }
  return [...dias];
}

/** '9:00', '09h30', '9h', '24:00' → minutos; inválido → null. */
function minutos(hora: string): number | null {
  const m = /^(\d{1,2})(?:[:h](\d{2})?)?$/.exec(hora.trim().toLowerCase());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return null;
  return h * 60 + mi;
}

/** '9:00-12:30,14:00-17:00' (ou lista) → intervalos; 'fechado'/false → []. */
export function lerIntervalos(valor: unknown): Intervalo[] | null {
  if (valor === false || valor === null) return [];
  const partes = Array.isArray(valor)
    ? valor.flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
    : typeof valor === 'string'
      ? valor.split(',')
      : null;
  if (!partes) return null;
  const intervalos: Intervalo[] = [];
  for (const parte of partes) {
    if (!parte.trim() || semAcentos(parte) === 'fechado') continue;
    const [a, b] = parte.split('-');
    const i = minutos(a ?? '');
    const f = minutos(b ?? '');
    if (i === null || f === null || i === f) continue;
    intervalos.push([i, f]);
  }
  return intervalos;
}

/**
 * Lê o jsonb do horário. Nada que se aproveite (vazio, formato estranho,
 * todos os dias fechados) → null, e quem chama usa o horário por omissão.
 */
export function lerHorario(json: unknown): Horario | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const entradas = Object.entries(json as Record<string, unknown>);
  if (entradas.some(([k, v]) => semAcentos(k) === 'sempre' && v === true)) {
    return { sempre: true, semana: Array.from({ length: 7 }, () => []) };
  }
  const semana: Intervalo[][] = Array.from({ length: 7 }, () => []);
  const comDias = entradas
    .map(([k, v]) => ({ dias: diasDaChave(k), v }))
    .filter((e) => e.dias.length > 0)
    // Primeiro os intervalos de dias, depois os dias sozinhos (sobrepõem-se).
    .sort((a, b) => b.dias.length - a.dias.length);
  for (const { dias, v } of comDias) {
    const intervalos = lerIntervalos(v);
    if (intervalos === null) continue;
    for (const d of dias) semana[d] = [];
    for (const [i, f] of intervalos) {
      for (const d of dias) {
        if (f > i) {
          semana[d].push([i, f]);
        } else {
          // Atravessa a meia-noite (ex.: 20:00-02:00): o resto é no dia seguinte.
          semana[d].push([i, 1440]);
          if (f > 0) semana[(d + 1) % 7].push([0, f]);
        }
      }
    }
  }
  for (const d of semana) d.sort((a, b) => a[0] - b[0]);
  return semana.some((d) => d.length > 0) ? { sempre: false, semana } : null;
}

// ---------------------------------------------------------------------------
// Fuso horário: o servidor corre em UTC, o horário é na hora do município.
// ---------------------------------------------------------------------------

export interface PartesLocais {
  /** 'YYYY-MM-DD' no fuso. */
  dia: string;
  /** 0 = domingo. */
  semana: number;
  /** Minutos desde as 0h, no fuso. */
  minutos: number;
}

const formatos = new Map<string, Intl.DateTimeFormat>();

function formato(fuso: string): Intl.DateTimeFormat {
  let f = formatos.get(fuso);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatos.set(fuso, f);
  }
  return f;
}

export function partesLocais(em: Date, fuso: string): PartesLocais {
  const p = Object.fromEntries(
    formato(fuso)
      .formatToParts(em)
      .map((x) => [x.type, x.value]),
  );
  const dia = `${p.year}-${p.month}-${p.day}`;
  return {
    dia,
    semana: new Date(`${dia}T12:00:00Z`).getUTCDay(),
    minutos: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** Diferença (ms) entre a hora de parede no fuso e UTC, no instante `t`. */
function desvio(t: number, fuso: string): number {
  const p = partesLocais(new Date(t), fuso);
  const [a, m, d] = p.dia.split('-').map(Number);
  return Date.UTC(a, m - 1, d, 0, p.minutos) - Math.floor(t / 60000) * 60000;
}

/** O instante em que é `minutos` do `dia` no fuso (acerta a hora de verão). */
export function instanteLocal(
  dia: string,
  minutos: number,
  fuso: string,
): Date {
  const [a, m, d] = dia.split('-').map(Number);
  const parede = Date.UTC(a, m - 1, d, 0, minutos);
  const t = parede - desvio(parede, fuso);
  return new Date(parede - desvio(t, fuso));
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

export function estaAberto(
  h: Horario,
  em: Date,
  fuso: string,
  feriados: ReadonlySet<string>,
): boolean {
  if (h.sempre) return true;
  const p = partesLocais(em, fuso);
  if (feriados.has(p.dia)) return false;
  return h.semana[p.semana].some(([i, f]) => p.minutos >= i && p.minutos < f);
}

/**
 * Início do próximo período de atendimento. Se está aberto agora, é `em`
 * (o atendimento já está a decorrer); senão, a próxima abertura que não
 * calhe em feriado.
 */
export function proximaAbertura(
  h: Horario,
  em: Date,
  fuso: string,
  feriados: ReadonlySet<string>,
): Date {
  if (estaAberto(h, em, fuso, feriados)) return em;
  const agora = partesLocais(em, fuso);
  // Um ano chega: um horário sem nenhum dia aberto nunca chega aqui (lerHorario dá null).
  for (let k = 0; k <= 366; k++) {
    const dia = somarDias(agora.dia, k);
    if (feriados.has(dia)) continue;
    const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
    for (const [i] of h.semana[semana]) {
      if (k === 0 && i <= agora.minutos) continue;
      return instanteLocal(dia, i, fuso);
    }
  }
  throw new Error('Horário sem nenhum período aberto.');
}

/**
 * Prazo de resposta de uma passagem a funcionário: o dia útil a seguir ao do
 * próximo atendimento, às 12h. Ligou terça às 10h (aberto) → quarta às 12h,
 * "amanhã às 12h"; ligou sexta às 20h → abre segunda → terça às 12h. O
 * funcionário tem sempre pelo menos uma manhã de serviço inteira para ver.
 */
export function prazoResposta(
  proximoAtendimento: Date,
  fuso: string,
  feriados: ReadonlySet<string>,
): Date {
  const { dia } = partesLocais(proximoAtendimento, fuso);
  return instanteLocal(somarDiasUteis(dia, 1, feriados), 12 * 60, fuso);
}

const NOMES_DIAS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** Para dizer ao telefone: 'hoje às 15h', 'amanhã às 12h', 'terça-feira às 9h30', 'dia 3 de novembro às 12h'. */
export function quandoPorExtenso(
  alvo: Date,
  agora: Date,
  fuso: string,
): string {
  const a = partesLocais(alvo, fuso);
  const hoje = partesLocais(agora, fuso).dia;
  const dias = Math.round(
    (Date.parse(`${a.dia}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) /
      86_400_000,
  );
  const h = Math.floor(a.minutos / 60);
  const m = a.minutos % 60;
  const hora = m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  const quando =
    dias === 0
      ? 'hoje'
      : dias === 1
        ? 'amanhã'
        : dias > 1 && dias < 7
          ? NOMES_DIAS[a.semana]
          : `dia ${Number(a.dia.slice(8))} de ${MESES[Number(a.dia.slice(5, 7)) - 1]}`;
  return `${quando} às ${hora}`;
}

/** O jsonb do horário em texto curto para o modelo e o painel. */
export function horarioPorExtenso(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const entradas = Object.entries(json as Record<string, unknown>);
  if (entradas.some(([k, v]) => semAcentos(k) === 'sempre' && v === true)) {
    return '24 horas, todos os dias';
  }
  const partes = entradas.flatMap(([k, v]) => {
    const texto = Array.isArray(v)
      ? v.filter((x) => typeof x === 'string').join(', ')
      : v === false || v === null
        ? 'fechado'
        : typeof v === 'string'
          ? v
          : null;
    // Valores que não se percebem ficam de fora em vez de '[object Object]'.
    return texto ? [`${k} ${texto.replace(/\s*,\s*/g, ' e ')}`] : [];
  });
  return partes.length ? partes.join('; ') : null;
}
