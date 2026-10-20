/*
 * Matemática dos mosaicos do OpenStreetMap (Web Mercator, "slippy map"):
 * lat/lng → mosaico e pixel, a grelha 3×3 à volta do ponto, a janela
 * centrada no marcador e a escala. Funções puras (ver mapa.spec.ts).
 *
 * Referência: https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames
 */

export const TAMANHO_MOSAICO = 256;

/** Limite de latitude do Web Mercator (o mapa é um quadrado). */
export const LAT_MAXIMA = 85.0511287798066;

/** Metros por pixel no equador com zoom 0: circunferência / 256. */
const METROS_PIXEL_Z0 = 40_075_016.686 / TAMANHO_MOSAICO;

/** Pontos PDF por metro (72 pt por polegada, 0,0254 m por polegada). */
const PONTOS_POR_METRO = 72 / 0.0254;

export interface Ponto {
  x: number;
  y: number;
}

export interface Mosaico {
  z: number;
  x: number;
  y: number;
  /** Posição na grelha (0 = primeira coluna/linha). */
  coluna: number;
  linha: number;
}

export interface Grelha {
  zoom: number;
  mosaicos: Mosaico[];
  /** Tamanho da grelha em pixels. */
  largura: number;
  altura: number;
  /** O ponto em pixels, a contar do canto superior esquerdo da grelha. */
  marcador: Ponto;
}

export function coordenadasValidas(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= LAT_MAXIMA &&
    Math.abs(lng) <= 180
  );
}

/** Pixel global (no mundo inteiro, com este zoom) de um ponto lat/lng. */
export function pixelGlobal(lat: number, lng: number, zoom: number): Ponto {
  const n = TAMANHO_MOSAICO * 2 ** zoom;
  const la = Math.max(-LAT_MAXIMA, Math.min(LAT_MAXIMA, lat));
  const rad = (la * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  // No limite exato o arredondamento dá -0,000…1: fica dentro do mapa.
  return { x: ((lng + 180) / 360) * n, y: Math.max(0, Math.min(n, y)) };
}

/** O mosaico que contém o ponto e a posição do ponto dentro dele (0–255). */
export function mosaicoDe(
  lat: number,
  lng: number,
  zoom: number,
): { x: number; y: number; pixel: Ponto } {
  const p = pixelGlobal(lat, lng, zoom);
  const max = 2 ** zoom - 1;
  const x = Math.min(max, Math.floor(p.x / TAMANHO_MOSAICO));
  const y = Math.min(max, Math.floor(p.y / TAMANHO_MOSAICO));
  return {
    x,
    y,
    pixel: { x: p.x - x * TAMANHO_MOSAICO, y: p.y - y * TAMANHO_MOSAICO },
  };
}

/**
 * Grelha lado×lado (3×3 por defeito) com o mosaico do ponto ao meio. Na
 * longitude dá a volta ao mundo; na latitude a grelha encosta ao limite do
 * mapa (o ponto deixa de estar no mosaico do meio, o marcador acompanha).
 */
export function grelhaMosaicos(
  lat: number,
  lng: number,
  zoom: number,
  lado = 3,
): Grelha {
  const centro = mosaicoDe(lat, lng, zoom);
  const n = 2 ** zoom;
  const meio = Math.floor(lado / 2);
  const y0 = Math.max(0, Math.min(n - lado, centro.y - meio));
  const x0 = centro.x - meio;
  const mosaicos: Mosaico[] = [];
  for (let linha = 0; linha < lado; linha++) {
    for (let coluna = 0; coluna < lado; coluna++) {
      mosaicos.push({
        z: zoom,
        x: (((x0 + coluna) % n) + n) % n,
        y: y0 + linha,
        coluna,
        linha,
      });
    }
  }
  return {
    zoom,
    mosaicos,
    largura: lado * TAMANHO_MOSAICO,
    altura: lado * TAMANHO_MOSAICO,
    marcador: {
      x: (centro.x - x0) * TAMANHO_MOSAICO + centro.pixel.x,
      y: (centro.y - y0) * TAMANHO_MOSAICO + centro.pixel.y,
    },
  };
}

/**
 * Janela quadrada (em pixels da grelha) com o marcador ao centro, sem sair
 * da grelha. Numa grelha 3×3 com o ponto no mosaico do meio, uma janela de
 * 512 px fica sempre centrada.
 */
export function janelaCentrada(
  g: Pick<Grelha, 'largura' | 'altura' | 'marcador'>,
  lado = 2 * TAMANHO_MOSAICO,
): { x: number; y: number; lado: number; marcador: Ponto } {
  const l = Math.min(lado, g.largura, g.altura);
  const x = Math.max(0, Math.min(g.largura - l, g.marcador.x - l / 2));
  const y = Math.max(0, Math.min(g.altura - l, g.marcador.y - l / 2));
  return {
    x,
    y,
    lado: l,
    marcador: { x: g.marcador.x - x, y: g.marcador.y - y },
  };
}

/** Metros no terreno por pixel do mosaico, à latitude do ponto. */
export function metrosPorPixel(lat: number, zoom: number): number {
  return (METROS_PIXEL_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Barra de escala "redonda" (1, 2 ou 5 × 10^k metros) com a maior largura
 * que cabe em `maxPontos`.
 */
export function barraEscala(
  metrosPorPonto: number,
  maxPontos: number,
): { metros: number; pontos: number; rotulo: string } {
  const maxMetros = metrosPorPonto * maxPontos;
  let metros = 1;
  for (let k = Math.floor(Math.log10(Math.max(maxMetros, 1))); k >= 0; k--) {
    const base = 10 ** k;
    const escolha = [5, 2, 1].map((f) => f * base).find((m) => m <= maxMetros);
    if (escolha) {
      metros = escolha;
      break;
    }
  }
  return {
    metros,
    pontos: metros / metrosPorPonto,
    rotulo: metros >= 1000 ? `${metros / 1000} km` : `${metros} m`,
  };
}

/**
 * Denominador da escala aproximada no papel (1:N), arredondado a dois
 * algarismos significativos: 1:2 500, não 1:2 537.
 */
export function denominadorEscala(metrosPorPonto: number): number {
  const n = metrosPorPonto * PONTOS_POR_METRO;
  const ordem = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / ordem) * ordem;
}

/** '1:2 500' (separador de milhares português: espaço). */
export function rotuloEscala(denominador: number): string {
  return `1:${String(denominador).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

/** '41,444300° N, 8,296200° O' (WGS84, 6 casas: ~10 cm). */
export function formatarCoordenadas(lat: number, lng: number): string {
  const f = (v: number) => Math.abs(v).toFixed(6).replace('.', ',');
  return `${f(lat)}° ${lat >= 0 ? 'N' : 'S'}, ${f(lng)}° ${lng >= 0 ? 'E' : 'O'}`;
}
