"use client";

import "leaflet/dist/leaflet.css";
import "@/components/agora/mapa-agora.css";
import L, { type LatLngBoundsExpression } from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";

/*
 * O mapa da página /visitar (Leaflet + OpenStreetMap, como o do /agora). Só
 * corre no browser (next/dynamic com ssr: false). Os pontos do roteiro têm o
 * número da ordem; os outros, a cor da categoria; os eventos, a cor do /agora.
 * Cada marcador tem nome acessível; as listas da página são a alternativa.
 */

export interface MarcaMapa {
  id: string;
  nome: string;
  lat: number;
  lng: number;
  tipo: "monumento" | "museu" | "natureza" | "transporte" | "evento";
  /** Número no roteiro (1, 2, 3…), se o ponto fizer parte dele. */
  numero?: number;
  detalhe?: string | null;
}

const CORES: Record<MarcaMapa["tipo"], string> = {
  monumento: "#b84a24",
  museu: "#15263b",
  natureza: "#2f6b3c",
  transporte: "#5b6472",
  evento: "#7a3fa0",
};

const CENTRO: [number, number] = [41.4425, -8.2918];

function icone(m: MarcaMapa): L.DivIcon {
  const lado = 44;
  const texto = m.numero ? String(m.numero) : "";
  return L.divIcon({
    className: "agora-marcador",
    html: `<span class="agora-marcador-bola" style="background:${CORES[m.tipo]};width:${lado}px;height:${lado}px;color:#fff;font-weight:700;font-size:15px">${texto}</span>`,
    iconSize: [lado, lado],
    iconAnchor: [lado / 2, lado / 2],
    popupAnchor: [0, -lado / 2],
  });
}

function Enquadrar({ pontos }: { pontos: [number, number][] }) {
  const map = useMap();
  const chave = pontos.map((p) => p.join(",")).join(";");
  const ultima = useRef<string | null>(null);
  useEffect(() => {
    if (ultima.current === chave || pontos.length === 0) return;
    ultima.current = chave;
    if (pontos.length === 1) map.setView(pontos[0], 16);
    else map.fitBounds(pontos as LatLngBoundsExpression, { padding: [30, 30], maxZoom: 16 });
  }, [map, chave, pontos]);
  return null;
}

function Marca({ m, rotulo }: { m: MarcaMapa; rotulo: string }) {
  const ic = useMemo(() => icone(m), [m]);
  const nome = `${m.numero ? `${m.numero}. ` : ""}${m.nome}${rotulo ? ` (${rotulo})` : ""}`;
  return (
    <Marker
      position={[m.lat, m.lng]}
      icon={ic}
      title={nome}
      eventHandlers={{
        add: (ev) => (ev.target as L.Marker).getElement()?.setAttribute("aria-label", nome),
      }}
    >
      <Popup>
        <span className="flex flex-col gap-1 font-body">
          <span className="text-[15px] font-bold text-tinta">{m.nome}</span>
          {m.detalhe && <span className="text-[13px] text-tinta-2">{m.detalhe}</span>}
        </span>
      </Popup>
    </Marker>
  );
}

export default function MapaVisitar({
  marcas,
  rotuloEvento,
  linha,
}: {
  marcas: MarcaMapa[];
  rotuloEvento: string;
  /** O percurso do roteiro (pela ordem). */
  linha?: [number, number][];
}) {
  // Enquadra no roteiro quando há; senão no centro (os pontos longe, como a
  // Citânia, não puxam o mapa para fora da cidade).
  const enquadrar: [number, number][] = linha?.length
    ? linha
    : marcas.filter((m) => m.tipo !== "evento").slice(0, 10).map((m) => [m.lat, m.lng]);
  return (
    <MapContainer center={CENTRO} zoom={15} scrollWheelZoom={false} className="agora-mapa h-[380px] w-full rounded-2xl" attributionControl>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      {linha && linha.length > 1 && (
        <Polyline positions={linha} pathOptions={{ color: "#b84a24", weight: 3, dashArray: "6 6" }} interactive={false} />
      )}
      {marcas.map((m) => (
        <Marca key={m.id} m={m} rotulo={m.tipo === "evento" ? rotuloEvento : ""} />
      ))}
      <Enquadrar pontos={enquadrar} />
    </MapContainer>
  );
}
