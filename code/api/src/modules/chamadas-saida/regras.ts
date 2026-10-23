/*
 * Regras puras das chamadas de saída: quando o agente pode ligar, a que
 * horas, quantas vezes e o que leva nas variáveis dinâmicas. Sem BD, para
 * testar à parte.
 *
 * Decisões (ver também o README do módulo no relatório):
 * - Só liga se a câmara ativou esse motivo e indicou o número de saída.
 * - Munícipe com telefone português móvel (9…) ou fixo (2…), ou estrangeiro
 *   válido; nunca números de tarifa especial (7…, 8…).
 * - `aceita_chamadas = false` nunca é ligado (nem à mão).
 * - Canal preferido: 'telefone' liga sempre; sem preferência só liga para
 *   pedido de documento, lembrete de prazo e antecipação (há algo a fazer
 *   da parte dele e uma chamada ajuda); uma mudança de fase sem preferência vai por SMS.
 *   Quem prefere SMS ou email nunca é ligado automaticamente. A chamada
 *   manual ("ligar agora") é decisão do técnico: ignora a preferência.
 * - Só em dias úteis (feriados do município incluídos) das 10h às 19h no
 *   fuso do município; fora disso agenda para o próximo período.
 * - Uma chamada por munícipe por dia (as 2 tentativas do mesmo aviso não
 *   contam como outra): se já há uma nesse dia, ou uma por fazer, o aviso
 *   novo vai logo por SMS em vez de esperar.
 * - 2 tentativas por aviso, com 2 h de intervalo; à 2.ª não atendida vai o
 *   SMS de recurso (o mesmo texto que iria sem chamada).
 */
import { z } from 'zod';
import { eDiaUtil, Feriados } from '../../common/dias-uteis.js';

export const MOTIVOS_CHAMADA = [
  'processo_fase',
  'pedido_documento',
  'lembrete_prazo',
  'manual',
  // Campanhas de contacto (ação social): agendadas pelo módulo campanhas,
  // sem passar por `decidirChamada` (só a quem se inscreveu).
  'campanha',
  // Licença a expirar (módulo licencas): só a quem prefere telefone.
  'renovacao_licenca',
  // Um momento antecipado (módulo antecipacoes): prazo a acabar, audiência
  // prévia, caducidade... só nos importantes ou a quem não tem a app.
  'antecipacao',
] as const;
export type MotivoChamada = (typeof MOTIVOS_CHAMADA)[number];

export const ESTADOS_CHAMADA = [
  'agendada',
  'a_ligar',
  'atendida',
  'nao_atendida',
  'falhou',
  'cancelada',
] as const;
export type EstadoChamada = (typeof ESTADOS_CHAMADA)[number];

export const HORA_INICIO = 10;
export const HORA_FIM = 19;
export const MAX_TENTATIVAS = 2;
export const INTERVALO_TENTATIVAS_MS = 2 * 3_600_000;
/** Sem resultado do ElevenLabs ao fim disto, conta como falhada. */
export const SEM_RESULTADO_MS = 30 * 60_000;

/** `agente_config.chamadas_saida`. */
export const esquemaConfigChamadas = z.object({
  ativo: z.boolean(),
  motivos: z.array(z.enum(MOTIVOS_CHAMADA)).max(MOTIVOS_CHAMADA.length),
  /** agent_phone_number_id do ElevenLabs (o número de onde sai a chamada). */
  numero_id: z.string().trim().min(1).max(200).nullable(),
  via: z.enum(['twilio', 'sip_trunk']).default('twilio'),
});
export type ConfigChamadas = z.output<typeof esquemaConfigChamadas>;

export const CONFIG_DESLIGADA: ConfigChamadas = {
  ativo: false,
  motivos: [],
  numero_id: null,
  via: 'twilio',
};

/** Lê o jsonb guardado; o que não se perceber conta como desligado. */
export function lerConfig(v: unknown): ConfigChamadas {
  const r = esquemaConfigChamadas.safeParse(v);
  return r.success ? r.data : CONFIG_DESLIGADA;
}

/** Pode ligar-se para este número? (E.164 já normalizado.) */
export function telefoneLigavel(e164: string | null | undefined): boolean {
  if (!e164 || !/^\+\d{8,15}$/.test(e164)) return false;
  if (e164.startsWith('+351')) return /^\+351[29]\d{8}$/.test(e164);
  return true;
}

// ---------------------------------------------------------------------
// Horas no fuso do município
// ---------------------------------------------------------------------

interface Local {
  dia: string;
  hora: number;
  minuto: number;
}

export function local(d: Date, fuso: string): Local {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    dia: `${v('year')}-${v('month')}-${v('day')}`,
    hora: Number(v('hour')),
    minuto: Number(v('minute')),
  };
}

/** O instante em que são `hora`:00 do dia `dia` no fuso. */
export function instanteLocal(dia: string, hora: number, fuso: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  const alvo = Date.UTC(a, m - 1, d, hora);
  let t = alvo;
  // Duas passagens chegam para acertar a mudança de hora.
  for (let i = 0; i < 2; i++) {
    const l = local(new Date(t), fuso);
    const [la, lm, ld] = l.dia.split('-').map(Number);
    const visto = Date.UTC(la, lm - 1, ld, l.hora, l.minuto);
    t += alvo - visto;
  }
  return new Date(t);
}

function diaSeguinte(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** `em` cai num período em que se pode ligar? */
export function dentroDaJanela(
  em: Date,
  fuso: string,
  feriados: Feriados,
): boolean {
  const l = local(em, fuso);
  return (
    eDiaUtil(l.dia, feriados) && l.hora >= HORA_INICIO && l.hora < HORA_FIM
  );
}

/** `em`, se já se pode ligar; senão o início do próximo período (dia útil às 10h). */
export function proximaJanela(
  em: Date,
  fuso: string,
  feriados: Feriados,
): Date {
  if (dentroDaJanela(em, fuso, feriados)) return em;
  const l = local(em, fuso);
  let dia = l.dia;
  if (!(eDiaUtil(dia, feriados) && l.hora < HORA_INICIO)) {
    dia = diaSeguinte(dia);
    for (let i = 0; i < 30 && !eDiaUtil(dia, feriados); i++) {
      dia = diaSeguinte(dia);
    }
  }
  return instanteLocal(dia, HORA_INICIO, fuso);
}

/** Depois de uma tentativa não atendida: 2 h depois, dentro do período. */
export function proximaTentativa(
  agora: Date,
  fuso: string,
  feriados: Feriados,
): Date {
  return proximaJanela(
    new Date(agora.getTime() + INTERVALO_TENTATIVAS_MS),
    fuso,
    feriados,
  );
}

// ---------------------------------------------------------------------
// Pode ligar?
// ---------------------------------------------------------------------

export type MotivoSemChamada =
  | 'desligado'
  | 'motivo_desligado'
  | 'sem_numero_saida'
  | 'sem_telefone'
  | 'recusa_chamadas'
  | 'canal_preferido'
  | 'ja_tem_chamada'
  | 'ja_ligado_nesse_dia';

export type Decisao =
  { liga: true; agendarPara: Date } | { liga: false; motivo: MotivoSemChamada };

export const TEXTO_SEM_CHAMADA: Record<MotivoSemChamada, string> = {
  desligado: 'As chamadas de saída não estão ativas neste município.',
  motivo_desligado: 'As chamadas de saída não estão ativas para este motivo.',
  sem_numero_saida: 'Falta indicar o número de saída do ElevenLabs.',
  sem_telefone: 'O munícipe não tem um telefone para onde se possa ligar.',
  recusa_chamadas: 'O munícipe pediu para não ser ligado.',
  canal_preferido: 'O munícipe prefere outro canal.',
  ja_tem_chamada: 'Já há uma chamada por fazer a este munícipe.',
  ja_ligado_nesse_dia: 'Este munícipe já tem uma chamada nesse dia.',
};

/** Motivos que ligam a quem não disse como prefere ser contactado. */
const LIGA_SEM_PREFERENCIA: readonly MotivoChamada[] = [
  'pedido_documento',
  'lembrete_prazo',
  'antecipacao',
];

export function decidirChamada(e: {
  config: ConfigChamadas;
  motivo: MotivoChamada;
  municipe: {
    telefone: string | null;
    aceita_chamadas: boolean;
    preferido: string | null;
  };
  /** Chamada pedida no painel ("ligar agora"). */
  manual?: boolean;
  /** Só a equipa interna: ignora o horário (demonstrações). */
  forcarHorario?: boolean;
  /** Há uma chamada deste munícipe por fazer ('agendada' ou 'a_ligar')? */
  temPendente: boolean;
  /** Dias locais ('AAAA-MM-DD') em que este munícipe já foi ligado. */
  diasLigados: ReadonlySet<string>;
  agora: Date;
  fuso: string;
  feriados: Feriados;
}): Decisao {
  const nao = (motivo: MotivoSemChamada): Decisao => ({ liga: false, motivo });
  if (!e.config.ativo) return nao('desligado');
  if (!e.manual && !e.config.motivos.includes(e.motivo))
    return nao('motivo_desligado');
  if (!e.config.numero_id) return nao('sem_numero_saida');
  if (!telefoneLigavel(e.municipe.telefone)) return nao('sem_telefone');
  if (!e.municipe.aceita_chamadas) return nao('recusa_chamadas');
  if (!e.manual) {
    const p = e.municipe.preferido;
    const aceita =
      p === 'telefone' ||
      (p == null && LIGA_SEM_PREFERENCIA.includes(e.motivo));
    if (!aceita) return nao('canal_preferido');
  }
  if (e.temPendente) return nao('ja_tem_chamada');
  const agendarPara = e.forcarHorario
    ? e.agora
    : proximaJanela(e.agora, e.fuso, e.feriados);
  // A manual é uma decisão de uma pessoa: não conta o limite diário.
  if (!e.manual && e.diasLigados.has(local(agendarPara, e.fuso).dia))
    return nao('ja_ligado_nesse_dia');
  return { liga: true, agendarPara };
}

/** Depois de uma tentativa sem resposta: volta a ligar ou desiste (SMS). */
export function aposNaoAtendida(
  tentativas: number,
  agora: Date,
  fuso: string,
  feriados: Feriados,
): { repetir: true; em: Date } | { repetir: false } {
  if (tentativas >= MAX_TENTATIVAS) return { repetir: false };
  return { repetir: true, em: proximaTentativa(agora, fuso, feriados) };
}

// ---------------------------------------------------------------------
// Variáveis dinâmicas
// ---------------------------------------------------------------------

/** O que fica em `chamadas_saida.contexto` e o agente diz. */
export interface ContextoChamada {
  numero_processo: string;
  o_que_mudou: string;
  o_que_falta: string;
  prazo: string;
  link: string;
  nota: string;
  /** Só nas campanhas: o que perguntar e onde gravar a resposta. */
  campanha?: { id: string; destinatario_id: string; perguntas: string[] };
}

/**
 * As variáveis próprias da chamada de saída. O prompt é um só: nas chamadas
 * que o munícipe faz vão vazias (VARIAVEIS_SAIDA_VAZIAS), porque o
 * ElevenLabs recusa a chamada se faltar alguma das que o prompt usa.
 */
export interface VariaveisSaida {
  tipo_chamada: 'entrada' | 'saida';
  motivo: string;
  numero_processo: string;
  o_que_mudou: string;
  o_que_falta: string;
  prazo: string;
  link: string;
  chamada_saida_id: string;
}

export const VARIAVEIS_SAIDA_VAZIAS: VariaveisSaida = {
  tipo_chamada: 'entrada',
  motivo: '',
  numero_processo: '',
  o_que_mudou: '',
  o_que_falta: '',
  prazo: '',
  link: '',
  chamada_saida_id: '',
};

/** O motivo como o agente o pode dizer. */
export const MOTIVO_FALADO: Record<MotivoChamada, string> = {
  processo_fase: 'o processo avançou',
  pedido_documento: 'falta um documento',
  lembrete_prazo: 'o prazo para entregar um documento está a terminar',
  manual: 'o técnico pediu para falar consigo sobre o processo',
  campanha:
    'a câmara está a ligar às pessoas inscritas para saber se está tudo bem',
  renovacao_licenca:
    'a sua licença está quase a expirar e pode renová-la já nesta chamada',
  antecipacao:
    'a câmara quer avisá-lo de uma data importante antes que seja tarde',
};

/**
 * A primeira frase de uma chamada da câmara: quem fala, porque liga e o
 * aviso de gravação. Quem atende não ligou, por isso não se pergunta
 * "em que posso ajudar?".
 */
export function primeiraFraseSaida(p: {
  nomeAgente: string | null;
  municipio: string;
  motivo: MotivoChamada;
  numeroProcesso?: string | null;
  aviso: string;
}): string {
  const nome = p.nomeAgente?.trim() || 'Tou, Câmara?';
  const motivo = MOTIVO_FALADO[p.motivo];
  const n = p.numeroProcesso?.trim();
  const sobre = !n
    ? motivo
    : motivo.endsWith('o processo')
      ? `${motivo} ${n}`
      : `${motivo}, no processo ${n}`;
  return `Olá, daqui fala o assistente ${nome} da Câmara Municipal de ${p.municipio}. Estou a ligar porque ${sobre}. ${p.aviso}`;
}

export function variaveisSaida(
  id: string,
  motivo: MotivoChamada,
  c: Partial<ContextoChamada>,
): VariaveisSaida {
  return {
    tipo_chamada: 'saida',
    motivo: MOTIVO_FALADO[motivo],
    numero_processo: c.numero_processo ?? '',
    o_que_mudou: [c.o_que_mudou, c.nota].filter(Boolean).join(' '),
    o_que_falta: c.o_que_falta ?? '',
    prazo: c.prazo ?? '',
    link: c.link ?? '',
    chamada_saida_id: id,
  };
}
