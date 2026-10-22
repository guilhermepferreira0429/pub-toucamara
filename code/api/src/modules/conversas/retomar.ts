import { z } from 'zod';
import type { WebhookTranscricao } from './elevenlabs.js';

/*
 * "Retomar a conversa": quem volta a ligar (ou a escrever) não tem de
 * repetir tudo. No início da chamada o ElevenLabs pede-nos as variáveis
 * dinâmicas (conversation initiation client data webhook):
 * https://elevenlabs.io/docs/agents-platform/customization/personalization/twilio-personalization
 *
 * Pedido: POST com caller_id, agent_id, called_number, call_sid e
 * conversation_id. Resposta: { type: 'conversation_initiation_client_data',
 * dynamic_variables: {...} }, com todas as variáveis que o agente usa (o
 * ElevenLabs recusa a chamada se faltar alguma), por isso vão sempre, mesmo
 * vazias. As mesmas variáveis voltam no webhook do fim da chamada
 * (conversation_initiation_client_data.dynamic_variables): é por aí que a
 * conversa nova fica ligada à anterior (continuacao_de), sem guardar nada
 * entre o início e o fim.
 */

/** Só se retoma a conversa dos últimos 30 dias. */
export const JANELA_RETOMAR_DIAS = 30;

/** Resumo lido ao agente: curto, para caber numa frase falada. */
export const MAX_RESUMO_CURTO = 280;

/** Pendentes ditos no início da chamada, no máximo. */
export const MAX_PENDENTES = 3;

export const esquemaInicioChamada = z
  .object({
    caller_id: z.string().nullish(),
    agent_id: z.string().nullish(),
    called_number: z.string().nullish(),
    call_sid: z.string().nullish(),
    conversation_id: z.string().nullish(),
  })
  .loose();

export type PedidoInicioChamada = z.infer<typeof esquemaInicioChamada>;

/** As variáveis dinâmicas que o prompt do agente pode usar ({{nome}}). */
/** O aviso de gravação dito na primeira mensagem da linha (variável {{aviso_gravacao}}). */
export const AVISO_GRAVACAO =
  'Esta chamada é gravada para a câmara poder confirmar o que lhe foi dito; se não quiser, diga-me.';

export interface VariaveisInicio {
  /**
   * Vai sempre no webhook de início: o ElevenLabs recusa a chamada se a
   * primeira mensagem tiver uma variável que não chegou. No browser a web
   * manda-o vazio (a pessoa aceitou a gravação no ecrã).
   */
  aviso_gravacao: string;
  nome_municipe: string;
  ja_ligou: 'sim' | 'nao';
  ultima_conversa_quando: string;
  ultima_conversa_resumo: string;
  pendentes: string;
  ultima_conversa_id: string;
}

export const VARIAVEIS_VAZIAS: VariaveisInicio = {
  aviso_gravacao: AVISO_GRAVACAO,
  nome_municipe: '',
  ja_ligou: 'nao',
  ultima_conversa_quando: '',
  ultima_conversa_resumo: '',
  pendentes: '',
  ultima_conversa_id: '',
};

export interface UltimaConversa {
  id: string;
  iniciada_em: Date;
  resultado: string;
  resumo: string | null;
  resumo_sms: string | null;
}

/** A última conversa serve de contexto? Dos últimos 30 dias e sem ser emergência. */
export function serveDeContexto(
  c: Pick<UltimaConversa, 'iniciada_em' | 'resultado'> | null,
  agora: Date,
): boolean {
  if (!c || c.resultado === 'emergencia') return false;
  return (
    agora.getTime() - c.iniciada_em.getTime() <=
    JANELA_RETOMAR_DIAS * 86_400_000
  );
}

/** Primeiro nome, para o agente cumprimentar ("Olá, Maria"). */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * O texto para o munícipe (resumo_sms) se já houver; senão o resumo do
 * painel, cortado no fim de uma frase. Numa linha só.
 */
export function resumoCurto(
  resumoSms: string | null | undefined,
  resumo: string | null | undefined,
  max = MAX_RESUMO_CURTO,
): string {
  const texto = (resumoSms?.trim() || resumo?.trim() || '').replace(
    /\s+/g,
    ' ',
  );
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  const fimFrase = corte.lastIndexOf('. ');
  if (fimFrase >= max / 2) return corte.slice(0, fimFrase + 1);
  const espaco = corte.lastIndexOf(' ');
  return `${corte.slice(0, espaco > 0 ? espaco : max).replace(/[,;:]$/, '')}…`;
}

// ---------------------------------------------------------------------
// Datas faladas
// ---------------------------------------------------------------------

const DIAS = [
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

interface Partes {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

function partes(d: Date, fuso: string): Partes {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: fuso,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return {
    ano: v('year'),
    mes: v('month'),
    dia: v('day'),
    hora: v('hour'),
    minuto: v('minute'),
  };
}

/** Dias de calendário (no fuso do município) de `a` até `b`. */
function diasEntre(a: Partes, b: Partes): number {
  return Math.round(
    (Date.UTC(b.ano, b.mes - 1, b.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) /
      86_400_000,
  );
}

function diaSemana(p: Partes): string {
  const d = DIAS[new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay()];
  // "no sábado", "no domingo"; "na segunda-feira"…
  return `${d === 'sábado' || d === 'domingo' ? 'no' : 'na'} ${d}`;
}

function periodo(hora: number): string {
  if (hora < 6) return 'de madrugada';
  if (hora < 12) return 'de manhã';
  if (hora < 20) return 'à tarde';
  return 'à noite';
}

/** '10h', '15h30', com o artigo certo: 'à 1h', 'às 10h'. */
function horaFalada(p: Partes): string {
  const h = `${p.hora}h${p.minuto ? String(p.minuto).padStart(2, '0') : ''}`;
  return `${p.hora === 1 ? 'à' : 'às'} ${h}`;
}

/**
 * Quando foi, como se diz ao telefone: 'há pouco', 'hoje de manhã', 'ontem
 * à tarde', 'na terça-feira', 'a 3 de outubro'. Dias contados no fuso do
 * município.
 */
export function quandoFalado(data: Date, agora: Date, fuso: string): string {
  const d = partes(data, fuso);
  const a = partes(agora, fuso);
  const dias = diasEntre(d, a);
  if (dias <= 0) {
    return agora.getTime() - data.getTime() < 3_600_000
      ? 'há pouco'
      : `hoje ${periodo(d.hora)}`;
  }
  if (dias === 1) return `ontem ${periodo(d.hora)}`;
  if (dias < 7) return diaSemana(d);
  return `a ${d.dia} de ${MESES[d.mes - 1]}${d.ano !== a.ano ? ` de ${d.ano}` : ''}`;
}

/** Para marcações: 'hoje às 15h30', 'amanhã às 10h', 'na quinta-feira às 9h'. */
export function quandoFuturoFalado(
  data: Date,
  agora: Date,
  fuso: string,
): string {
  const d = partes(data, fuso);
  const dias = diasEntre(partes(agora, fuso), d);
  const hora = horaFalada(d);
  if (dias <= 0) return `hoje ${hora}`;
  if (dias === 1) return `amanhã ${hora}`;
  if (dias < 7) return `${diaSemana(d)} ${hora}`;
  return `a ${d.dia} de ${MESES[d.mes - 1]} ${hora}`;
}

// ---------------------------------------------------------------------
// Pendentes
// ---------------------------------------------------------------------

export type Pendente =
  | { tipo: 'marcacao'; inicio: Date; agenda: string }
  | {
      tipo: 'requerimento';
      estado: 'pronto' | 'a_preencher';
      nome: string;
    }
  | { tipo: 'documentos'; processo: string; documentos: string[] }
  | { tipo: 'ocorrencia'; numero: string; categoria: string };

function prioridade(p: Pendente): number {
  switch (p.tipo) {
    case 'marcacao':
      return 0;
    case 'requerimento':
      return p.estado === 'pronto' ? 1 : 3;
    case 'documentos':
      return 2;
    case 'ocorrencia':
      return 4;
  }
}

function frase(p: Pendente, agora: Date, fuso: string): string {
  switch (p.tipo) {
    case 'marcacao':
      return `tem marcação ${quandoFuturoFalado(p.inicio, agora, fuso)} (${p.agenda})`;
    case 'requerimento':
      return p.estado === 'pronto'
        ? `o requerimento de ${p.nome} está por assinar`
        : `o requerimento de ${p.nome} está por completar`;
    case 'documentos': {
      const docs = p.documentos.slice(0, 2).join(' e ');
      return `faltam documentos no processo ${p.processo}${docs ? ` (${docs}${p.documentos.length > 2 ? ', entre outros' : ''})` : ''}`;
    }
    case 'ocorrencia':
      return `a ocorrência ${p.numero} (${p.categoria}) ainda está em aberto`;
  }
}

/**
 * Uma frase curta com o que está pendente, o mais urgente primeiro
 * (marcação próxima, requerimento por assinar, documentos em falta,
 * requerimento por completar, ocorrência aberta). No máximo 3; '' se nada.
 */
export function frasePendentes(
  lista: Pendente[],
  agora: Date,
  fuso: string,
  max = MAX_PENDENTES,
): string {
  const frases = [...lista]
    .sort((a, b) => prioridade(a) - prioridade(b))
    .slice(0, max)
    .map((p) => frase(p, agora, fuso));
  if (frases.length === 0) return '';
  const texto =
    frases.length === 1
      ? frases[0]
      : `${frases.slice(0, -1).join('; ')}; e ${frases[frases.length - 1]}`;
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}.`;
}

// ---------------------------------------------------------------------

/** As variáveis dinâmicas do início da chamada. Todas strings, sempre presentes. */
export function variaveisInicio(args: {
  nome: string | null;
  ultima: UltimaConversa | null;
  pendentes: Pendente[];
  agora: Date;
  fuso: string;
}): VariaveisInicio {
  const v: VariaveisInicio = {
    ...VARIAVEIS_VAZIAS,
    nome_municipe: primeiroNome(args.nome),
    pendentes: frasePendentes(args.pendentes, args.agora, args.fuso),
  };
  const u = args.ultima;
  if (u && serveDeContexto(u, args.agora)) {
    v.ja_ligou = 'sim';
    v.ultima_conversa_id = u.id;
    v.ultima_conversa_quando = quandoFalado(
      u.iniciada_em,
      args.agora,
      args.fuso,
    );
    v.ultima_conversa_resumo = resumoCurto(u.resumo_sms, u.resumo);
  }
  return v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A conversa anterior que demos ao agente no início (volta no fim da chamada). */
export function anteriorDaChamada(
  d: WebhookTranscricao['data'],
): string | null {
  const v =
    d.conversation_initiation_client_data?.dynamic_variables?.[
      'ultima_conversa_id'
    ];
  return typeof v === 'string' && UUID.test(v.trim()) ? v.trim() : null;
}
