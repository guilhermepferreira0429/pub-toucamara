/*
 * Água e saneamento (V4 #6): regras puras. O que é urgente, o que se diz e
 * que contacto da entidade gestora dar em cada caso.
 */
import type { TipoPedidoAgua } from './integracao-vimagua.js';

export const TIPOS_AVARIA = ['avaria', 'rotura', 'falta_agua'] as const;
export const MOTIVOS_FATURA = ['segunda_via', 'explicacao'] as const;

export const TIPOS_DITOS: Record<TipoPedidoAgua, string> = {
  leitura: 'leitura do contador',
  fatura: 'pedido sobre a fatura',
  avaria: 'avaria',
  rotura: 'rotura',
  falta_agua: 'falta de água',
};

/** Rotura e falta de água são urgentes; qualquer caso com água na via também. */
export function eUrgente(tipo: TipoPedidoAgua, aguaNaVia: boolean): boolean {
  return aguaNaVia || tipo === 'rotura' || tipo === 'falta_agua';
}

/** Água na via pública ou perigo → também uma ocorrência na câmara. */
export function vaiParaOcorrencia(
  tipo: TipoPedidoAgua,
  aguaNaVia: boolean,
): boolean {
  return aguaNaVia && (tipo === 'rotura' || tipo === 'avaria');
}

/** A leitura dita ("1234,5 metros cúbicos"). */
export function leituraDita(m3: number): string {
  return `${m3.toLocaleString('pt-PT', { maximumFractionDigits: 3 })} metros cúbicos`;
}

export interface ContactoAgua {
  tipo: string;
  rotulo: string | null;
  valor: string;
}

export interface EntidadeAgua {
  nome: string;
  site_url: string | null;
  contactos: ContactoAgua[];
  /** Não veio dos dados do município (só o site, sem número inventado). */
  por_omissao: boolean;
}

/**
 * Quando o município ainda não tem a entidade da água nos dados: só o
 * nome e o site, sem telefone (não se inventam números).
 */
export const ENTIDADE_POR_OMISSAO: EntidadeAgua = {
  nome: 'Vimágua',
  site_url: 'https://www.vimagua.pt',
  contactos: [],
  por_omissao: true,
};

const ORDEM_AVARIAS = [
  'avarias',
  'telefone',
  'balcao',
  'email',
  'site',
  'morada',
];
const ORDEM_GERAL = [
  'telefone',
  'balcao',
  'email',
  'site',
  'avarias',
  'morada',
];

/** O contacto a dizer: linha de avarias para avarias, senão o telefone geral. */
export function contactoPara(
  e: EntidadeAgua,
  tipo: TipoPedidoAgua | null,
): ContactoAgua | null {
  const ordem =
    tipo && (TIPOS_AVARIA as readonly string[]).includes(tipo)
      ? ORDEM_AVARIAS
      : ORDEM_GERAL;
  const ordenados = [...e.contactos].sort(
    (a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo),
  );
  return ordenados[0] ?? null;
}

/** "a Vimágua: linha de avarias 800 000 000" / "a Vimágua: www.vimagua.pt". */
export function fraseContacto(
  e: EntidadeAgua,
  tipo: TipoPedidoAgua | null,
): string {
  const c = contactoPara(e, tipo);
  if (c) {
    const como =
      c.tipo === 'email'
        ? `o email ${c.valor}`
        : c.tipo === 'site'
          ? c.valor
          : c.tipo === 'morada' || c.tipo === 'balcao'
            ? `o balcão em ${c.valor}`
            : `o ${c.valor}`;
    return `${e.nome}: ${como}${c.rotulo ? ` (${c.rotulo})` : ''}`;
  }
  return e.site_url
    ? `${e.nome}: ${e.site_url.replace(/^https?:\/\//, '')}`
    : e.nome;
}
