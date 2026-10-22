"use client";

import "leaflet/dist/leaflet.css";
import "./mapa-agora.css";
import L, { type LatLngBoundsExpression } from "leaflet";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Circle, MapContainer, Marker, Polygon, Popup, TileLayer, useMap } from "react-leaflet";
import { caminhoDetalhe, estiloDe, eEmergencia, ondeDito, quandoDito, type ItemAgora } from "./tipos";

/*
 * O mapa do "o que se passa" (Leaflet + mosaicos do OpenStreetMap). Só corre
 * no browser: importa-se com next/dynamic e ssr: false. Cada marcador tem o
 * ícone e a cor do tipo, recebe o foco do teclado (Enter abre o balão) e tem
 * nome acessível ("Obra: Andaime na via pública, Rua Direita"). A lista é a
 * alternativa ao mapa: tem tudo o que o mapa mostra.
 */

const CENTRO_OMISSAO: [number, number] = [41.4425, -8.2918];

function iconeDe(i: ItemAgora, grande: boolean): L.DivIcon {
  const e = estiloDe(i);
  const Icone = e.icone;
  const lado = grande ? 48 : 44;
  const svg = renderToStaticMarkup(<Icone width={22} height={22} color="#fff" strokeWidth={2.25} aria-hidden />);
  const emergencia = eEmergencia(i);
  return L.divIcon({
    className: "agora-marcador",
    html: `<span style="background:${e.cor};width:${lado}px;height:${lado}px;${emergencia ? "box-shadow:0 0 0 4px rgba(163,16,26,.35);" : ""}" class="agora-marcador-bola">${svg}</span>`,
    iconSize: [lado, lado],
    iconAnchor: [lado / 2, lado / 2],
    popupAnchor: [0, -lado / 2],
  });
}

function nomeAcessivel(i: ItemAgora): string {
  const onde = ondeDito(i);
  return `${estiloDe(i).singular}: ${i.titulo}${onde ? `, ${onde}` : ""}`;
}

/** Enquadra quando mudam os pontos (lista nova, outro filtro). */
function Enquadrar({ pontos, zoomUm }: { pontos: [number, number][]; zoomUm: number }) {
  const map = useMap();
  const chave = pontos.map((p) => p.join(",")).join(";");
  const ultima = useRef<string | null>(null);
  useEffect(() => {
    if (ultima.current === chave || pontos.length === 0) return;
    ultima.current = chave;
    if (pontos.length === 1) map.setView(pontos[0], zoomUm);
    else map.fitBounds(pontos as LatLngBoundsExpression, { padding: [36, 36], maxZoom: 16 });
  }, [map, chave, pontos, zoomUm]);
  return null;
}

function Marcador({
  item,
  slug,
  comBalao,
}: {
  item: ItemAgora;
  slug: string;
  comBalao: boolean;
}) {
  const icone = useMemo(() => iconeDe(item, eEmergencia(item)), [item]);
  const nome = nomeAcessivel(item);
  const quando = quandoDito(item);
  return (
    <Marker
      position={[item.lat as number, item.lng as number]}
      icon={icone}
      title={nome}
      keyboard={comBalao}
      interactive={comBalao}
      eventHandlers={{
        add: (ev) => {
          const el = (ev.target as L.Marker).getElement();
          if (!el) return;
          el.setAttribute("aria-label", nome);
          if (!comBalao) {
            el.setAttribute("role", "img");
            el.removeAttribute("tabindex");
          }
        },
      }}
    >
      {comBalao && (
        <Popup>
          <span className="flex flex-col gap-1 font-body">
            <span className="text-[12px] font-bold tracking-[0.8px] text-tinta-3 uppercase">{item.etiqueta}</span>
            <span className="text-[15px] font-bold text-tinta">{item.titulo}</span>
            {quando && <span className="text-[13px] text-tinta-2">{quando}</span>}
            <Link
              href={caminhoDetalhe(slug, item)}
              className="inline-flex min-h-11 items-center font-semibold text-terracota-escuro underline"
            >
              Ver detalhe
            </Link>
          </span>
        </Popup>
      )}
    </Marker>
  );
}

export default function MapaAgora({
  itens,
  slug,
  perto,
  zona = false,
  className,
}: {
  itens: ItemAgora[];
  slug: string;
  /** Onde a pessoa está (só em memória) e o raio escolhido. */
  perto?: { lat: number; lng: number; raio_m: number } | null;
  /** Detalhe: desenha a zona (círculo/polígono), sem balões. */
  zona?: boolean;
  className?: string;
}) {
  const comPonto = itens.filter((i) => i.lat !== null && i.lng !== null);
  const pontos: [number, number][] = comPonto.map((i) => [i.lat as number, i.lng as number]);
  if (zona) {
    for (const i of itens) for (const p of i.poligono ?? []) pontos.push([p.lat, p.lng]);
  }
  if (perto) pontos.push([perto.lat, perto.lng]);

  return (
    <MapContainer
      center={pontos[0] ?? CENTRO_OMISSAO}
      zoom={14}
      scrollWheelZoom={false}
      className={`agora-mapa ${className ?? ""}`}
      attributionControl
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      {perto && (
        <Circle
          center={[perto.lat, perto.lng]}
          radius={perto.raio_m}
          pathOptions={{ color: "#15263b", weight: 2, dashArray: "6 6", fillOpacity: 0.06 }}
          interactive={false}
        />
      )}
      {zona &&
        itens.map((i) => {
          const cor = estiloDe(i).cor;
          if (i.poligono?.length) {
            return (
              <Polygon
                key={`p-${i.id}`}
                positions={i.poligono.map((p) => [p.lat, p.lng] as [number, number])}
                pathOptions={{ color: cor, weight: 2.5, fillOpacity: 0.18 }}
                interactive={false}
              />
            );
          }
          if (i.raio_m && i.lat !== null && i.lng !== null) {
            return (
              <Circle
                key={`c-${i.id}`}
                center={[i.lat, i.lng]}
                radius={i.raio_m}
                pathOptions={{ color: cor, weight: 2.5, fillOpacity: 0.18 }}
                interactive={false}
              />
            );
          }
          return null;
        })}
      {comPonto.map((i) => (
        <Marcador key={`${i.fonte}-${i.id}`} item={i} slug={slug} comBalao={!zona} />
      ))}
      <Enquadrar pontos={pontos} zoomUm={zona ? 16 : 15} />
    </MapContainer>
  );
}
