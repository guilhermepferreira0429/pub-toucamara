import {
  haversineKm,
  minutosDeslocacao,
  type OpcoesPlano,
  paraHora,
  paraMinutos,
  planearDia,
  type VisitaParaPlano,
} from './planeamento';

// Pontos inventados à volta de (41.44, -8.29); 0,01° de latitude ≈ 1,11 km.
const CAMARA = { lat: 41.44, lng: -8.29 };
const opcoes: OpcoesPlano = {
  partida: CAMARA,
  hora_inicio: '09:00',
  hora_fim: '17:30',
  velocidade_kmh: 30,
  fator_percurso: 1,
  regressar: true,
};
const v = (
  id: string,
  dLat: number,
  extra: Partial<VisitaParaPlano> = {},
): VisitaParaPlano => ({
  id,
  lat: CAMARA.lat + dLat,
  lng: CAMARA.lng,
  duracao_min: 20,
  ...extra,
});

describe('haversine e tempos', () => {
  it('0,01° de latitude são cerca de 1,11 km', () => {
    expect(haversineKm(CAMARA, { lat: 41.45, lng: -8.29 })).toBeCloseTo(
      1.112,
      2,
    );
    expect(haversineKm(CAMARA, CAMARA)).toBe(0);
  });

  it('Lisboa–Porto em linha reta ≈ 274 km', () => {
    const km = haversineKm(
      { lat: 38.7223, lng: -9.1393 },
      { lat: 41.1579, lng: -8.6291 },
    );
    expect(km).toBeGreaterThan(270);
    expect(km).toBeLessThan(278);
  });

  it('minutos de carro: arredonda para cima e aplica o fator de percurso', () => {
    expect(minutosDeslocacao(10, 30, 1)).toBe(20);
    expect(minutosDeslocacao(10, 30, 1.3)).toBe(26);
    expect(minutosDeslocacao(0.1, 30, 1)).toBe(1);
    expect(minutosDeslocacao(0, 30, 1.3)).toBe(0);
  });

  it('horas', () => {
    expect(paraMinutos('09:05')).toBe(545);
    expect(paraHora(545)).toBe('09:05');
    expect(paraHora(1000)).toBe('16:40');
    expect(() => paraMinutos('nove')).toThrow();
  });
});

describe('planearDia', () => {
  it('vizinho mais próximo a partir da câmara, com deslocações, durações e regresso', () => {
    const p = planearDia(
      [v('longe', 0.05), v('perto', 0.01), v('meio', 0.03)],
      opcoes,
    );
    expect(p.paragens.map((x) => x.id)).toEqual(['perto', 'meio', 'longe']);
    const [a, b] = p.paragens;
    // 1,11 km a 30 km/h → 3 min; 20 min no local.
    expect(a).toMatchObject({
      ordem: 1,
      deslocacao_min: 3,
      chegada: '09:03',
      inicio: '09:03',
      fim: '09:23',
      espera_min: 0,
      janela: null,
    });
    expect(a.distancia_km).toBeCloseTo(1.1, 1);
    // 2,22 km → 5 min.
    expect(b).toMatchObject({ chegada: '09:28', fim: '09:48' });
    expect(p.regresso).not.toBeNull();
    expect(p.regresso!.distancia_km).toBeCloseTo(5.6, 1);
    expect(p.totais.trabalho_min).toBe(60);
    expect(p.totais.termina).toBe(p.regresso!.chegada);
    expect(p.janelas_perdidas).toEqual([]);
  });

  it('sem regresso, o dia acaba na última visita', () => {
    const p = planearDia([v('a', 0.01)], { ...opcoes, regressar: false });
    expect(p.regresso).toBeNull();
    expect(p.totais.termina).toBe('09:23');
  });

  it('espera que a janela abra e conta a espera', () => {
    const p = planearDia(
      [v('marcada', 0.01, { janela_inicio: '10:00', janela_fim: '11:00' })],
      opcoes,
    );
    expect(p.paragens[0]).toMatchObject({
      chegada: '09:03',
      inicio: '10:00',
      espera_min: 57,
      janela: { inicio: '10:00', fim: '11:00' },
    });
    expect(p.totais.espera_min).toBe(57);
  });

  it('enquanto a janela não abre, faz primeiro as que estão perto', () => {
    const p = planearDia(
      [
        v('marcada', 0.01, { janela_inicio: '11:00', janela_fim: '12:00' }),
        v('livre', 0.02),
      ],
      opcoes,
    );
    expect(p.paragens.map((x) => x.id)).toEqual(['livre', 'marcada']);
  });

  it('vai primeiro à que tem a janela a fechar, mesmo estando mais longe', () => {
    const p = planearDia(
      [
        v('perto_demorada', 0.01, { duracao_min: 90 }),
        v('longe_ate_as_10', 0.05, { janela_fim: '10:00' }),
      ],
      opcoes,
    );
    expect(p.paragens.map((x) => x.id)).toEqual([
      'longe_ate_as_10',
      'perto_demorada',
    ]);
    expect(p.janelas_perdidas).toEqual([]);
  });

  it('janela que já não se cumpre fica de fora', () => {
    const p = planearDia(
      [v('cedo', 0.05, { janela_fim: '09:05' }), v('normal', 0.01)],
      opcoes,
    );
    expect(p.janelas_perdidas).toEqual(['cedo']);
    expect(p.paragens.map((x) => x.id)).toEqual(['normal']);
  });

  it('sem coordenadas não entra no percurso', () => {
    const p = planearDia(
      [v('a', 0.01), { id: 'sem', lat: null, lng: null, duracao_min: 20 }],
      opcoes,
    );
    expect(p.sem_localizacao).toEqual(['sem']);
    expect(p.paragens).toHaveLength(1);
  });

  it('marca o que passa da hora de fim', () => {
    const p = planearDia(
      [v('a', 0.01, { duracao_min: 300 }), v('b', 0.02, { duracao_min: 300 })],
      opcoes,
    );
    expect(p.paragens.map((x) => x.depois_da_hora)).toEqual([false, true]);
  });

  it('sem ponto de partida começa numa ponta e não regressa', () => {
    const p = planearDia([v('meio', 0.02), v('ponta', 0.06), v('outra', 0)], {
      ...opcoes,
      partida: null,
    });
    expect(p.paragens[0].deslocacao_min).toBe(0);
    expect(['ponta', 'outra']).toContain(p.paragens[0].id);
    expect(p.paragens.map((x) => x.id)).toHaveLength(3);
    expect(p.regresso).toBeNull();
  });

  it('dia sem visitas', () => {
    const p = planearDia([], opcoes);
    expect(p.paragens).toEqual([]);
    expect(p.regresso).toBeNull();
    expect(p.totais).toMatchObject({ distancia_km: 0, termina: '09:00' });
  });

  it('com fator de percurso, a distância é a da estrada estimada', () => {
    const p = planearDia([v('a', 0.01)], { ...opcoes, fator_percurso: 1.3 });
    expect(p.paragens[0].distancia_km).toBeCloseTo(1.4, 1);
    expect(p.paragens[0].deslocacao_min).toBe(3);
  });
});
