"use client";

import { LoaderCircle, LocateFixed, Map as IconeMapa, Minus, Navigation2, Plus, Satellite } from "lucide-react";
import { BotaoVidro } from "./vidro";

/*
 * Os botões redondos em vidro, iguais nos dois motores: zoom, bússola (volta
 * a apontar para norte; a seta mostra a rotação), a minha localização, 2D/3D
 * e satélite/mapa.
 */

export type EstadoLocalizacao = "inativo" | "a_pedir" | "ok" | "recusado" | "indisponivel";

export interface PropsControlos {
  posicao?: "direita" | "direita-baixo";
  /** Distância à direita (px), quando há um painel por cima do mapa. */
  direita?: number;
  baixo?: number;
  zoom?: { mais: () => void; menos: () => void };
  bussola?: { graus: number; inclinado: boolean; repor: () => void };
  localizacao?: { pedir: () => void; estado: EstadoLocalizacao };
  vista3d?: { em3d: boolean; alternar: () => void };
  satelite?: { ativo: boolean; alternar: () => void };
}

export function Controlos({ posicao = "direita", direita = 12, baixo, zoom, bussola, localizacao, vista3d, satelite }: PropsControlos) {
  const estilo =
    posicao === "direita-baixo"
      ? { right: direita, bottom: baixo ?? 40 }
      : { right: direita, top: "50%", transform: "translateY(-50%)" };
  const erro = localizacao?.estado === "recusado" || localizacao?.estado === "indisponivel";
  return (
    <div className="mapa-controlos" style={estilo}>
      {satelite && (
        <BotaoVidro
          rotulo={satelite.ativo ? "Ver o mapa" : "Ver em satélite"}
          onClick={satelite.alternar}
          aria-pressed={satelite.ativo}
          ativo={satelite.ativo}
          icone={satelite.ativo ? IconeMapa : Satellite}
        />
      )}
      {vista3d && (
        <BotaoVidro
          rotulo="Ver a cidade em 3D"
          onClick={vista3d.alternar}
          aria-pressed={vista3d.em3d}
          ativo={vista3d.em3d}
        >
          <span className="mapa-botao-texto">3D</span>
        </BotaoVidro>
      )}
      {bussola && (
        <BotaoVidro rotulo="Apontar o mapa para norte" onClick={bussola.repor}>
          <Navigation2
            aria-hidden
            className="size-[22px] text-terracota transition-transform"
            fill="currentColor"
            strokeWidth={1.5}
            style={{ transform: `rotate(${-bussola.graus}deg)` }}
          />
        </BotaoVidro>
      )}
      {localizacao && (
        <BotaoVidro
          rotulo={localizacao.estado === "a_pedir" ? "A saber onde está…" : "Mostrar onde estou"}
          onClick={localizacao.pedir}
          disabled={localizacao.estado === "a_pedir"}
          ativo={localizacao.estado === "ok"}
          icone={localizacao.estado === "a_pedir" ? LoaderCircle : LocateFixed}
        />
      )}
      {zoom && (
        <div className="mapa-vidro mapa-zoom">
          <button type="button" aria-label="Aproximar" title="Aproximar" onClick={zoom.mais}>
            <Plus className="size-5" aria-hidden strokeWidth={2.5} />
          </button>
          <span aria-hidden className="mapa-zoom-linha" />
          <button type="button" aria-label="Afastar" title="Afastar" onClick={zoom.menos}>
            <Minus className="size-5" aria-hidden strokeWidth={2.5} />
          </button>
        </div>
      )}
      <p role="status" className={erro ? "mapa-vidro mapa-aviso" : "sr-only"}>
        {localizacao?.estado === "recusado"
          ? "Não deu autorização para usar a localização."
          : localizacao?.estado === "indisponivel"
            ? "Não conseguimos saber onde está."
            : ""}
      </p>
    </div>
  );
}
