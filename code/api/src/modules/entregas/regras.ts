import { createHash } from 'crypto';

/*
 * Entregar o pedido em nome da pessoa: as regras sem BD (estados, resumo
 * confirmado, identidade, expiração, número de entrada de demonstração).
 */

export const ESTADOS = [
  'preparado',
  'a_espera_autorizacao',
  'autorizado',
  'entregue',
  'falhou',
  'expirado',
  'cancelado',
] as const;
export type EstadoEntrega = (typeof ESTADOS)[number];

/** Estados em que a entrega ainda conta (uma por requerimento: índice único na BD). */
export const ESTADOS_VIVOS: readonly EstadoEntrega[] = [
  'preparado',
  'a_espera_autorizacao',
  'autorizado',
  'entregue',
  'falhou',
];

export const ESTADO_ROTULO: Record<EstadoEntrega, string> = {
  preparado: 'Preparado',
  a_espera_autorizacao: 'À espera de autorização',
  autorizado: 'Autorizado',
  entregue: 'Entregue',
  falhou: 'Falhou',
  expirado: 'Expirou',
  cancelado: 'Cancelado',
};

/** As passagens permitidas. Tudo o resto é recusado. */
const TRANSICOES: Record<EstadoEntrega, readonly EstadoEntrega[]> = {
  preparado: ['a_espera_autorizacao', 'cancelado'],
  a_espera_autorizacao: ['autorizado', 'expirado', 'cancelado'],
  autorizado: ['entregue', 'falhou'],
  // Falhou depois de autorizado: tenta-se outra vez sem nova autorização.
  falhou: ['entregue', 'falhou', 'cancelado'],
  entregue: [],
  expirado: [],
  cancelado: [],
};

export function podePassar(de: EstadoEntrega, para: EstadoEntrega): boolean {
  return TRANSICOES[de].includes(para);
}

export function final(e: EstadoEntrega): boolean {
  return TRANSICOES[e].length === 0;
}

/** Validade do link de autorização por omissão (decisão de produto, não legal). */
export const VALIDADE_HORAS_OMISSAO = 24;
/** PIN errado mais vezes do que isto e o link deixa de aceitar tentativas. */
export const MAX_TENTATIVAS_AUTENTICACAO = 5;
/** O pedido de autenticação (state) só vale uns minutos, como no OIDC do painel. */
export const AUTENTICACAO_MINUTOS = 10;

export function validadeHoras(valor: string | undefined): number {
  const n = Number(valor);
  return Number.isFinite(n) && n >= 1 && n <= 24 * 7
    ? Math.floor(n)
    : VALIDADE_HORAS_OMISSAO;
}

/** O link passou da validade enquanto esperava pela pessoa. */
export function expirou(
  estado: EstadoEntrega,
  expiraEm: Date,
  agora: Date,
): boolean {
  return (
    (estado === 'preparado' || estado === 'a_espera_autorizacao') &&
    expiraEm.getTime() <= agora.getTime()
  );
}

/** O estado como a pessoa e o painel o devem ver (expira sem precisar de job). */
export function estadoEfetivo(
  estado: EstadoEntrega,
  expiraEm: Date,
  agora: Date,
): EstadoEntrega {
  return expirou(estado, expiraEm, agora) ? 'expirado' : estado;
}

// --------------------------------------------------------------- resumo

export interface ResumoPedido {
  tipo: { codigo: string; nome: string };
  requerente: string | null;
  campos: { rotulo: string; valor: string }[];
  documentos: { entregues: string[]; em_falta: string[] };
}

/**
 * A marca de uma versão do pedido: o agente lê o resumo, a pessoa confirma,
 * e o código volta na segunda chamada. Se o pedido (tipo, requerente,
 * dados) mudar entretanto, o código já não bate certo e é preciso confirmar
 * de novo. Os documentos ficam de fora: entregar mais um documento pelo
 * link não muda o que a pessoa pediu.
 */
export function codigoResumo(r: ResumoPedido): string {
  const canonico = JSON.stringify([
    r.tipo.codigo,
    r.requerente,
    r.campos.map((c) => [c.rotulo, c.valor]),
  ]);
  return createHash('sha256').update(canonico).digest('hex').slice(0, 10);
}

/** O resumo numa frase para o agente ler em voz alta. */
export function resumoFalado(r: ResumoPedido): string {
  const campos = r.campos.map((c) => `${c.rotulo}: ${c.valor}`).join('; ');
  const falta = r.documentos.em_falta.length
    ? ` Ainda falta entregar: ${r.documentos.em_falta.join(', ')}.`
    : '';
  return `Pedido de ${r.tipo.nome}${r.requerente ? `, em nome de ${r.requerente}` : ''}. ${campos}.${falta}`;
}

// ------------------------------------------------------------- confirmação

/**
 * As palavras com que a pessoa confirmou têm de ser uma confirmação: um
 * "não", "espere" ou "não sei" não chega para entregar em nome dela.
 */
export function confirmacaoClara(palavras: string): boolean {
  const t = palavras
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return false;
  if (/\b(nao|espere|espera|depois|talvez|duvida|cancel\w*|pare)\b/.test(t))
    return false;
  return /\b(sim|confirmo|confirma|pode|autorizo|esta certo|certo|correto|claro|ok|okay|de acordo|avance|avancar|entregue|entregar|yes)\b/.test(
    t,
  );
}

// --------------------------------------------------------------- identidade

export type NivelGarantia = 'simulado' | 'baixo' | 'substancial' | 'elevado';

export interface IdentidadeCidadao {
  /** NIF devolvido pelo fornecedor de autenticação (só em memória, nunca guardado em claro). */
  nif: string | null;
  nome: string | null;
  nivel_garantia: NivelGarantia;
  /** 'simulacao' | 'autenticacao.gov' */
  fornecedor: string;
  simulada: boolean;
}

/** '******789': o suficiente para a pessoa se reconhecer, nada mais. */
export function mascararNif(nif: string | null): string | null {
  if (!nif) return null;
  const d = nif.replace(/\D/g, '');
  return d.length < 4 ? '***' : `${'*'.repeat(d.length - 3)}${d.slice(-3)}`;
}

/** '+351 9•• ••• 567'. */
export function mascararTelefone(tel: string | null): string | null {
  if (!tel) return null;
  const d = tel.replace(/[^\d+]/g, '');
  if (d.length < 6) return '•••';
  return `${d.slice(0, d.startsWith('+') ? 5 : 1)}•• ••• ${d.slice(-3)}`;
}

export type ResultadoConfere =
  | { ok: true; nif_confirmado: boolean }
  | { ok: false; codigo: 'sem_nif' | 'outra_pessoa'; mensagem: string };

/**
 * Quem se autenticou é o requerente? Com NIF na câmara tem de ser o mesmo
 * (comparado por hash, fora daqui: `mesmoNif`); sem NIF na câmara aceita-se
 * o NIF da autenticação, que fica registado na auditoria (mascarado).
 */
export function confereIdentidade(
  id: Pick<IdentidadeCidadao, 'nif'>,
  requerente: { tem_nif: boolean; mesmoNif: boolean | null },
): ResultadoConfere {
  if (!id.nif) {
    return {
      ok: false,
      codigo: 'sem_nif',
      mensagem:
        'A autenticação não devolveu o NIF: não é possível confirmar quem é o requerente.',
    };
  }
  if (requerente.tem_nif && requerente.mesmoNif !== true) {
    return {
      ok: false,
      codigo: 'outra_pessoa',
      mensagem:
        'Quem se autenticou não é o requerente deste pedido. Só o próprio pode autorizar a entrega.',
    };
  }
  return { ok: true, nif_confirmado: requerente.tem_nif };
}

// ------------------------------------------------------------- numeração

/** 'DEMO-2026/000123': o número de entrada da simulação, à vista que é de demonstração. */
export function numeroEntradaDemo(ano: number, n: number): string {
  return `DEMO-${ano}/${String(n).padStart(6, '0')}`;
}

/** Erros externos cabem numa linha do painel. */
export function mensagemErro(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/\s+/g, ' ').trim().slice(0, 500) || 'Erro desconhecido.';
}

/** O aviso que acompanha tudo o que é simulado (página, PDF, SMS, painel). */
export const AVISO_SIMULACAO =
  'Simulação — sem validade legal. A entrega real só depois da credenciação na AMA (Chave Móvel Digital) e do acesso ao balcão online.';
