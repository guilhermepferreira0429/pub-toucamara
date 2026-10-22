/*
 * App da equipa de campo: as tarefas do dia (visitas de fiscalização e
 * ocorrências do serviço) e a ordem por proximidade. Sem BD, para testar à
 * parte.
 */

export interface Ponto {
  lat: number;
  lng: number;
}

/** Distância em linha reta (haversine), em metros. */
export function distanciaMetros(a: Ponto, b: Ponto): number {
  const R = 6_371_000;
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

export interface TarefaBase {
  id: string;
  lat: number | null;
  lng: number | null;
  /** Já feita hoje (visita feita, ocorrência resolvida): vai para o fim. */
  feita: boolean;
  numero: string;
}

/**
 * Por fazer primeiro, da mais perto para a mais longe (sem coordenadas no
 * fim das por fazer); depois as já feitas. Sem localização do telemóvel
 * fica a ordem do número. Devolve cópias com `distancia_m`.
 */
export function ordenarPorProximidade<T extends TarefaBase>(
  tarefas: T[],
  origem: Ponto | null,
): (T & { distancia_m: number | null })[] {
  const comDistancia = tarefas.map((t) => ({
    ...t,
    distancia_m:
      origem && t.lat != null && t.lng != null
        ? distanciaMetros(origem, { lat: t.lat, lng: t.lng })
        : null,
  }));
  return comDistancia.sort((a, b) => {
    if (a.feita !== b.feita) return a.feita ? 1 : -1;
    const da = a.distancia_m ?? Number.POSITIVE_INFINITY;
    const db = b.distancia_m ?? Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return a.numero.localeCompare(b.numero, 'pt');
  });
}

/** "350 m", "1,2 km" — como a app mostra. */
export function distanciaLegivel(m: number | null): string | null {
  if (m == null) return null;
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toLocaleString('pt-PT', { maximumFractionDigits: 1 })} km`;
}
