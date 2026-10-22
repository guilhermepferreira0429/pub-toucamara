"use client";

import type { FormaMapa, MarcadorMapa } from "@/components/mapa/tipos";
import { BolhaMarcador } from "@/components/mapa/vidro";
import { eEmergencia, estiloDe, ondeDito, raioDito, type ItemAgora } from "./tipos";

/*
 * Os itens do "o que se passa" no MapaCidade: cada um é uma bolha (ícone
 * forte do tipo + título em vidro), as emergências pulsam, e as zonas
 * (polígono ou raio) desenham-se; a do selecionado levanta-se em 3D.
 */

export function chaveItem(i: Pick<ItemAgora, "fonte" | "id">): string {
  return `${i.fonte}-${i.id}`;
}

export function nomeAcessivel(i: ItemAgora): string {
  const onde = ondeDito(i);
  return `${estiloDe(i).singular}: ${i.titulo}${onde ? `, ${onde}` : ""}`;
}

/** A linha curta por baixo do título: a distância, se houver, senão a etiqueta. */
function metaDe(i: ItemAgora): string {
  const d = i.distancia_m;
  if (d !== undefined && d !== null) {
    return d === 0 ? "Onde está" : `a ${raioDito(Math.max(50, Math.round(d / 50) * 50))}`;
  }
  return i.etiqueta;
}

export function marcadorDeItem(
  i: ItemAgora,
  opcoes: { selecionado?: boolean; compacto?: boolean } = {},
): MarcadorMapa | null {
  if (i.lat === null || i.lng === null) return null;
  const e = estiloDe(i);
  const emergencia = eEmergencia(i);
  return {
    id: chaveItem(i),
    lat: i.lat,
    lng: i.lng,
    nome: nomeAcessivel(i),
    ancora: "baixo",
    frente: !!opcoes.selecionado || emergencia,
    conteudo: (
      <BolhaMarcador
        icone={e.icone}
        cor={e.cor}
        titulo={i.titulo}
        meta={metaDe(i)}
        compacta={!!opcoes.compacto && !opcoes.selecionado && !emergencia}
        selecionada={opcoes.selecionado}
        pulsar={emergencia}
      />
    ),
  };
}

/** A zona do item (polígono ou círculo), se tiver. */
export function formaDeItem(i: ItemAgora, opcoes: { selecionado?: boolean } = {}): FormaMapa | null {
  const cor = estiloDe(i).cor;
  const comum = {
    id: `zona-${chaveItem(i)}`,
    cor,
    preenchimento: opcoes.selecionado ? 0.28 : 0.16,
    espessura: opcoes.selecionado ? 3 : 2,
    altura_m: opcoes.selecionado ? 36 : undefined,
    rotulo: i.titulo,
  };
  if (i.poligono?.length) return { ...comum, tipo: "poligono", pontos: i.poligono };
  if (i.raio_m && i.lat !== null && i.lng !== null) {
    return { ...comum, tipo: "circulo", centro: { lat: i.lat, lng: i.lng }, raio_m: i.raio_m };
  }
  return null;
}
