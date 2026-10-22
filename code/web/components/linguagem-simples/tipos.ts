/*
 * Tipos da linguagem simples e do glossário. Espelham
 * code/api/src/modules/linguagem-simples (regras.ts e os serviços).
 */

export type TipoDocumento = "edital" | "regulamento" | "aviso" | "deliberacao" | "lei" | "outro";

export const TIPOS_DOCUMENTO: Record<TipoDocumento, string> = {
  edital: "Edital",
  regulamento: "Regulamento",
  aviso: "Aviso",
  deliberacao: "Deliberação",
  lei: "Lei",
  outro: "Outro",
};

export type Chave =
  | "o_que_e"
  | "a_quem_se_aplica"
  | "o_que_tem_de_fazer"
  | "ate_quando"
  | "quanto_custa"
  | "onde"
  | "outro";

export const TITULOS_CHAVE: Record<Chave, string> = {
  o_que_e: "O que é",
  a_quem_se_aplica: "A quem se aplica",
  o_que_tem_de_fazer: "O que tem de fazer",
  ate_quando: "Até quando",
  quanto_custa: "Quanto custa",
  onde: "Onde tratar",
  outro: "Mais informação",
};

export type EstadoDocumento = "sem_versao" | "rascunho" | "publicada" | "desatualizada";

export interface Parte {
  chave: Chave;
  titulo: string;
  texto: string;
  seccoes: string[];
  trechos?: string[];
}

export interface Seccao {
  id: string;
  referencia: string | null;
  texto: string;
  trechos?: string[];
}

export interface Original {
  versao_id: string;
  vigor_desde: string;
  lida_em: string;
  seccoes: Seccao[];
}

export interface VersaoSimples {
  id: string;
  numero: number;
  fonte_versao_id: string;
  estado: string;
  origem: "ia" | "extrativo" | "manual";
  titulo: string;
  resumo: string;
  partes: Parte[];
  criada_em: string;
  criada_por_nome: string | null;
  editada_em: string | null;
  revista_por_nome: string | null;
  publicada_em: string | null;
  desatualizada: boolean;
}

export interface Documento {
  id: string;
  codigo: string;
  tipo: TipoDocumento;
  link: string | null;
  fonte: { id: string; titulo: string; url: string; tipo: string; entidade: string };
  versao_atual_id: string | null;
  estado: EstadoDocumento;
  ia_disponivel: boolean;
  rascunho: VersaoSimples | null;
  publicada: VersaoSimples | null;
  historico: {
    id: string;
    numero: number;
    estado: string;
    origem: string;
    fonte_versao_id: string;
    criada_em: string;
    criada_por_nome: string | null;
    revista_por_nome: string | null;
    publicada_em: string | null;
  }[];
  originais: Record<string, Original>;
  aviso_legal: string;
}

export interface ItemLista {
  fonte_id: string;
  titulo: string;
  fonte_tipo: string;
  url: string;
  entidade: string;
  estado_fonte: string;
  tem_texto: boolean;
  documento_id: string | null;
  codigo: string | null;
  tipo: TipoDocumento | null;
  estado: EstadoDocumento;
  link: string | null;
  publicada: { id: string; numero: number; publicada_em: string } | null;
  rascunho: { id: string; numero: number; origem: string; criada_em: string } | null;
}

export interface Lista {
  itens: ItemLista[];
  resumo: { publicadas: number; desatualizadas: number; rascunhos: number };
}

export interface Termo {
  id: string;
  termo: string;
  variantes: string[];
  explicacao: string;
  exemplo: string | null;
  fonte_legal: string | null;
  demonstracao: boolean;
  ativo: boolean;
  atualizado_em: string;
}

/** Onde aparece um termo do glossário num texto ([inicio, fim)). */
export interface Marca {
  inicio: number;
  fim: number;
  termo_id: string;
}

export interface TermoPublico {
  id: string;
  termo: string;
  explicacao: string;
  exemplo: string | null;
  demonstracao: boolean;
}

export interface DocumentoPublico {
  codigo: string;
  municipio: string;
  tipo: TipoDocumento;
  titulo: string;
  fonte: { titulo: string; url: string; entidade: string };
  simples: {
    titulo: string;
    resumo: { texto: string; termos: Marca[] };
    partes: { chave: Chave; titulo: string; texto: string; seccoes: string[]; termos: Marca[] }[];
    origem: string;
    publicada_em: string;
    revista: boolean;
    desatualizada: boolean;
    versao_oficial_do_resumo: string | null;
  };
  original: {
    versao_id: string;
    vigor_desde: string;
    lida_em: string;
    seccoes: { id: string; referencia: string | null; texto: string; termos: Marca[] }[];
  };
  glossario: TermoPublico[];
  aviso_legal: string;
}
