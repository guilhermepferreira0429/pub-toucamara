"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CENTRO_OMISSAO } from "@/components/mapa/config";
import { MapaCidade } from "@/components/mapa/mapa-cidade";
import type { ApiMapa, FormaMapa } from "@/components/mapa/tipos";
import { Pino } from "@/components/mapa/vidro";

/*
 * Mini-mapa para escolher o ponto de um evento (MapaCidade: Mapbox com
 * token, senão Leaflet + OpenStreetMap). Clicar no mapa põe o ponto; o
 * marcador arrasta-se. O círculo tracejado mostra até onde chegam as
 * subscrições "avise-me" feitas pela rua (o raio de cada uma). Só corre no
 * browser: importa-se com next/dynamic e ssr: false. A alternativa de
 * teclado (latitude/longitude e "usar o centro do mapa") fica no formulário.
 */

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
  /** A API do mapa (para "usar o centro do mapa"). */
  onMapa?: (m: ApiMapa | null) => void;
  rotulo: string;
}) {
  // Só o centro inicial; depois o mapa segue o ponto quando sai da vista.
  const [inicio] = useState(() => ({ centro: ponto ?? CENTRO_OMISSAO, zoom: ponto ? 16 : 13 }));
  const api = useRef<ApiMapa | null>(null);
  const aoPronto = useCallback(
    (a: ApiMapa | null) => {
      api.current = a;
      onMapa?.(a);
    },
    [onMapa],
  );
  const lat = ponto?.lat;
  const lng = ponto?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined || !api.current) return;
    if (!api.current.contem({ lat, lng })) api.current.voarPara({ lat, lng });
  }, [lat, lng]);

  const formas: FormaMapa[] =
    ponto && raioAviso
      ? [{ id: "aviso", tipo: "circulo", centro: ponto, raio_m: raioAviso, cor: "#b84a24", espessura: 1.5, tracejado: true, preenchimento: 0.08 }]
      : [];

  return (
    <div role="group" aria-label={rotulo} className="overflow-hidden rounded-xl border border-linha">
      <MapaCidade
        rotulo="Mapa do ponto do evento"
        className="h-64 w-full"
        centro={inicio.centro}
        zoom={inicio.zoom}
        formas={formas}
        marcadores={
          ponto
            ? [
                {
                  id: "evento",
                  ...ponto,
                  nome: "Ponto do evento (arraste para mudar)",
                  ancora: "baixo",
                  arrastavel: true,
                  conteudo: <Pino />,
                },
              ]
            : []
        }
        aoClicar={onPonto}
        aoArrastar={(_, p) => onPonto(p)}
        vista="2d"
        cooperativo={false}
        rodaRato={false}
        controlos={{ zoom: true, posicao: "direita-baixo" }}
        aoPronto={aoPronto}
      />
    </div>
  );
}
