"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, TileLayer } from "react-leaflet";

/*
 * Mapa pequeno na ficha do processo (Leaflet + OpenStreetMap), com o ponto
 * da obra. Só corre no browser: importa-se com next/dynamic e ssr: false.
 */

export interface PropsMapaProcesso {
  lat: number;
  lng: number;
  rotulo: string;
}

export default function MapaProcesso({ lat, lng, rotulo }: PropsMapaProcesso) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={17}
      scrollWheelZoom={false}
      className="size-full"
      attributionControl
      aria-label={`Mapa: ${rotulo}`}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      <CircleMarker
        center={[lat, lng]}
        radius={9}
        pathOptions={{
          color: "#ffffff",
          weight: 2,
          fillColor: "#b84a24",
          fillOpacity: 1,
        }}
      />
    </MapContainer>
  );
}
