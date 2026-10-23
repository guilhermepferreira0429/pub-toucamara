"use client";

import { useMemo } from "react";
import { CENTRO_OMISSAO } from "@/components/mapa/config";
import { MapaCidade } from "@/components/mapa/mapa-cidade";
import type { PontoMapa } from "@/components/mapa/tipos";
import { ESTADO_COR, ESTADO_ROTULO, num, type Pin } from "./tipos";

/*
 * O mapa das ocorrências (MapaCidade: Mapbox com token, em 2D por omissão
 * e 3D a pedido; senão Leaflet + OpenStreetMap). Os pins são uma camada de
 * círculos (aguenta muitos). Ao mexer no mapa avisa a caixa visível (bbox)
 * para se pedirem os pins dessa zona. A lista ao lado é a alternativa
 * acessível.
 */

export interface PropsMapa {
  pins: Pin[];
  /** Pontos para o primeiro enquadramento (todas as ocorrências conhecidas). */
  enquadrar: [number, number][];
  selecionado: string | null;
  onSelecionar: (id: string) => void;
  onBbox: (bbox: string) => void;
}

export default function MapaOcorrencias({ pins, enquadrar, selecionado, onSelecionar, onBbox }: PropsMapa) {
  const pontos = useMemo<PontoMapa[]>(
    () =>
      pins.flatMap((p) => {
        const lat = num(p.lat);
        const lng = num(p.lng);
        if (lat === null || lng === null) return [];
        return [
          {
            id: p.id,
            lat,
            lng,
            cor: ESTADO_COR[p.estado],
            rotulo: `${p.categoria} · ${p.numero} · ${ESTADO_ROTULO[p.estado]}${p.duplicados > 0 ? ` · ${p.duplicados + 1} avisos` : ""}`,
          },
        ];
      }),
    [pins],
  );
  const pontosEnquadrar = useMemo(() => enquadrar.map(([lat, lng]) => ({ lat, lng })), [enquadrar]);
  return (
    <MapaCidade
      rotulo="Mapa das ocorrências"
      className="size-full"
      pontos={pontos}
      // Sem ocorrências com coordenadas (ou antes de chegarem), o centro do
      // concelho, e não o país inteiro; com pontos, enquadra-os.
      centro={CENTRO_OMISSAO}
      zoom={13}
      enquadrar={pontosEnquadrar}
      enquadrarUmaVez
      selecionado={selecionado}
      aoSelecionar={onSelecionar}
      seguirSelecionado
      aoMover={(m) => onBbox(m.bbox)}
      vista="2d"
      cooperativo={false}
      rodaRato
      controlos={{ zoom: true, bussola: true, vista3d: true, satelite: true, localizacao: true, posicao: "direita-baixo" }}
    />
  );
}
