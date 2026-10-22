/*
 * SMS de entrada: o que a pessoa quer e a resposta (sem BD, para testar à
 * parte). As respostas são curtas: cada 160 caracteres (70 com acentos) é
 * um SMS pago.
 */
import { transliterar } from '../comunicacao/sms.js';
import { lerNumero } from '../processos/regras.js';

/** O que a pessoa pede ao feed "o que se passa perto de mim". */
export const INTENCOES_AGORA = [
  'obras',
  'avisos',
  'eventos',
  'incidentes',
] as const;
export type IntencaoAgora = (typeof INTENCOES_AGORA)[number];

export type Intencao = 'estado' | 'parar' | 'ajuda' | IntencaoAgora | 'avisar';

/** No máximo isto por número e por hora (resposta a cada SMS custa). */
export const MAXIMO_POR_HORA = 6;

const PARAR =
  /^\/?\s*(parar|stop|sair|cancelar|nao quero avisos|não quero avisos)\.?$/i;
const ESTADO = /\b(estado|processo|pedido|licen[cç]a)\b/i;

/** "OBRAS", "obra", "/incidentes", "Eventos!" — a palavra sozinha. */
const PALAVRA_AGORA = /^\/?\s*(obras?|avisos?|eventos?|incidentes?)\s*[.!]?$/i;

/** "AVISAR OBRAS", "/avisar eventos e obras", "avise-me". */
const AVISAR = /^\/?\s*(avisar|avise-?me|avisa-?me)\b(.*)$/i;

function semAcentos(t: string): string {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

export function intencao(corpo: string): Intencao {
  const t = corpo.trim().replace(/\s+/g, ' ');
  if (PARAR.test(t)) return 'parar';
  if (AVISAR.test(semAcentos(t))) return 'avisar';
  const p = PALAVRA_AGORA.exec(semAcentos(t));
  if (p) {
    const w = p[1];
    if (w.startsWith('obra')) return 'obras';
    if (w.startsWith('aviso')) return 'avisos';
    if (w.startsWith('evento')) return 'eventos';
    return 'incidentes';
  }
  if (ESTADO.test(t) || (/\d/.test(t) && lerNumero(t))) return 'estado';
  return 'ajuda';
}

export function eIntencaoAgora(i: Intencao): i is IntencaoAgora {
  return (INTENCOES_AGORA as readonly string[]).includes(i);
}

/** Os tipos de "AVISAR ...": as palavras que vierem; nenhuma = todos. */
export function tiposAvisar(corpo: string): IntencaoAgora[] {
  const resto = AVISAR.exec(semAcentos(corpo.trim()))?.[2] ?? '';
  const tipos = new Set<IntencaoAgora>();
  for (const w of resto.split(/[^a-z]+/)) {
    if (w.startsWith('obra')) tipos.add('obras');
    else if (w.startsWith('aviso')) tipos.add('avisos');
    else if (w.startsWith('evento')) tipos.add('eventos');
    else if (w.startsWith('incidente')) tipos.add('incidentes');
  }
  return tipos.size ? [...tipos] : [...INTENCOES_AGORA];
}

/**
 * A resposta a "Responda com o nome da sua rua ou freguesia" parece uma
 * morada? (Não um número de processo nem uma palavra-chave.)
 */
export function pareceMorada(corpo: string): boolean {
  const t = corpo.trim();
  if (t.length < 3 || t.length > 150 || !/\p{L}{3,}/u.test(t)) return false;
  if (/^[a-z]{1,5}[\s.-]*\d+\s*\/\s*\d{2,4}$/i.test(t)) return false;
  if (ESTADO.test(t)) return false;
  return true;
}

/** O número do processo, se vier no SMS ("CP 12/2026", "estado 12/2026"). */
export function numeroNoSms(corpo: string): string | undefined {
  return /\d/.test(corpo) ? corpo.trim() : undefined;
}

export interface ResultadoEstado {
  precisa_identificacao?: boolean;
  encontrado?: boolean;
  mensagem?: string;
  processos?: { resumo: string }[];
  processos_da_pessoa?: string[];
}

export function respostaEstado(
  r: ResultadoEstado,
  linha: string | null,
): string {
  const ligar = linha ? ` Ligue para ${linha}.` : '';
  if (r.precisa_identificacao) {
    return `Por SMS só damos o estado dos processos associados a este número.${ligar || ' Contacte a câmara.'}`;
  }
  if (!r.encontrado) {
    const outros = r.processos_da_pessoa?.length
      ? ` Os seus processos: ${r.processos_da_pessoa.slice(0, 3).join(', ')}.`
      : '';
    return `${r.mensagem ?? 'Não encontrámos esse processo.'}${outros}`;
  }
  const resumos = (r.processos ?? []).slice(0, 2).map((p) => p.resumo);
  return `${resumos.join(' ')}${ligar ? ` Dúvidas?${ligar}` : ''}`;
}

export function respostaAjuda(municipio: string, linha: string | null): string {
  return (
    `Câmara de ${municipio}: para saber o estado de um processo, envie o número (ex.: CP 12/2026).` +
    ' O que se passa perto de si: envie OBRAS, AVISOS, EVENTOS ou INCIDENTES; para ser avisado, AVISAR OBRAS.' +
    ` Para deixar de receber avisos, envie PARAR.${linha ? ` Para o resto, ligue ${linha}.` : ''}`
  );
}

// ---------------------------------------------------------------------
// "O que se passa perto de mim" por SMS (1–2 SMS, sem acentos: GSM-7)
// ---------------------------------------------------------------------

/** 2 SMS em GSM-7. */
export const MAX_RESPOSTA = 306;

const NOMES: Record<IntencaoAgora, string> = {
  obras: 'obras e cortes',
  avisos: 'avisos',
  eventos: 'eventos',
  incidentes: 'incidentes',
};

export interface ResultadoAgora {
  itens?: { sms: string }[];
  local?: { descricao: string } | null;
  link?: string;
}

/**
 * "CM Guimaraes - obras e cortes perto de Rua Direita: 1) ...; 2) ...;
 * 3) ... Tudo: <link>". Os 3 itens mais perto; se não couber em 2 SMS,
 * menos itens.
 */
export function respostaAgora(
  municipio: string,
  qual: IntencaoAgora,
  r: ResultadoAgora,
): string {
  const d = r.local?.descricao;
  const onde = d
    ? /^freguesia /i.test(d)
      ? ` na ${d}`
      : ` perto de ${d}`
    : '';
  const tudo = r.link ? ` Tudo: ${r.link}` : '';
  const itens = (r.itens ?? []).slice(0, 3).map((i) => i.sms);
  if (!itens.length) {
    return transliterar(
      `CM ${municipio}: nao ha ${NOMES[qual]} registados${onde}.${tudo}`,
    );
  }
  for (let n = itens.length; n >= 1; n--) {
    const lista = itens
      .slice(0, n)
      .map((t, k) => `${k + 1}) ${t.replace(/[.;]+$/, '')}`)
      .join('; ');
    const t = transliterar(
      `CM ${municipio} - ${NOMES[qual]}${onde}: ${lista}.${tudo}`,
    );
    if (t.length <= MAX_RESPOSTA) return t;
  }
  const t = transliterar(
    `CM ${municipio} - ${NOMES[qual]}${onde}: 1) ${itens[0]}`,
  );
  return `${t.slice(0, MAX_RESPOSTA - tudo.length - 4).trimEnd()}...${tudo}`;
}

export function respostaPedirMorada(municipio: string): string {
  return transliterar(
    `CM ${municipio}: para lhe dizer o que se passa perto de si, responda com o nome da sua rua ou freguesia (sem numero de porta).`,
  );
}

export function respostaMoradaNaoEncontrada(
  municipio: string,
  dito: string,
): string {
  const d = dito.trim().slice(0, 60);
  return transliterar(
    `CM ${municipio}: nao encontramos "${d}". Responda com o nome da sua rua ou freguesia (ex.: Rua Direita, Azurem).`,
  );
}

export interface ResultadoAvisar {
  subscrito?: boolean;
  tipos?: string[];
  zona?: string;
}

export function respostaAvisar(municipio: string, r: ResultadoAvisar): string {
  const tipos = (r.tipos ?? [])
    .map((t) => NOMES[t as IntencaoAgora] ?? t)
    .join(', ');
  return transliterar(
    `CM ${municipio}: combinado, avisamos por SMS quando houver ${tipos} novos em ${r.zona ?? 'sua zona'}. So das 9h as 21h, salvo emergencias. Para deixar de receber, envie PARAR.`,
  ).slice(0, MAX_RESPOSTA);
}
