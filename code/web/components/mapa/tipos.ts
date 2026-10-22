import type { ReactNode } from "react";

/*
 * A API única dos mapas (components/mapa/mapa-cidade.tsx). Serve os dois
 * motores: Mapbox GL (com token; 3D) e Leaflet + OpenStreetMap (sem token; 2D).
 * Quem usa o mapa não sabe qual dos dois está a correr.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Marcador com conteúdo React (bolha, ícone, pino). Para poucos pontos
 * importantes: cada um é um elemento do DOM, focável e com nome acessível.
 */
export interface MarcadorMapa extends LatLng {
  id: string;
  /** Nome acessível ("Obra: Andaime na via pública, Rua Direita"). */
  nome: string;
  /** O que se desenha. Sem conteúdo: um ponto redondo na `cor`. */
  conteudo?: ReactNode;
  /** Onde fica o ponto geográfico no desenho (por omissão, ao centro). */
  ancora?: "centro" | "baixo";
  cor?: string;
  /** Fica por cima dos outros (selecionado, emergência). */
  frente?: boolean;
  /** Arrasta-se (aoArrastar diz para onde). */
  arrastavel?: boolean;
}

/**
 * Ponto simples (muitos pontos: ocorrências no painel). No Mapbox é uma
 * camada de círculos (rápida); a lista ao lado é a alternativa acessível.
 */
export interface PontoMapa extends LatLng {
  id: string;
  cor: string;
  /** Texto do balão ao passar o rato. */
  rotulo: string;
}

interface FormaBase {
  id: string;
  cor: string;
  /** Opacidade do preenchimento (0–1). */
  preenchimento?: number;
  espessura?: number;
  tracejado?: boolean;
  /** Esbatida (as outras zonas quando uma está em destaque). */
  esbatida?: boolean;
  /** Em 3D, levanta-se em volume com esta altura (m). Em 2D é plana. */
  altura_m?: number;
  /** Balão ao passar o rato. */
  rotulo?: string;
}

export interface PoligonoMapa extends FormaBase {
  tipo: "poligono";
  pontos: LatLng[];
}

export interface CirculoMapa extends FormaBase {
  tipo: "circulo";
  centro: LatLng;
  raio_m: number;
}

export type FormaMapa = PoligonoMapa | CirculoMapa;

export type ModoVista = "2d" | "inclinado" | "3d";

export interface Movimento {
  /** "oeste,sul,este,norte" com 5 casas (o formato do ?bbox= da API). */
  bbox: string;
  zoom: number;
  centro: LatLng;
}

/** O que o mapa deixa fazer de fora (formulários: "usar o centro do mapa"). */
export interface ApiMapa {
  centro(): LatLng;
  zoom(): number;
  /** O ponto está à vista? */
  contem(p: LatLng): boolean;
  voarPara(p: LatLng, zoom?: number): void;
  enquadrar(pontos: LatLng[], opcoes?: { maxZoom?: number }): void;
  motor: "mapbox" | "leaflet";
}

export interface PropsMapaCidade {
  /** Nome da região do mapa para leitores de ecrã. */
  rotulo: string;
  className?: string;
  marcadores?: MarcadorMapa[];
  pontos?: PontoMapa[];
  formas?: FormaMapa[];
  /** Centro e zoom iniciais (sem `enquadrar`). */
  centro?: LatLng;
  zoom?: number;
  /** Enquadra estes pontos à entrada e sempre que mudam (ver enquadrarUmaVez). */
  enquadrar?: LatLng[];
  /** Só o primeiro enquadramento (o painel: depois quem manda é a pessoa). */
  enquadrarUmaVez?: boolean;
  /** Zoom máximo ao enquadrar (por omissão 16). */
  zoomMaximo?: number;
  selecionado?: string | null;
  aoSelecionar?: (id: string) => void;
  /** Centra no selecionado se estiver fora da vista. */
  seguirSelecionado?: boolean;
  aoMover?: (m: Movimento) => void;
  aoClicar?: (p: LatLng) => void;
  aoArrastar?: (id: string, p: LatLng) => void;
  /** Vista inicial: 3D oblíqua (munícipe), inclinada ou 2D (trabalho). */
  vista?: ModoVista;
  /** Botões redondos em vidro. */
  controlos?: {
    zoom?: boolean;
    bussola?: boolean;
    /** "A minha localização": centra e mostra o ponto azul. */
    localizacao?: boolean;
    /** Alternar 2D/3D (só com Mapbox). */
    vista3d?: boolean;
    /** Alternar "Satélite / Mapa" (só com Mapbox; a escolha fica neste browser). */
    satelite?: boolean;
    /** Onde ficam (por omissão: direita, ao meio). */
    posicao?: "direita" | "direita-baixo";
  };
  /** A pessoa pediu a localização e o browser deu-a (fica só em memória). */
  aoLocalizar?: (p: LatLng) => void;
  /** Onde a pessoa está (desenha o ponto "está aqui"). */
  aqui?: LatLng | null;
  /** Gestos cooperativos (dois dedos/Ctrl para mexer), num mapa dentro de página com scroll. */
  cooperativo?: boolean;
  /** Zoom com a roda do rato (por omissão, só se não for cooperativo). */
  rodaRato?: boolean;
  /** Mapa estático: sem gestos nem botões (cartões pequenos). */
  estatico?: boolean;
  /** Estilo do Mapbox ("standard", "standard-satellite" ou mapbox://…). */
  estilo?: string;
  /** Recebe a API do mapa quando está pronto (e null ao sair). */
  aoPronto?: (api: ApiMapa | null) => void;
  /** Espaço tapado por painéis por cima do mapa (para enquadrar e voar). */
  margens?: { topo?: number; baixo?: number; esquerda?: number; direita?: number };
}
