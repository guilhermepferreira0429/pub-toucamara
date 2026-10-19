import {
  caixaEnvolvente,
  distanciaMetros,
  estadoEmLinguagemSimples,
  formatarNumero,
  melhorCategoria,
  normalizarNumero,
} from './ocorrencias.regras.js';

const CATEGORIAS = [
  { id: '1', nome: 'Buraco na via' },
  { id: '2', nome: 'Iluminação pública' },
  { id: '3', nome: 'Resíduos e limpeza' },
  { id: '4', nome: 'Árvores e espaços verdes' },
  { id: '5', nome: 'Sinalização' },
];

describe('distanciaMetros', () => {
  it('zero no mesmo ponto', () => {
    expect(
      distanciaMetros({ lat: 41.44, lng: -8.29 }, { lat: 41.44, lng: -8.29 }),
    ).toBe(0);
  });

  it('um milésimo de grau de latitude ≈ 111 m', () => {
    const d = distanciaMetros(
      { lat: 41.44, lng: -8.29 },
      { lat: 41.441, lng: -8.29 },
    );
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('distingue 40 m de 60 m (o raio dos duplicados)', () => {
    const a = { lat: 38.7223, lng: -9.1393 };
    // ~0.00045° de longitude a 38.7° ≈ 39 m; 0.0007° ≈ 61 m
    expect(
      distanciaMetros(a, { lat: a.lat, lng: a.lng + 0.00045 }),
    ).toBeLessThan(50);
    expect(
      distanciaMetros(a, { lat: a.lat, lng: a.lng + 0.0007 }),
    ).toBeGreaterThan(50);
  });
});

describe('caixaEnvolvente', () => {
  it('contém os pontos a menos de 50 m em todas as direções', () => {
    const p = { lat: 41.44, lng: -8.29 };
    const c = caixaEnvolvente(p, 50);
    for (const [dLat, dLng] of [
      [0.00044, 0],
      [-0.00044, 0],
      [0, 0.00059],
      [0, -0.00059],
    ]) {
      const q = { lat: p.lat + dLat, lng: p.lng + dLng };
      expect(distanciaMetros(p, q)).toBeLessThan(50);
      expect(q.lat).toBeGreaterThanOrEqual(c.minLat);
      expect(q.lat).toBeLessThanOrEqual(c.maxLat);
      expect(q.lng).toBeGreaterThanOrEqual(c.minLng);
      expect(q.lng).toBeLessThanOrEqual(c.maxLng);
    }
  });
});

describe('numeração', () => {
  it('formata com 4 dígitos', () => {
    expect(formatarNumero(381)).toBe('OC-0381');
    expect(formatarNumero(12345)).toBe('OC-12345');
  });

  it('aceita o número como é dito', () => {
    expect(normalizarNumero('OC-0381')).toBe('OC-0381');
    expect(normalizarNumero('oc 381')).toBe('OC-0381');
    expect(normalizarNumero('381')).toBe('OC-0381');
    expect(normalizarNumero('sem número')).toBeNull();
  });
});

describe('melhorCategoria', () => {
  it('nome exato, sem acentos nem maiúsculas', () => {
    expect(melhorCategoria('iluminacao publica', CATEGORIAS)?.id).toBe('2');
  });

  it('palavras do munícipe', () => {
    expect(melhorCategoria('há um buraco enorme', CATEGORIAS)?.id).toBe('1');
    expect(melhorCategoria('buracos na estrada', CATEGORIAS)?.id).toBe('1');
    expect(melhorCategoria('caiu uma árvore', CATEGORIAS)?.id).toBe('4');
  });

  it('sinónimos de quem liga', () => {
    expect(melhorCategoria('candeeiro apagado', CATEGORIAS)?.id).toBe('2');
    expect(melhorCategoria('lixo fora do contentor', CATEGORIAS)?.id).toBe('3');
    expect(melhorCategoria('semáforo avariado', CATEGORIAS)?.id).toBe('5');
  });

  it('sem correspondência → null', () => {
    expect(melhorCategoria('barulho dos vizinhos', CATEGORIAS)).toBeNull();
    expect(melhorCategoria('', CATEGORIAS)).toBeNull();
  });

  it('empate → null (o agente pergunta)', () => {
    const cats = [
      { id: 'a', nome: 'Passeio danificado' },
      { id: 'b', nome: 'Passeio obstruído' },
    ];
    expect(melhorCategoria('problema no passeio', cats)).toBeNull();
  });
});

describe('estadoEmLinguagemSimples', () => {
  it('com equipa e data prevista', () => {
    expect(
      estadoEmLinguagemSimples({
        estado: 'com_equipa',
        prevista_para: '2026-10-28',
        resolvida_em: null,
      }),
    ).toContain('28/10/2026');
  });

  it('resolvida com data', () => {
    expect(
      estadoEmLinguagemSimples({
        estado: 'resolvida',
        prevista_para: null,
        resolvida_em: '2026-10-20',
      }),
    ).toBe('Foi resolvida a 20/10/2026.');
  });
});
