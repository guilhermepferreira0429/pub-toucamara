"use client";

import "leaflet/dist/leaflet.css";
import type { LatLngBounds, LatLngBoundsExpression } from "leaflet";
import { useEffect, useRef } from "react";
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { ESTADO_COR, ESTADO_ROTULO, num, type Pin } from "./tipos";

/*
 * O mapa das ocorrências (Leaflet + mosaicos do OpenStreetMap). Só corre no
 * browser: importa-se com next/dynamic e ssr: false. Ao mexer no mapa avisa
 * a caixa visível (bbox) para se pedirem os pins dessa zona.
 */

export interface PropsMapa {
  pins: Pin[];
  /** Pontos para o primeiro enquadramento (todas as ocorrências conhecidas). */
  enquadrar: [number, number][];
  selecionado: string | null;
  onSelecionar: (id: string) => void;
  onBbox: (bbox: string) => void;
}

function bboxDe(b: LatLngBounds): string {
  const f = (n: number) => n.toFixed(5);
  return `${f(b.getWest())},${f(b.getSouth())},${f(b.getEast())},${f(b.getNorth())}`;
}

function Eventos({ onBbox }: { onBbox: (bbox: string) => void }) {
  const map = useMapEvents({
    moveend: () => onBbox(bboxDe(map.getBounds())),
  });
  useEffect(() => {
    onBbox(bboxDe(map.getBounds()));
  }, [map, onBbox]);
  return null;
}

/** Enquadra uma vez, quando chegam os primeiros pontos. */
function Enquadrar({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  const feito = useRef(false);
  useEffect(() => {
    if (feito.current || pontos.length === 0) return;
    feito.current = true;
    if (pontos.length === 1) map.setView(pontos[0], 16);
    else map.fitBounds(pontos as LatLngBoundsExpression, { padding: [40, 40], maxZoom: 16 });
  }, [map, pontos]);
  return null;
}

/** Centra no selecionado se estiver fora da vista. */
function Focar({ alvo }: { alvo: [number, number] | null }) {
  const map = useMap();
  const lat = alvo?.[0];
  const lng = alvo?.[1];
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    if (!map.getBounds().pad(-0.1).contains([lat, lng])) {
      map.panTo([lat, lng]);
    }
  }, [map, lat, lng]);
  return null;
}

export default function MapaOcorrencias({
  pins,
  enquadrar,
  selecionado,
  onSelecionar,
  onBbox,
}: PropsMapa) {
  const pontos = pins
    .map((p) => ({ p, lat: num(p.lat), lng: num(p.lng) }))
    .filter(
      (x): x is { p: Pin; lat: number; lng: number } =>
        x.lat !== null && x.lng !== null,
    );
  const sel = pontos.find((x) => x.p.id === selecionado);

  return (
    <MapContainer
      center={[39.6, -8.0]}
      zoom={7}
      scrollWheelZoom
      className="size-full"
      attributionControl
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      <Eventos onBbox={onBbox} />
      <Enquadrar pontos={enquadrar} />
      <Focar alvo={sel ? [sel.lat, sel.lng] : null} />
      {pontos.map(({ p, lat, lng }) => {
        const ativo = p.id === selecionado;
        return (
          <CircleMarker
            key={p.id}
            center={[lat, lng]}
            radius={ativo ? 16 : 10}
            pathOptions={{
              color: "#ffffff",
              weight: ativo ? 3 : 2,
              fillColor: ESTADO_COR[p.estado],
              fillOpacity: 1,
            }}
            eventHandlers={{ click: () => onSelecionar(p.id) }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {p.categoria} · {p.numero} · {ESTADO_ROTULO[p.estado]}
              {p.duplicados > 0 ? ` · ${p.duplicados + 1} avisos` : ""}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
