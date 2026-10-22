"use client";

import { useMemo } from "react";
import { MapaCidade } from "@/components/mapa/mapa-cidade";
import type { FormaMapa, PontoMapa as PontoCidade } from "@/components/mapa/tipos";
import { COR_CATEGORIA, type Ponto } from "./tipos";

/*
 * Mapa das zonas do PDM (MapaCidade: Mapbox com token, com a zona em
 * destaque levantada no 3D; senão Leaflet + OpenStreetMap), com pontos por
 * cima. Só corre no browser: importa-se com next/dynamic e ssr: false.
 */

export interface ZonaMapa {
  codigo: string;
  nome: string;
  categoria: string;
  poligono: Ponto[];
}

export interface PontoMapa {
  id: string;
  lat: number;
  lng: number;
  cor: string;
  rotulo: string;
}

export default function MapaZonas({
  zonas,
  pontos = [],
  destacar,
  enquadrar,
  className,
}: {
  zonas: ZonaMapa[];
  pontos?: PontoMapa[];
  /** Código da zona em destaque (as outras ficam esbatidas). */
  destacar?: string | null;
  /** O que enquadrar à entrada; por omissão todas as zonas. */
  enquadrar?: Ponto[];
  className?: string;
}) {
  const formas = useMemo<FormaMapa[]>(
    () =>
      zonas.map((z) => ({
        id: z.codigo,
        tipo: "poligono",
        pontos: z.poligono.map(([lat, lng]) => ({ lat, lng })),
        cor: COR_CATEGORIA[z.categoria] ?? "#555555",
        preenchimento: 0.22,
        esbatida: !!destacar && destacar !== z.codigo,
        altura_m: destacar === z.codigo || zonas.length === 1 ? 24 : undefined,
        rotulo: z.nome,
      })),
    [zonas, destacar],
  );
  const pts = useMemo<PontoCidade[]>(() => pontos.map((p) => ({ ...p })), [pontos]);
  const todos = useMemo(
    () => (enquadrar ?? zonas.flatMap((z) => z.poligono)).map(([lat, lng]) => ({ lat, lng })),
    [enquadrar, zonas],
  );
  return (
    <MapaCidade
      rotulo="Mapa das zonas do plano"
      className={className}
      formas={formas}
      pontos={pts}
      enquadrar={todos}
      enquadrarUmaVez
      vista="inclinado"
      rodaRato={false}
      controlos={{ zoom: true, vista3d: true, posicao: "direita-baixo" }}
    />
  );
}
