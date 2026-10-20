import {
  barraEscala,
  coordenadasValidas,
  denominadorEscala,
  formatarCoordenadas,
  grelhaMosaicos,
  janelaCentrada,
  metrosPorPixel,
  mosaicoDe,
  pixelGlobal,
  rotuloEscala,
} from './mapa.js';

/** A fórmula da wiki do OSM, escrita de outra forma (asinh), para comparar. */
function mosaicoWiki(lat: number, lng: number, z: number) {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n),
  };
}

const GUIMARAES = { lat: 41.4479, lng: -8.2902 };

describe('pixelGlobal / mosaicoDe', () => {
  it('zoom 0: o mundo é um mosaico; (0,0) fica ao centro', () => {
    expect(pixelGlobal(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(mosaicoDe(0, 0, 0)).toEqual({
      x: 0,
      y: 0,
      pixel: { x: 128, y: 128 },
    });
  });

  it('zoom 1: (0,0) é o canto do mosaico (1,1)', () => {
    const t = mosaicoDe(0, 0, 1);
    expect([t.x, t.y]).toEqual([1, 1]);
    expect(t.pixel.x).toBeCloseTo(0, 9);
    expect(t.pixel.y).toBeCloseTo(0, 9);
  });

  it.each([
    [GUIMARAES.lat, GUIMARAES.lng, 17],
    [GUIMARAES.lat, GUIMARAES.lng, 18],
    [38.7104, -9.1372, 18], // Lisboa
    [-33.8568, 151.2153, 16], // Sydney
    [64.1466, -21.9426, 12], // Reiquiavique
  ])('(%p, %p) z%p igual à fórmula da wiki do OSM', (lat, lng, z) => {
    const t = mosaicoDe(lat, lng, z);
    expect({ x: t.x, y: t.y }).toEqual(mosaicoWiki(lat, lng, z));
    expect(t.pixel.x).toBeGreaterThanOrEqual(0);
    expect(t.pixel.x).toBeLessThan(256);
    expect(t.pixel.y).toBeGreaterThanOrEqual(0);
    expect(t.pixel.y).toBeLessThan(256);
  });

  it('Guimarães, zoom 18: mosaico conhecido', () => {
    expect(mosaicoDe(GUIMARAES.lat, GUIMARAES.lng, 18)).toMatchObject({
      x: 125035,
      y: 97850,
    });
  });

  it('latitudes fora do Web Mercator encostam ao limite', () => {
    expect(mosaicoDe(89.9, 0, 3).y).toBe(0);
    expect(mosaicoDe(-89.9, 0, 3).y).toBe(7);
    expect(mosaicoDe(0, 180, 3).x).toBe(7);
  });
});

describe('grelhaMosaicos', () => {
  it('3×3 com o mosaico do ponto ao meio e o marcador no sítio certo', () => {
    const g = grelhaMosaicos(GUIMARAES.lat, GUIMARAES.lng, 18);
    const c = mosaicoDe(GUIMARAES.lat, GUIMARAES.lng, 18);
    expect(g.mosaicos).toHaveLength(9);
    expect(g.largura).toBe(768);
    expect(g.altura).toBe(768);
    const meio = g.mosaicos.find((m) => m.coluna === 1 && m.linha === 1)!;
    expect([meio.x, meio.y]).toEqual([c.x, c.y]);
    expect(g.mosaicos[0]).toMatchObject({ x: c.x - 1, y: c.y - 1, z: 18 });
    expect(g.mosaicos[8]).toMatchObject({ x: c.x + 1, y: c.y + 1 });
    expect(g.marcador.x).toBeCloseTo(256 + c.pixel.x, 9);
    expect(g.marcador.y).toBeCloseTo(256 + c.pixel.y, 9);
  });

  it('o marcador corresponde ao pixel global do ponto', () => {
    const g = grelhaMosaicos(38.7104, -9.1372, 17);
    const p = pixelGlobal(38.7104, -9.1372, 17);
    const origem = g.mosaicos[0];
    expect(origem.x * 256 + g.marcador.x).toBeCloseTo(p.x, 6);
    expect(origem.y * 256 + g.marcador.y).toBeCloseTo(p.y, 6);
  });

  it('na linha de data dá a volta ao mundo', () => {
    const g = grelhaMosaicos(0, 179.99, 2);
    expect(g.mosaicos.filter((m) => m.linha === 0).map((m) => m.x)).toEqual([
      2, 3, 0,
    ]);
  });

  it('no topo do mapa encosta e o marcador acompanha', () => {
    const g = grelhaMosaicos(85, 0, 3);
    expect(Math.min(...g.mosaicos.map((m) => m.y))).toBe(0);
    expect(g.marcador.y).toBeLessThan(256);
  });
});

describe('janelaCentrada', () => {
  it('janela de 512 px com o marcador exatamente ao centro', () => {
    const g = grelhaMosaicos(GUIMARAES.lat, GUIMARAES.lng, 17);
    const j = janelaCentrada(g);
    expect(j.lado).toBe(512);
    expect(j.marcador.x).toBeCloseTo(256, 9);
    expect(j.marcador.y).toBeCloseTo(256, 9);
    expect(j.x).toBeGreaterThanOrEqual(0);
    expect(j.x + j.lado).toBeLessThanOrEqual(g.largura);
  });

  it('não sai da grelha quando o ponto está encostado', () => {
    const j = janelaCentrada({
      largura: 768,
      altura: 768,
      marcador: { x: 10, y: 760 },
    });
    expect([j.x, j.y]).toEqual([0, 256]);
    expect(j.marcador).toEqual({ x: 10, y: 504 });
  });
});

describe('escala', () => {
  it('metros por pixel: ~156 km no equador com zoom 0, metade a 60°', () => {
    expect(metrosPorPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metrosPorPixel(0, 18)).toBeCloseTo(0.5972, 4);
    expect(metrosPorPixel(60, 18)).toBeCloseTo(0.5972 / 2, 3);
  });

  it('barra redonda (1/2/5 × 10^k) que cabe', () => {
    expect(barraEscala(1, 130)).toMatchObject({ metros: 100, pontos: 100 });
    expect(barraEscala(1, 230)).toMatchObject({ metros: 200, rotulo: '200 m' });
    expect(barraEscala(0.45, 128.8)).toMatchObject({ metros: 50 });
    expect(barraEscala(20, 128)).toMatchObject({
      metros: 2000,
      rotulo: '2 km',
      pontos: 100,
    });
    expect(barraEscala(1, 4)).toMatchObject({ metros: 2 });
  });

  it('denominador com dois algarismos significativos', () => {
    // 1 pt = 0,3528 mm: 1 m por ponto ≈ 1:2 835 → 1:2 800.
    expect(denominadorEscala(1)).toBe(2800);
    expect(denominadorEscala(0.45)).toBe(1300);
    expect(rotuloEscala(2800)).toBe('1:2 800');
    expect(rotuloEscala(25000)).toBe('1:25 000');
  });
});

describe('coordenadas', () => {
  it('formata em graus decimais com hemisférios', () => {
    expect(formatarCoordenadas(41.4479, -8.2902)).toBe(
      '41,447900° N, 8,290200° O',
    );
    expect(formatarCoordenadas(-33.85, 151.2)).toBe(
      '33,850000° S, 151,200000° E',
    );
  });

  it('valida', () => {
    expect(coordenadasValidas(41.4, -8.3)).toBe(true);
    expect(coordenadasValidas(NaN, 0)).toBe(false);
    expect(coordenadasValidas(89, 0)).toBe(false);
    expect(coordenadasValidas(0, 181)).toBe(false);
  });
});
