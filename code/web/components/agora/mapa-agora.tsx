"use client";

import { MapaCidade } from "@/components/mapa/mapa-cidade";
import type { FormaMapa, LatLng, MarcadorMapa } from "@/components/mapa/tipos";
import { contorno } from "@/components/mapa/geometria";
import { formaDeItem, marcadorDeItem } from "./marcadores";
import type { ItemAgora } from "./tipos";

/*
 * O mapa pequeno do "o que se passa" (o detalhe de um item): o ponto em
 * bolha e a zona (círculo ou polígono), numa vista inclinada. Usa o
 * MapaCidade (Mapbox em 3D com token; senão Leaflet + OpenStreetMap). O
 * ecrã do mapa grande é o EcraMapaAgora (ecra-mapa.tsx).
 */

export default function MapaAgora({
  itens,
  perto,
  zona = false,
  className,
}: {
  itens: ItemAgora[];
  slug?: string;
  /** Onde a pessoa está (só em memória) e o raio escolhido. */
  perto?: { lat: number; lng: number; raio_m: number } | null;
  /** Detalhe: desenha a zona (círculo/polígono). */
  zona?: boolean;
  className?: string;
}) {
  const marcadores = itens.map((i) => marcadorDeItem(i, { compacto: zona })).filter((m): m is MarcadorMapa => !!m);
  const formas: FormaMapa[] = zona
    ? itens.map((i) => formaDeItem(i)).filter((f): f is FormaMapa => !!f)
    : [];
  if (perto) {
    formas.push({
      id: "perto",
      tipo: "circulo",
      centro: perto,
      raio_m: perto.raio_m,
      cor: "#15263b",
      preenchimento: 0.06,
      espessura: 2,
      tracejado: true,
    });
  }
  const enquadrar: LatLng[] = marcadores.map((m) => ({ lat: m.lat, lng: m.lng }));
  // A zona inteira (polígono ou círculo) cabe no mapa.
  for (const f of formas) if (f.id !== "perto") enquadrar.push(...contorno(f));
  if (perto) enquadrar.push(perto);

  return (
    <MapaCidade
      rotulo="Mapa com o sítio"
      className={className}
      marcadores={marcadores}
      formas={formas}
      enquadrar={enquadrar}
      zoomMaximo={zona ? 16.5 : 15}
      vista="inclinado"
      controlos={{ zoom: true, vista3d: true, satelite: true, posicao: "direita-baixo" }}
      // A bolha fica por cima do ponto: espaço em cima para caber.
      margens={{ topo: 70 }}
    />
  );
}
