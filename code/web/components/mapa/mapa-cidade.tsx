"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { temMapbox } from "./config";
import { eToque } from "./geometria";
import type { PropsMapaCidade } from "./tipos";

/*
 * MapaCidade: o componente base de todos os mapas da web (docs/MAPAS.md).
 *
 * - Com NEXT_PUBLIC_MAPBOX_TOKEN (público, "pk."): Mapbox GL v3, estilo
 *   Standard (ou o de NEXT_PUBLIC_MAPBOX_ESTILO), 3D com edifícios.
 * - Sem token, ou se o Mapbox não abrir (token recusado, sem WebGL, sem
 *   rede para api.mapbox.com): Leaflet + OpenStreetMap, em 2D, a mesma API.
 *
 * Cada motor só se descarrega quando é preciso (next/dynamic, sem SSR): o
 * mapbox-gl não entra nas páginas sem mapa. A lista ao lado (ou o texto) é
 * sempre a alternativa acessível; os marcadores têm nome e recebem o foco.
 */

function ACarregarMapa() {
  return (
    <div className="flex size-full items-center justify-center bg-creme-2 text-sm text-tinta-3">
      A carregar o mapa…
    </div>
  );
}

const MotorMapbox = dynamic(() => import("./motor-mapbox"), { ssr: false, loading: ACarregarMapa });
const MotorLeaflet = dynamic(() => import("./motor-leaflet"), { ssr: false, loading: ACarregarMapa });

export function MapaCidade(props: PropsMapaCidade) {
  const [falhou, setFalhou] = useState(false);
  const usarMapbox = temMapbox() && !falhou;
  // Num ecrã de toque, dentro de uma página com scroll: dois dedos para mexer.
  const [cooperativo] = useState(() => props.cooperativo ?? eToque());
  const p = { ...props, cooperativo };
  return (
    <div
      role="region"
      aria-label={props.rotulo}
      data-motor={usarMapbox ? "mapbox" : "leaflet"}
      className={`mapa-cidade isolate overflow-hidden ${props.className ?? ""}`}
    >
      {usarMapbox ? (
        <MotorMapbox
          {...p}
          aoFalhar={(motivo) => {
            console.warn(`Mapbox indisponível (${motivo}): a usar o OpenStreetMap.`);
            setFalhou(true);
          }}
        />
      ) : (
        <MotorLeaflet {...p} />
      )}
    </div>
  );
}

export default MapaCidade;
