import { lerRespostaNominatim, textoPesquisa } from './geocodificacao.js';

// Resposta real do Nominatim (format=jsonv2), encurtada.
const FIXTURE = [
  {
    place_id: 123456,
    licence: 'Data © OpenStreetMap contributors, ODbL 1.0.',
    osm_type: 'way',
    osm_id: 987654,
    lat: '38.7104550',
    lon: '-9.1371990',
    category: 'highway',
    type: 'residential',
    place_rank: 26,
    importance: 0.1,
    addresstype: 'road',
    name: 'Rua Augusta',
    display_name:
      'Rua Augusta, Baixa, Santa Maria Maior, Lisboa, Grande Lisboa, 1100-053, Portugal',
    boundingbox: ['38.7085', '38.7124', '-9.1380', '-9.1364'],
  },
];

describe('lerRespostaNominatim', () => {
  it('lê lat/lon em texto para números', () => {
    expect(lerRespostaNominatim(FIXTURE)).toEqual({
      lat: 38.710455,
      lng: -9.137199,
      encontrada:
        'Rua Augusta, Baixa, Santa Maria Maior, Lisboa, Grande Lisboa, 1100-053, Portugal',
    });
  });

  it('sem resultados ou resposta estranha → null', () => {
    expect(lerRespostaNominatim([])).toBeNull();
    expect(lerRespostaNominatim({ error: 'x' })).toBeNull();
    expect(lerRespostaNominatim(null)).toBeNull();
  });

  it('salta resultados sem coordenadas válidas', () => {
    expect(
      lerRespostaNominatim([
        { lat: 'abc', lon: '1' },
        { lat: '41.1', lon: '-8.6' },
      ]),
    ).toMatchObject({ lat: 41.1, lng: -8.6, encontrada: '' });
  });
});

describe('textoPesquisa', () => {
  it('acrescenta o município', () => {
    expect(textoPesquisa('Rua Direita  45', 'Viseu')).toBe(
      'Rua Direita 45, Viseu',
    );
  });

  it('não repete se já lá estiver', () => {
    expect(textoPesquisa('Praça da República, Viseu', 'viseu')).toBe(
      'Praça da República, Viseu',
    );
  });
});
