/*
 * Tipos das consultas públicas. Espelham code/api/src/modules/consultas-publicas
 * (regras.ts e o service).
 */

export type Situacao = "rascunho" | "agendada" | "aberta" | "terminou" | "fechada";

export interface Opcao {
  id: string;
  texto: string;
}

export interface Pergunta {
  id: string;
  texto: string;
  opcoes: Opcao[];
}

export interface ResultadoPergunta {
  id: string;
  texto: string;
  opcoes: { id: string; texto: string; n: number; pct: number }[];
  por_freguesia: {
    freguesia: string;
    abrangida: boolean;
    total: number;
    opcoes: Record<string, number>;
  }[];
}

export interface Resultados {
  total: number;
  freguesias: { freguesia: string; abrangida: boolean; participacoes: number }[];
  perguntas: ResultadoPergunta[];
}

export interface ResumoConsulta {
  id: string;
  codigo: string;
  titulo: string;
  estado: "rascunho" | "aberta" | "fechada";
  situacao: Situacao;
  abre_em: string;
  fecha_em: string;
  relatorio_em: string;
  freguesias: string[] | null;
  participacoes: number;
  criada_em: string;
  criada_por_nome: string | null;
}

export interface ListaConsultas {
  consultas: ResumoConsulta[];
  freguesias_conhecidas: string[];
}

export interface Tema {
  tema: string;
  descricao: string;
  opinioes: number;
  tom: "a_favor" | "contra" | "misto" | "duvidas";
  exemplos?: string[];
}

export interface ResumoOpinioes {
  ia: boolean;
  motivo_sem_ia?: string;
  opinioes: number;
  palavras: { palavra: string; n: number }[];
  por_opcao: { opcao: string; opinioes: number }[];
  sintese?: string;
  temas?: Tema[];
}

export interface DetalheConsulta {
  id: string;
  codigo: string;
  titulo: string;
  resumo: string;
  documento_titulo: string | null;
  documento_url: string | null;
  perguntas: Pergunta[];
  pergunta_aberta: string | null;
  freguesias: string[] | null;
  abre_em: string;
  fecha_em: string;
  relatorio_em: string;
  estado: "rascunho" | "aberta" | "fechada";
  situacao: Situacao;
  participacoes: number;
  criada_em: string;
  aberta_em: string | null;
  fechada_em: string | null;
  criada_por_nome: string | null;
  link: string;
  resultados: Resultados;
  populacao: null;
  por_canal: Record<string, number>;
  opinioes: {
    dia: string;
    freguesia: string | null;
    canal: string;
    respostas: Record<string, string | null>;
    opiniao: string;
  }[];
  total_opinioes: number;
  resumo_opinioes: ResumoOpinioes | null;
  resumo_gerado_em: string | null;
  resumo_desatualizado: boolean;
  ia_disponivel: boolean;
  campanhas: {
    id: string;
    titulo: string;
    estado: string;
    criada_em: string;
    destinatarios: number;
  }[];
}

export const SITUACOES: Record<
  Situacao,
  { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro" | "tinta" }
> = {
  rascunho: { rotulo: "rascunho", tom: "neutro" },
  agendada: { rotulo: "abre em breve", tom: "ambar" },
  aberta: { rotulo: "aberta", tom: "verde" },
  terminou: { rotulo: "prazo terminado", tom: "tinta" },
  fechada: { rotulo: "fechada", tom: "tinta" },
};

export const CANAIS: Record<string, string> = {
  telefone: "Telefone",
  chat: "Chat",
  ia: "Assistente de IA",
  pagina: "Página",
  sms: "SMS",
};

/** Cores das opções nas barras (até 6 opções). */
export const CORES_OPCOES = [
  "bg-verde",
  "bg-terracota",
  "bg-ambar",
  "bg-tinta",
  "bg-tinta-3",
  "bg-terracota-escuro",
];
