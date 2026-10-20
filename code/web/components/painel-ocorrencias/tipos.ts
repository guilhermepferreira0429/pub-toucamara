/* Formatos da API das ocorrências (code/api/src/modules/ocorrencias). */

export type EstadoOcorrencia =
  | "nova"
  | "com_equipa"
  | "resolvida"
  | "duplicada"
  | "rejeitada";

export const ESTADO_ROTULO: Record<EstadoOcorrencia, string> = {
  nova: "Nova",
  com_equipa: "Com a equipa",
  resolvida: "Resolvida",
  duplicada: "Duplicada",
  rejeitada: "Rejeitada",
};

/** Cores dos pins e da legenda (tokens do design). */
export const ESTADO_COR: Record<EstadoOcorrencia, string> = {
  nova: "#b84a24",
  com_equipa: "#8a5a00",
  resolvida: "#3f6e4a",
  duplicada: "#7d8794",
  rejeitada: "#7d8794",
};

/** pg devolve numeric como texto: converter antes de usar. */
export type Coordenada = number | string | null;

export interface Pin {
  id: string;
  numero: string;
  lat: Coordenada;
  lng: Coordenada;
  estado: EstadoOcorrencia;
  categoria_id: string;
  categoria: string;
  icone: string | null;
  criada_em: string;
  duplicados: number;
}

export interface OcorrenciaLista extends Pin {
  descricao: string | null;
  morada: string | null;
  servico_id: string | null;
  servico: string | null;
  prevista_para: string | null;
  resolvida_em: string | null;
  duplicada_de: string | null;
  fotos: number;
}

export interface EventoOcorrencia {
  id: string;
  tipo: string;
  ator_tipo: string;
  ator_id: string | null;
  ator_nome: string | null;
  dados: Record<string, unknown> | null;
  em: string;
}

export interface OcorrenciaDetalhe {
  id: string;
  numero: string;
  estado: EstadoOcorrencia;
  descricao: string | null;
  morada: string | null;
  lat: Coordenada;
  lng: Coordenada;
  categoria_id: string;
  categoria: string;
  icone: string | null;
  servico_id: string | null;
  servico: string | null;
  prevista_para: string | null;
  criada_em: string;
  resolvida_em: string | null;
  conversa_id: string | null;
  duplicada_de: string | null;
  duplicada_de_numero: string | null;
  municipe_id: string | null;
  municipe_nome: string | null;
  municipe_telefone: string | null;
  reportes: number;
  eventos: EventoOcorrencia[];
  fotos: { id: string; enviada_em: string; url: string | null }[];
  duplicados: {
    id: string;
    numero: string;
    descricao: string | null;
    morada: string | null;
    criada_em: string;
    conversa_id: string | null;
    municipe_telefone: string | null;
  }[];
  avisados?: number;
}

export interface CategoriaOcorrencia {
  id: string;
  nome: string;
  icone: string | null;
  servico_id: string | null;
  servico: string | null;
  abertas: number;
}

export interface ResumoOcorrencias {
  dias: number;
  ocorrencias: number | null;
  abertas: number | null;
  resolvidas: number | null;
  por_estado: { estado: EstadoOcorrencia; total: number }[];
}

export function num(c: Coordenada): number | null {
  if (c === null || c === undefined || c === "") return null;
  const n = typeof c === "number" ? c : Number(c);
  return Number.isFinite(n) ? n : null;
}
