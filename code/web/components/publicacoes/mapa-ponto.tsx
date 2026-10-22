"use client";

import "leaflet/dist/leaflet.css";
import L, { type Map as MapaLeaflet } from "leaflet";
import { useEffect, useMemo } from "react";
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

/*
 * Mini-mapa para escolher o ponto de um evento (Leaflet + OpenStreetMap).
 * Clicar no mapa põe o ponto; o marcador arrasta-se. O círculo tracejado
 * mostra até onde chegam as subscrições "avise-me" feitas pela rua (o raio
 * de cada uma). Só corre no browser: importa-se com next/dynamic e ssr: false.
 * A alternativa de teclado (latitude/longitude e "usar o centro do mapa")
 * fica no formulário.
 */

const CENTRO_OMISSAO: [number, number] = [41.4425, -8.2918];

const ICONE = L.divIcon({
  className: "",
  html: '<span style="display:block;width:28px;height:28px;border-radius:14px 14px 14px 3px;background:#b84a24;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

function Cliques({ onPonto }: { onPonto: (p: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click: (e) => onPonto({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

/** Dá o mapa ao formulário (para "usar o centro do mapa") e segue o ponto. */
function Ligar({
  onMapa,
  ponto,
}: {
  onMapa?: (m: MapaLeaflet | null) => void;
  ponto: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    onMapa?.(map);
    return () => onMapa?.(null);
  }, [map, onMapa]);
  useEffect(() => {
    if (ponto && !map.getBounds().contains([ponto.lat, ponto.lng])) map.setView([ponto.lat, ponto.lng]);
  }, [map, ponto]);
  return null;
}

export default function MapaPonto({
  ponto,
  onPonto,
  raioAviso,
  onMapa,
  rotulo,
}: {
  ponto: { lat: number; lng: number } | null;
  onPonto: (p: { lat: number; lng: number }) => void;
  /** Raio das subscrições pela rua (m), para o círculo tracejado. */
  raioAviso?: number;
  onMapa?: (m: MapaLeaflet | null) => void;
  rotulo: string;
}) {
  const centro = useMemo<[number, number]>(
    () => (ponto ? [ponto.lat, ponto.lng] : CENTRO_OMISSAO),
    // Só o centro inicial; depois o mapa segue o ponto (Ligar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return (
    <div role="group" aria-label={rotulo} className="overflow-hidden rounded-xl border border-linha">
      <MapContainer
        center={centro}
        zoom={ponto ? 16 : 13}
        scrollWheelZoom={false}
        className="h-64 w-full"
        attributionControl
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <Cliques onPonto={onPonto} />
        <Ligar onMapa={onMapa} ponto={ponto} />
        {ponto && (
          <>
            {raioAviso ? (
              <Circle
                center={[ponto.lat, ponto.lng]}
                radius={raioAviso}
                pathOptions={{ color: "#b84a24", weight: 1.5, dashArray: "6 6", fillOpacity: 0.08 }}
              />
            ) : null}
            <Marker
              position={[ponto.lat, ponto.lng]}
              icon={ICONE}
              draggable
              title="Ponto do evento (arraste para mudar)"
              alt="Ponto do evento"
              eventHandlers={{
                dragend: (e) => {
                  const p = (e.target as L.Marker).getLatLng();
                  onPonto({ lat: p.lat, lng: p.lng });
                },
              }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
