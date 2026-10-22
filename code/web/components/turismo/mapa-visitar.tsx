"use client";

import { useMemo, useState } from "react";
import { MapaCidade } from "@/components/mapa/mapa-cidade";
import type { MarcadorMapa } from "@/components/mapa/tipos";

/*
 * O mapa da página /visitar (MapaCidade: Mapbox em 3D com os edifícios, ou
 * Leaflet + OpenStreetMap sem token). Só corre no browser (next/dynamic com
 * ssr: false). Os pontos do roteiro têm o número da ordem; os outros, a cor da
 * categoria; os eventos, a cor do /agora. Ao tocar num ponto aparece o nome e
 * o detalhe por baixo do mapa. As listas da página são a alternativa acessível.
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

const CENTRO = { lat: 41.4425, lng: -8.2918 };

export default function MapaVisitar({
  marcas,
  rotuloEvento,
  linha,
}: {
  marcas: MarcaMapa[];
  rotuloEvento: string;
  /** O percurso do roteiro (pela ordem): serve para enquadrar. */
  linha?: [number, number][];
}) {
  const [selecionado, setSelecionado] = useState<string | null>(null);

  // Enquadra no roteiro quando há; senão no centro (os pontos longe, como a
  // Citânia, não puxam o mapa para fora da cidade).
  const enquadrar = useMemo(
    () =>
      linha?.length
        ? linha.map(([lat, lng]) => ({ lat, lng }))
        : marcas
            .filter((m) => m.tipo !== "evento")
            .slice(0, 10)
            .map((m) => ({ lat: m.lat, lng: m.lng })),
    [linha, marcas],
  );

  const marcadores = useMemo<MarcadorMapa[]>(
    () =>
      marcas.map((m) => {
        const rotulo = m.tipo === "evento" ? ` (${rotuloEvento})` : "";
        return {
          id: m.id,
          lat: m.lat,
          lng: m.lng,
          nome: `${m.numero ? `${m.numero}. ` : ""}${m.nome}${rotulo}`,
          frente: m.id === selecionado,
          conteudo: (
            <span
              className="flex size-11 items-center justify-center rounded-full border-2 border-white text-[15px] font-bold text-white shadow-[0_4px_14px_rgba(21,38,59,0.35)]"
              style={{ background: CORES[m.tipo] }}
            >
              {m.numero ?? ""}
            </span>
          ),
        };
      }),
    [marcas, rotuloEvento, selecionado],
  );

  const escolhida = marcas.find((m) => m.id === selecionado) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="h-[380px] w-full overflow-hidden rounded-2xl">
        <MapaCidade
          rotulo="Mapa dos pontos a visitar"
          className="size-full"
          centro={CENTRO}
          zoom={15}
          enquadrar={enquadrar}
          marcadores={marcadores}
          selecionado={selecionado}
          aoSelecionar={setSelecionado}
          vista="3d"
          cooperativo
          controlos={{
            zoom: true,
            bussola: true,
            localizacao: true,
            vista3d: true,
            satelite: true,
          }}
        />
      </div>
      {escolhida && (
        <p
          aria-live="polite"
          className="flex flex-col gap-0.5 rounded-xl bg-creme px-3 py-2"
        >
          <span className="text-[15px] font-bold text-tinta">
            {escolhida.nome}
          </span>
          {escolhida.detalhe && (
            <span className="text-[13px] text-tinta-2">
              {escolhida.detalhe}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
