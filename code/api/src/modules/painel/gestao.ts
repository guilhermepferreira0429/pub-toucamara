import type { Feriados } from '../../common/dias-uteis.js';
import { media, mediana, umaCasa } from '../perguntas-chefia/consulta.js';
import {
  Fase,
  FASE_ROTULO,
  FASES,
  FASES_FECHADAS,
} from '../processos/regras.js';

/*
 * Gestão e indicadores (V2, /v1/painel/gestao/*): as contas puras (sem BD),
 * para testar à parte. Datas 'YYYY-MM-DD' no calendário do município; dias
 * úteis como em `common/dias-uteis` (sem fins de semana nem feriados).
 */

/** As fases em que o processo ainda está a andar (as que contam aqui). */
export const FASES_EM_CURSO = FASES.filter((f) => !FASES_FECHADAS.includes(f));

/** "A acabar o prazo": até 3 dias úteis (o mesmo alerta da Visão geral). */
export const DIAS_UTEIS_A_TERMINAR = 3;

// ----------------------------------------------------------------------
// Dias úteis e percentis
// ----------------------------------------------------------------------

/** Dias desde 1970-01-01 (1970-01-01 foi uma quinta-feira). */
function numeroDia(dia: string): number {
  return Math.floor(Date.parse(`${dia}T12:00:00Z`) / 864e5);
}

/** Dias de segunda a sexta entre o dia 0 (uma segunda) e x, inclusive. */
function semanaisAte(x: number): number {
  return Math.floor((x + 1) / 7) * 5 + Math.min((x + 1) % 7, 5);
}

/**
 * Dias úteis de `de` (exclusive) até `ate` (inclusive); negativo se `ate` é
 * antes. O mesmo que `diasUteisEntre`, mas sem percorrer os dias um a um
 * (os tempos contam milhares de segmentos de cada vez).
 */
export function diasUteis(de: string, ate: string, feriados: Feriados): number {
  if (de === ate) return 0;
  if (ate < de) return -diasUteis(ate, de, feriados);
  // +3: o dia 0 passa a ser a segunda-feira 1969-12-29.
  const a = numeroDia(de) + 3;
  const b = numeroDia(ate) + 3;
  let n = semanaisAte(b) - semanaisAte(a);
  for (const f of feriados) {
    if (f > de && f <= ate) {
      const x = numeroDia(f) + 3;
      if (x % 7 < 5) n--;
    }
  }
  return n;
}

/**
 * Percentil `p` (0 a 100) com interpolação linear entre os vizinhos, como o
 * `percentile_cont` do Postgres. Sem valores: null.
 */
export function percentil(xs: readonly number[], p: number): number | null {
  if (xs.length === 0) return null;
  const o = [...xs].sort((a, b) => a - b);
  const pos = (Math.min(Math.max(p, 0), 100) / 100) * (o.length - 1);
  const i = Math.floor(pos);
  const resto = pos - i;
  return i + 1 < o.length ? o[i] + (o[i + 1] - o[i]) * resto : o[i];
}

// ----------------------------------------------------------------------
// Carga
// ----------------------------------------------------------------------

/**
 * Carga ponderada: quanto trabalho pendente tem um serviço ou um técnico,
 * num número só, para ordenar. Cada processo em curso vale 1, mais:
 *   +1     se o prazo acaba nos próximos 3 dias úteis (urgente);
 *   +2     se já está atrasado (pesa o triplo de um normal);
 *   −0,75  se a vez é do munícipe (fase documentos ou pedido por responder):
 *          o trabalho não está com a câmara, fica a valer 1/4.
 * Cada passagem de um funcionário em curso vale 0,5 e cada ocorrência aberta
 * do serviço 0,5 (são mais curtas do que um processo). Uma casa decimal.
 */
export const PESOS = {
  processo: 1,
  a_terminar: 1,
  atrasado: 2,
  aguarda_municipe: -0.75,
  passagem: 0.5,
  ocorrencia: 0.5,
} as const;

export const FORMULA_CARGA =
  'carga = abertos + 1 × a_terminar + 2 × atrasados − 0,75 × aguarda_municipe + 0,5 × passagens_em_curso + 0,5 × ocorrencias_abertas';

export interface Contagens {
  abertos: number;
  atrasados: number;
  a_terminar: number;
  aguarda_municipe: number;
  passagens_em_curso: number;
  ocorrencias_abertas: number;
}

export function cargaPonderada(c: Contagens): number {
  return (
    umaCasa(
      c.abertos * PESOS.processo +
        c.a_terminar * PESOS.a_terminar +
        c.atrasados * PESOS.atrasado +
        c.aguarda_municipe * PESOS.aguarda_municipe +
        c.passagens_em_curso * PESOS.passagem +
        c.ocorrencias_abertas * PESOS.ocorrencia,
    ) ?? 0
  );
}

/** Uma linha da consulta: processos em curso de um (serviço, técnico). */
export interface LinhaCargaBd {
  servico_id: string | null;
  tecnico_id: string | null;
  fase: Fase;
  abertos: number;
  atrasados: number;
  a_terminar: number;
  aguarda_municipe: number;
}

export interface LinhaCarga extends Contagens {
  id: string | null;
  nome: string;
  por_fase: Record<string, number>;
  carga: number;
}

function vazia(id: string | null, nome: string): LinhaCarga {
  return {
    id,
    nome,
    abertos: 0,
    por_fase: Object.fromEntries(FASES_EM_CURSO.map((f) => [f, 0])),
    atrasados: 0,
    a_terminar: 0,
    aguarda_municipe: 0,
    passagens_em_curso: 0,
    ocorrencias_abertas: 0,
    carga: 0,
  };
}

/**
 * Junta as linhas (serviço, técnico, fase) por serviço ou por técnico, com as
 * passagens e ocorrências de cada um, e ordena por carga (a maior primeiro;
 * empate pelo nome). Os de `sempre` aparecem mesmo sem nada (com zeros); a
 * linha sem id (`semNome`: "Sem serviço", "Sem técnico") só se tiver algo.
 */
export function agregarCarga(
  linhas: readonly LinhaCargaBd[],
  chave: 'servico_id' | 'tecnico_id',
  nomes: ReadonlyMap<string, string>,
  sempre: Iterable<string>,
  semNome: string,
  extra: {
    passagens?: ReadonlyMap<string | null, number>;
    ocorrencias?: ReadonlyMap<string | null, number>;
  } = {},
): LinhaCarga[] {
  const porId = new Map<string | null, LinhaCarga>();
  const linha = (id: string | null) => {
    let l = porId.get(id);
    if (!l) {
      l = vazia(id, id === null ? semNome : (nomes.get(id) ?? semNome));
      porId.set(id, l);
    }
    return l;
  };
  for (const id of sempre) linha(id);
  for (const r of linhas) {
    const l = linha(r[chave]);
    l.abertos += r.abertos;
    l.por_fase[r.fase] = (l.por_fase[r.fase] ?? 0) + r.abertos;
    l.atrasados += r.atrasados;
    l.a_terminar += r.a_terminar;
    l.aguarda_municipe += r.aguarda_municipe;
  }
  for (const [id, n] of extra.passagens ?? [])
    linha(id).passagens_em_curso += n;
  for (const [id, n] of extra.ocorrencias ?? [])
    linha(id).ocorrencias_abertas += n;
  const r = [...porId.values()].filter(
    (l) =>
      l.id !== null ||
      l.abertos + l.passagens_em_curso + l.ocorrencias_abertas > 0,
  );
  for (const l of r) l.carga = cargaPonderada(l);
  return r.sort(
    (a, b) => b.carga - a.carga || a.nome.localeCompare(b.nome, 'pt'),
  );
}

// ----------------------------------------------------------------------
// Tempos por fase
// ----------------------------------------------------------------------

/** Um segmento acabado da história das fases (mv_processos_fases_historia). */
export interface Segmento {
  processo_id: string;
  tipo_processo_id: string;
  fase: Fase;
  inicio_dia: string;
  fim_dia: string;
}

export interface TempoFase {
  fase: Fase;
  rotulo: string;
  /** Processos que passaram pela fase. */
  processos: number;
  media_dias_uteis: number | null;
  mediana_dias_uteis: number | null;
}

/**
 * Tempo em cada fase em curso: por processo, a soma dos dias úteis de todas
 * as vezes que esteve nessa fase (um processo que volta a 'documentos' soma
 * as duas idas); depois a média e a mediana entre os processos que lá
 * passaram. Fases por onde ninguém passou ficam com 0 processos e null.
 */
export function temposPorFase(
  segmentos: readonly Segmento[],
  feriados: Feriados,
): TempoFase[] {
  const porFase = new Map<Fase, Map<string, number>>();
  for (const s of segmentos) {
    if (FASES_FECHADAS.includes(s.fase)) continue;
    const m = porFase.get(s.fase) ?? new Map<string, number>();
    m.set(
      s.processo_id,
      (m.get(s.processo_id) ?? 0) +
        Math.max(0, diasUteis(s.inicio_dia, s.fim_dia, feriados)),
    );
    porFase.set(s.fase, m);
  }
  return FASES_EM_CURSO.map((fase) => {
    const dias = [...(porFase.get(fase)?.values() ?? [])];
    return {
      fase,
      rotulo: FASE_ROTULO[fase],
      processos: dias.length,
      media_dias_uteis: media(dias),
      mediana_dias_uteis: mediana(dias),
    };
  });
}

/** Um processo decidido no período. */
export interface Decidido {
  entrada: string;
  decisao: string;
  prazo_fim: string | null;
}

/**
 * Da entrada à decisão, em dias úteis: média, mediana e % decididos até ao
 * fim do prazo legal (`prazo_fim`, que só começa com o processo completo).
 * Os que nunca tiveram prazo (não chegaram a estar completos) não entram na
 * percentagem.
 */
export function resumoDecididos(ds: readonly Decidido[], feriados: Feriados) {
  const dias = ds.map((d) => diasUteis(d.entrada, d.decisao, feriados));
  const comPrazo = ds.filter((d) => d.prazo_fim);
  return {
    decididos: ds.length,
    media_dias_uteis: media(dias),
    mediana_dias_uteis: mediana(dias),
    com_prazo: comPrazo.length,
    dentro_do_prazo_pct: comPrazo.length
      ? umaCasa(
          (comPrazo.filter((d) => d.decisao <= d.prazo_fim!).length /
            comPrazo.length) *
            100,
        )
      : null,
  };
}

// ----------------------------------------------------------------------
// Onde os processos ficam parados
// ----------------------------------------------------------------------

/** O "normal" de uma fase: o percentil 75 dos dias úteis que lá ficaram. */
export const PERCENTIL_NORMAL = 75;
/** Abaixo disto o percentil do tipo não diz nada: usa-se o da fase. */
export const AMOSTRA_MINIMA = 5;
/** Sem nenhum evento há mais do que isto (dias úteis): parado. */
export const DIAS_SEM_EVENTOS = 10;
/** O histórico que conta para o "normal": segmentos acabados no último ano. */
export const DIAS_HISTORICO = 365;

export interface Referencia {
  dias_uteis: number;
  base: 'tipo' | 'fase';
  amostra: number;
}

export interface Referencias {
  porTipoFase: Map<string, Referencia>;
  porFase: Map<Fase, Referencia>;
}

const chaveTF = (tipo: string, fase: string) => `${tipo}|${fase}`;

/**
 * O percentil 75 de cada (tipo, fase) e de cada fase (todos os tipos), a
 * partir dos segmentos acabados. Só com pelo menos AMOSTRA_MINIMA segmentos.
 */
export function referencias(
  segmentos: readonly Segmento[],
  feriados: Feriados,
): Referencias {
  const tf = new Map<string, number[]>();
  const f = new Map<Fase, number[]>();
  for (const s of segmentos) {
    if (FASES_FECHADAS.includes(s.fase)) continue;
    const d = Math.max(0, diasUteis(s.inicio_dia, s.fim_dia, feriados));
    const k = chaveTF(s.tipo_processo_id, s.fase);
    tf.set(k, [...(tf.get(k) ?? []), d]);
    f.set(s.fase, [...(f.get(s.fase) ?? []), d]);
  }
  const ref = <K>(m: Map<K, number[]>, base: Referencia['base']) =>
    new Map(
      [...m]
        .filter(([, xs]) => xs.length >= AMOSTRA_MINIMA)
        .map(([k, xs]) => [
          k,
          {
            dias_uteis: umaCasa(percentil(xs, PERCENTIL_NORMAL))!,
            base,
            amostra: xs.length,
          },
        ]),
    );
  return { porTipoFase: ref(tf, 'tipo'), porFase: ref(f, 'fase') };
}

/** O normal para este tipo nesta fase: o do tipo, senão o da fase, senão nenhum. */
export function referenciaPara(
  r: Referencias,
  tipoId: string,
  fase: Fase,
): Referencia | null {
  return (
    r.porTipoFase.get(chaveTF(tipoId, fase)) ?? r.porFase.get(fase) ?? null
  );
}

export type MotivoParado = 'acima_do_normal' | 'sem_eventos';

/**
 * Parado = está na fase há mais dias úteis do que o normal (percentil 75
 * histórico do tipo nessa fase) OU não tem nenhum evento há mais de
 * DIAS_SEM_EVENTOS dias úteis. Sem histórico, só conta a segunda regra.
 */
export function motivosParado(
  diasNaFase: number,
  diasSemEventos: number,
  ref: Referencia | null,
): MotivoParado[] {
  const r: MotivoParado[] = [];
  if (ref && diasNaFase > ref.dias_uteis) r.push('acima_do_normal');
  if (diasSemEventos > DIAS_SEM_EVENTOS) r.push('sem_eventos');
  return r;
}

export interface FaseParada {
  fase: Fase;
  parados: number;
  dias_parados: number;
}

/**
 * O gargalo: a fase com mais dias úteis acumulados pelos processos parados
 * (empate: mais processos parados; depois a fase que vem primeiro). Sem
 * nenhum parado não há gargalo.
 */
export function gargalo(fases: readonly FaseParada[]): FaseParada | null {
  const ordem = (f: Fase) => FASES.indexOf(f);
  const com = fases.filter((f) => f.parados > 0);
  if (com.length === 0) return null;
  return [...com].sort(
    (a, b) =>
      b.dias_parados - a.dias_parados ||
      b.parados - a.parados ||
      ordem(a.fase) - ordem(b.fase),
  )[0];
}
