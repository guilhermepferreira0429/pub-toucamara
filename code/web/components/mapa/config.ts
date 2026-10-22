/*
 * Configuração dos mapas (docs/MAPAS.md). O token é o PÚBLICO do Mapbox
 * (começa por "pk."), restringido aos domínios da demo no dashboard do
 * Mapbox; nunca fica no git. Sem token (ou com um que não seja público),
 * todos os mapas usam o Leaflet + OpenStreetMap, como antes.
 */

const TOKEN = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();
const ESTILO = (process.env.NEXT_PUBLIC_MAPBOX_ESTILO ?? "").trim();

/** Os estilos que conhecemos pelo nome curto (NEXT_PUBLIC_MAPBOX_ESTILO). */
export const ESTILOS = {
  /** Mapbox Standard: edifícios 3D, iluminação de dia, cores ajustáveis. */
  standard: "mapbox://styles/mapbox/standard",
  /** Standard Satellite: imagem de satélite com as estradas e nomes por cima. */
  "standard-satellite": "mapbox://styles/mapbox/standard-satellite",
} as const;

/** O token público do Mapbox, ou null (usa-se o Leaflet). */
export function tokenMapbox(): string | null {
  return TOKEN.startsWith("pk.") ? TOKEN : null;
}

/** Há Mapbox? (Senão, Leaflet + OpenStreetMap.) */
export function temMapbox(): boolean {
  return tokenMapbox() !== null;
}

/** O URL do estilo: nome curto, URL mapbox:// completo, ou o Standard. */
export function estiloMapbox(pedido?: string | null): string {
  const v = (pedido ?? ESTILO).trim();
  if (!v) return ESTILOS.standard;
  if (v in ESTILOS) return ESTILOS[v as keyof typeof ESTILOS];
  if (v.startsWith("mapbox://styles/") || v.startsWith("https://")) return v;
  return ESTILOS.standard;
}

/** O estilo é da família Standard (aceita a config "basemap": luz, cores)? */
export function eStandard(url: string): boolean {
  return url.startsWith("mapbox://styles/mapbox/standard");
}

/** Guimarães (centro histórico): o centro quando não há nada para enquadrar. */
export const CENTRO_OMISSAO = { lat: 41.4425, lng: -8.2918 } as const;

/** Inclinação e rotação da vista 3D (oblíqua) e da vista de trabalho. */
export const VISTA_3D = { pitch: 58, bearing: -17 } as const;
export const VISTA_INCLINADA = { pitch: 30, bearing: 0 } as const;
export const VISTA_2D = { pitch: 0, bearing: 0 } as const;

/**
 * O Standard com as cores da marca (config "basemap"). Só se aplicam as
 * propriedades que o estilo conhece; as outras ignoram-se (ver aplicarConfig).
 */
export const CONFIG_STANDARD: Record<string, string | boolean> = {
  lightPreset: "day",
  show3dObjects: true,
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  colorGreenspace: "#cfe0c3",
  colorWater: "#a9c7d8",
  colorMotorways: "#e9b9a1",
  colorTrunks: "#f0cdb6",
  colorRoads: "#fffbf5",
  colorBuildingHighlight: "#d9784f",
  colorBuildingSelect: "#b84a24",
  colorPlaceLabelHighlight: "#8e3517",
};
