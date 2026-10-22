/** Partilhado pelo mapa (só browser) e pelas páginas: sem importar o Leaflet. */

export type Ponto = [number, number];

export const COR_CATEGORIA: Record<string, string> = {
  urbano: "#c4502c",
  protecao: "#7a4cc2",
  agricola: "#3f8f4e",
  florestal: "#2f6f5e",
};

export const CATEGORIA_ROTULO: Record<string, string> = {
  urbano: "Urbano",
  protecao: "Proteção do património",
  agricola: "Agrícola",
  florestal: "Florestal",
};

export type Controlo = "isento" | "comunicacao_previa" | "licenca" | "nao_permitido";

export interface Degrau {
  controlo: Controlo;
  area_max_m2?: number;
  altura_max_m?: number;
}

export interface RegraObra {
  degraus: Degrau[];
  acima: Controlo;
  notas: string[];
}

export interface Zona {
  id: string;
  codigo: string;
  nome: string;
  categoria: string;
  descricao: string | null;
  poligono: Ponto[];
  regras: Record<string, RegraObra>;
  fonte: { titulo: string; artigo: string | null; url: string | null };
  demonstracao: boolean;
  /** Perguntas feitas nesta zona nos últimos 5 anos (as que a simulação usa). */
  perguntas: { total: number; demonstracao: number };
}

export const CONTROLO: Record<Controlo, { rotulo: string; cor: string; tom: "verde" | "terracota" | "ambar" | "tinta" }> =
  {
    isento: { rotulo: "isento", cor: "#3f8f4e", tom: "verde" },
    comunicacao_previa: { rotulo: "comunicação prévia", cor: "#c98a12", tom: "ambar" },
    licenca: { rotulo: "licença", cor: "#c4502c", tom: "terracota" },
    nao_permitido: { rotulo: "não permitido", cor: "#1b2a3a", tom: "tinta" },
  };
