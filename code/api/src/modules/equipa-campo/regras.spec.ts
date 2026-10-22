import {
  distanciaLegivel,
  distanciaMetros,
  ordenarPorProximidade,
} from './regras';

const CAMARA = { lat: 41.4425, lng: -8.2918 }; // Paços do Concelho (aprox.)

describe('equipa de campo · regras', () => {
  it('distância haversine: zero no mesmo ponto, ~1,1 km por 0,01º de latitude', () => {
    expect(distanciaMetros(CAMARA, CAMARA)).toBe(0);
    const d = distanciaMetros(CAMARA, { lat: 41.4525, lng: -8.2918 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });

  it('por fazer da mais perto para a mais longe; sem coordenadas no fim; feitas depois', () => {
    const t = (id: string, lat: number | null, feita = false) => ({
      id,
      numero: id,
      lat,
      lng: lat == null ? null : -8.2918,
      feita,
    });
    const r = ordenarPorProximidade(
      [
        t('longe', 41.5),
        t('feita', 41.4426, true),
        t('sem', null),
        t('perto', 41.443),
      ],
      CAMARA,
    );
    expect(r.map((x) => x.id)).toEqual(['perto', 'longe', 'sem', 'feita']);
    expect(r[0].distancia_m).toBeGreaterThan(0);
    expect(r[2].distancia_m).toBeNull();
  });

  it('sem localização do telemóvel: ordem do número, sem distâncias', () => {
    const r = ordenarPorProximidade(
      [
        { id: 'b', numero: 'OC-2', lat: 41, lng: -8, feita: false },
        { id: 'a', numero: 'OC-1', lat: 42, lng: -8, feita: false },
      ],
      null,
    );
    expect(r.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.every((x) => x.distancia_m === null)).toBe(true);
  });

  it('distância legível', () => {
    expect(distanciaLegivel(null)).toBeNull();
    expect(distanciaLegivel(3)).toBe('10 m');
    expect(distanciaLegivel(347)).toBe('350 m');
    expect(distanciaLegivel(1234)).toBe('1,2 km');
  });
});
