/*
 * Balcão para empresas: os tipos que espelham a API
 * (code/api/src/modules/empresas/balcao-empresas.regras.ts).
 */

export type Atividade =
  | "restauracao"
  | "comercio"
  | "cabeleireiro_estetica"
  | "alojamento_local"
  | "oficina"
  | "servicos"
  | "eventos";

export type Flag =
  | "esplanada"
  | "publicidade"
  | "obras"
  | "musica"
  | "eventos_rua"
  | "ocupacao_via"
  | "horario_alargado"
  | "vende_alimentos"
  | "atendimento_publico"
  | "centro_historico";

export interface Perfil extends Partial<Record<Flag, boolean>> {
  atividade?: Atividade;
  fase?: "abrir" | "aberta";
  abertura?: string;
  area_esplanada_m2?: number;
  area_publicidade_m2?: number;
  publicidade_iluminada?: boolean;
  area_obra_m2?: number;
}

export interface DefPergunta {
  campo: Flag;
  rotulo: string;
  pergunta: string;
  /** null = a todas as atividades. */
  atividades: Atividade[] | null;
  tambem_se: Flag[];
  so_se: Flag[];
}

export interface Perguntas {
  municipio: string;
  atividades: { valor: Atividade; rotulo: string }[];
  perguntas: DefPergunta[];
}

/** A pergunta aparece para este perfil? (a mesma lógica da API) */
export function mostrar(q: DefPergunta, p: Perfil): boolean {
  if (!p.atividade) return false;
  if (q.so_se.length) return q.so_se.some((f) => p[f] === true);
  return (
    q.atividades === null ||
    q.atividades.includes(p.atividade) ||
    q.tambem_se.some((f) => p[f] === true)
  );
}

export type Periodicidade = "unica" | "anual" | "por_evento" | "continua";

export interface TaxaEstimada {
  total_cent: number | null;
  texto: string;
  demonstracao: boolean;
  fonte: string | null;
}

export type Como =
  | { tipo: "agente"; ferramenta: string; frase: string }
  | { tipo: "link"; url: string }
  | { tipo: "camara" }
  | { tipo: "fora" };

export interface ItemLista {
  chave: string;
  titulo: string;
  o_que_e: string;
  porque: string[];
  onde: "camara" | "fora";
  entidade: string;
  como: Como;
  url: string | null;
  prazo: string;
  antecedencia: { dias: number; uteis: boolean } | null;
  periodicidade: Periodicidade;
  periodicidade_texto: string;
  estado: "por_tratar" | "confirmar";
  tipo_licenca: string | null;
  taxa: TaxaEstimada | null;
  fonte: { titulo: string; url: string | null };
  demonstracao: boolean;
}

export interface Lista {
  itens: ItemLista[];
  demonstracao: boolean;
  na_camara: number;
  fora_da_camara: number;
}

export interface EventoCalendario {
  id: string;
  data: string;
  tipo: "renovar" | "expira" | "evento" | "tratar" | "abertura";
  titulo: string;
  descricao: string;
  licenca: string | null;
  taxa_cent: number | null;
  demonstracao: boolean;
}

export interface Lembrete {
  titulo: string;
  texto: string;
  periodicidade: Periodicidade | "pagar";
}

export interface Calendario {
  eventos: EventoCalendario[];
  lembretes: Lembrete[];
}

/** GET /v1/public/empresas/listas/:codigo */
export interface PaginaLista {
  codigo: string;
  tipo: "lista" | "obrigacoes";
  municipio: string;
  titular: string | null;
  perfil: Perfil;
  atividade: string | null;
  lista: Lista | null;
  calendario: Calendario;
  valores_de_demonstracao: boolean;
  link: string;
  ics: string;
  criada_em: string;
}

/** "terça, 24 de novembro de 2026" (dias sem hora contam ao meio-dia). */
export function diaPorExtenso(d: string): string {
  return new Intl.DateTimeFormat("pt-PT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${d}T12:00:00`));
}

/** "com 5 dias úteis de antecedência" (ou ""). */
export function antecedenciaDita(a: ItemLista["antecedencia"]): string {
  if (!a || a.dias === 0) return "";
  const u = a.uteis ? (a.dias === 1 ? "dia útil" : "dias úteis") : a.dias === 1 ? "dia" : "dias";
  return `com ${a.dias} ${u} de antecedência`;
}
