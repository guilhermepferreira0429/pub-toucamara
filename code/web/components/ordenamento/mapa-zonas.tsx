"use client";

import "leaflet/dist/leaflet.css";
import type { LatLngBoundsExpression } from "leaflet";
import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap } from "react-leaflet";
import { COR_CATEGORIA, type Ponto } from "./tipos";

/*
 * Mapa das zonas do PDM (Leaflet + OpenStreetMap), com pontos por cima. Só
 * corre no browser: importa-se com next/dynamic e ssr: false.
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


function Enquadrar({ pontos }: { pontos: Ponto[] }) {
  const map = useMap();
  const feito = useRef(false);
  useEffect(() => {
    if (feito.current || pontos.length === 0) return;
    feito.current = true;
    if (pontos.length === 1) map.setView(pontos[0], 16);
    else map.fitBounds(pontos as LatLngBoundsExpression, { padding: [30, 30], maxZoom: 16 });
  }, [map, pontos]);
  return null;
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
  const todos = enquadrar ?? zonas.flatMap((z) => z.poligono);
  return (
    <MapContainer
      center={todos[0] ?? [41.4425, -8.2918]}
      zoom={14}
      scrollWheelZoom={false}
      className={className}
      attributionControl
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      {zonas.map((z) => {
        const cor = COR_CATEGORIA[z.categoria] ?? "#555";
        const esbatida = destacar && destacar !== z.codigo;
        return (
          <Polygon
            key={z.codigo}
            positions={z.poligono}
            pathOptions={{
              color: cor,
              weight: esbatida ? 1 : 2.5,
              fillOpacity: esbatida ? 0.05 : 0.22,
              opacity: esbatida ? 0.4 : 1,
            }}
          >
            <Tooltip sticky>{z.nome}</Tooltip>
          </Polygon>
        );
      })}
      {pontos.map((p) => (
        <CircleMarker
          key={p.id}
          center={[p.lat, p.lng]}
          radius={7}
          pathOptions={{ color: "#fff", weight: 2, fillColor: p.cor, fillOpacity: 1 }}
        >
          <Tooltip>{p.rotulo}</Tooltip>
        </CircleMarker>
      ))}
      <Enquadrar pontos={todos} />
    </MapContainer>
  );
}
