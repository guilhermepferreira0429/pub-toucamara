"use client";

import { MapaCidade } from "@/components/mapa/mapa-cidade";
import { Pino } from "@/components/mapa/vidro";

/*
 * Mapa pequeno na ficha do processo (MapaCidade: Mapbox inclinado com os
 * edifícios, ou Leaflet + OpenStreetMap sem token), com o ponto da obra.
 * Só corre no browser: importa-se com next/dynamic e ssr: false.
 */

export interface PropsMapaProcesso {
  lat: number;
  lng: number;
  rotulo: string;
}

export default function MapaProcesso({ lat, lng, rotulo }: PropsMapaProcesso) {
  return (
    <MapaCidade
      rotulo={`Mapa: ${rotulo}`}
      className="size-full"
      centro={{ lat, lng }}
      zoom={17}
      marcadores={[{ id: "obra", lat, lng, nome: `Local da obra: ${rotulo}`, ancora: "baixo", conteudo: <Pino /> }]}
      vista="inclinado"
      cooperativo={false}
      rodaRato={false}
    />
  );
}
