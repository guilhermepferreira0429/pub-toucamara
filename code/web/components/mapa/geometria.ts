import type { FormaMapa, LatLng } from "./tipos";

/*
 * Contas pequenas partilhadas pelos dois motores (sem dependências).
 */

const RAIO_TERRA_M = 6_371_008.8;

/** Um círculo (centro + raio em metros) como polígono de `passos` lados. */
export function circuloParaPoligono(centro: LatLng, raio_m: number, passos = 64): LatLng[] {
  const lat1 = (centro.lat * Math.PI) / 180;
  const lng1 = (centro.lng * Math.PI) / 180;
  const d = raio_m / RAIO_TERRA_M;
  const pontos: LatLng[] = [];
  for (let i = 0; i <= passos; i++) {
    const b = (2 * Math.PI * i) / passos;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
    const lng2 =
      lng1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    pontos.push({ lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI });
  }
  return pontos;
}

/** Os pontos do contorno de uma forma (para enquadrar e desenhar). */
export function contorno(f: FormaMapa): LatLng[] {
  return f.tipo === "poligono" ? f.pontos : circuloParaPoligono(f.centro, f.raio_m);
}

/** O "oeste,sul,este,norte" do ?bbox= da API. */
export function bboxTexto(oeste: number, sul: number, este: number, norte: number): string {
  const f = (n: number) => n.toFixed(5);
  return `${f(oeste)},${f(sul)},${f(este)},${f(norte)}`;
}

/** A caixa [[oeste, sul], [este, norte]] de uma lista de pontos. */
export function caixa(pontos: LatLng[]): [[number, number], [number, number]] | null {
  if (!pontos.length) return null;
  let o = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of pontos) {
    o = Math.min(o, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [
    [o, s],
    [e, n],
  ];
}

/** Uma chave estável de uma lista de pontos (para saber se mudou). */
export function chavePontos(pontos: LatLng[] | undefined): string {
  return (pontos ?? []).map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join(";");
}

/** A pessoa pediu menos movimento ao sistema? (Câmara sem animação.) */
export function menosMovimento(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Ecrã de toque (para os gestos cooperativos por omissão). */
export function eToque(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

/** Pede a localização ao browser (fica só em memória). */
export function pedirLocalizacao(): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("indisponivel"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED ? "recusado" : "indisponivel")),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  });
}
