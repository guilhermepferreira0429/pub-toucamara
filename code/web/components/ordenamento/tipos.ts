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
