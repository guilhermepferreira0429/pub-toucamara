import { geometriaEmergencia } from './emergencias.regras';
import {
  areaKm2,
  ESPACO_SIMULADO,
  estadoDifusaoSimulada,
  estimarZona,
  falhaSimulada,
  FORMATO_SIMULADO,
  numeroSimulado,
  paginaSimulada,
  POPULACAO_DEMONSTRACAO,
  quantosGerar,
  referenciaDifusaoDemo,
  segmentos,
} from './operadores.regras';
import { telefoneParaSms } from '../avisos-zona/avisos-zona.regras';
import { normalizarTelefone } from '../municipes/municipes.service';

const MUN = '00000000-0000-0000-0000-000000000001';
const freguesias = (...f: string[]) =>
  geometriaEmergencia({ tipo: 'freguesias', freguesias: f });

describe('população de demonstração e estimativa', () => {
  it('está marcada como demonstração e não diz que são os Censos', () => {
    expect(POPULACAO_DEMONSTRACAO.demonstracao).toBe(true);
    expect(POPULACAO_DEMONSTRACAO.fonte).toMatch(/não são os Censos 2021/);
  });

  it('por freguesias: soma as freguesias, valor por omissão para as desconhecidas', () => {
    const e = estimarZona(freguesias('azurem', 'Freguesia Inventada'));
    expect(e.por_zona).toEqual([
      expect.objectContaining({
        zona: 'azurem',
        pessoas: 9_500,
        valor_por_omissao: false,
      }),
      expect.objectContaining({
        zona: 'Freguesia Inventada',
        pessoas: POPULACAO_DEMONSTRACAO.por_omissao_freguesia,
        valor_por_omissao: true,
      }),
    ]);
    expect(e.pessoas).toBe(9_500 + 3_000);
    expect(e.com_telemovel).toBe(
      Math.round(9_500 * 0.9) + Math.round(3_000 * 0.9),
    );
    expect(e.demonstracao).toBe(true);
  });

  it('a união de freguesias conta pela parte ("São Paio")', () => {
    expect(estimarZona(freguesias('São Paio')).pessoas).toBe(6_000);
  });

  it('no mapa: área × densidade (círculo de 1 km ≈ 3,14 km²)', () => {
    const g = geometriaEmergencia({
      tipo: 'ponto',
      lat: 41.44,
      lng: -8.29,
      raio_m: 1000,
    });
    expect(areaKm2(g.geo!)).toBeCloseTo(Math.PI, 5);
    expect(estimarZona(g).pessoas).toBe(Math.round(Math.PI * 650));
  });

  it('polígono de ~1 km × 1 km', () => {
    const dLat = 1 / 111.195;
    const dLng = 1 / (111.195 * Math.cos((41.44 * Math.PI) / 180));
    const g = geometriaEmergencia({
      tipo: 'poligono',
      pontos: [
        { lat: 41.44, lng: -8.29 },
        { lat: 41.44, lng: -8.29 + dLng },
        { lat: 41.44 + dLat, lng: -8.29 + dLng },
        { lat: 41.44 + dLat, lng: -8.29 },
      ],
    });
    expect(areaKm2(g.geo!)).toBeCloseTo(1, 2);
  });
});

describe('números gerados', () => {
  it('formato reconhecível, telemóvel português válido para SMS', () => {
    for (let i = 0; i < 200; i++) {
      const n = numeroSimulado('semente', i);
      expect(n).toMatch(FORMATO_SIMULADO);
      expect(normalizarTelefone(n)).toBe(n);
      expect(telefoneParaSms(n)).toBe(true);
    }
  });

  it('determinísticos: mesma zona → mesmos números; zona diferente → outros', () => {
    const a = segmentos(MUN, freguesias('Azurém'), 0.02);
    const b = segmentos(MUN, freguesias('Azurém'), 0.02);
    const c = segmentos(MUN, freguesias('Creixomil'), 0.02);
    const pa = paginaSimulada(a, 0, 50).numeros.map((x) => x.telefone_e164);
    expect(
      paginaSimulada(b, 0, 50).numeros.map((x) => x.telefone_e164),
    ).toEqual(pa);
    expect(
      paginaSimulada(c, 0, 50).numeros.map((x) => x.telefone_e164),
    ).not.toEqual(pa);
    // A freguesia dá os mesmos números com ou sem outras freguesias na zona.
    const ab = segmentos(MUN, freguesias('Azurém', 'Creixomil'), 0.02);
    expect(
      paginaSimulada(ab, 0, 50).numeros.map((x) => x.telefone_e164),
    ).toEqual(pa);
    // Outro município, outros números.
    const outro = segmentos('outro', freguesias('Azurém'), 0.02);
    expect(
      paginaSimulada(outro, 0, 50).numeros.map((x) => x.telefone_e164),
    ).not.toEqual(pa);
  });

  it('sem repetidos dentro de uma semente (permutação do espaço)', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 20_000; i++) vistos.add(numeroSimulado('x', i));
    expect(vistos.size).toBe(20_000);
  });

  it('proporcional à população por freguesia', () => {
    const s = segmentos(MUN, freguesias('Azurém', 'Silvares'), 0.02);
    expect(s.map((x) => [x.zona, x.total])).toEqual([
      ['Azurém', Math.round(9_500 * 0.9 * 0.02)],
      ['Silvares', Math.round(2_500 * 0.9 * 0.02)],
    ]);
    expect(s[0].total / s[1].total).toBeCloseTo(9_500 / 2_500, 1);
  });

  it('a escala fica entre 0 e 1 e nunca passa o espaço do formato', () => {
    expect(quantosGerar(1000, 0)).toBe(0);
    expect(quantosGerar(1000, 5)).toBe(1000);
    expect(quantosGerar(1000, Number.NaN)).toBe(0);
    expect(quantosGerar(10 * ESPACO_SIMULADO, 1)).toBe(ESPACO_SIMULADO);
  });

  it('páginas: percorre todos os segmentos uma vez, com a zona aproximada', () => {
    const s = segmentos(MUN, freguesias('Azurém', 'Silvares'), 0.02);
    const total = s[0].total + s[1].total;
    const todos: string[] = [];
    const zonas = new Set<string>();
    let cursor: number | null = 0;
    let paginas = 0;
    while (cursor !== null) {
      const p = paginaSimulada(s, cursor, 40);
      todos.push(...p.numeros.map((x) => x.telefone_e164));
      p.numeros.forEach((x) => zonas.add(x.zona_aproximada));
      cursor = p.seguinte;
      paginas++;
    }
    expect(todos).toHaveLength(total);
    expect(paginas).toBe(Math.ceil(total / 40));
    expect([...zonas]).toEqual(['Azurém', 'Silvares']);
  });

  it('falhas de demonstração: determinísticas, 0 nunca, 1 sempre', () => {
    expect(falhaSimulada('s', 0, 1, 0)).toBe(false);
    expect(falhaSimulada('s', 0, 1, 1)).toBe(true);
    const a = [0, 1, 2, 3, 4].map((p) => falhaSimulada('s', p, 1, 0.5));
    expect([0, 1, 2, 3, 4].map((p) => falhaSimulada('s', p, 1, 0.5))).toEqual(
      a,
    );
    let falhas = 0;
    for (let p = 0; p < 1000; p++) if (falhaSimulada('s', p, 1, 0.3)) falhas++;
    expect(falhas).toBeGreaterThan(220);
    expect(falhas).toBeLessThan(380);
  });
});

describe('cell broadcast simulado', () => {
  const t0 = new Date('2026-10-22T10:00:00Z');
  it('pedida → em difusão → concluída', () => {
    expect(estadoDifusaoSimulada(t0, t0).estado).toBe('pedida');
    expect(
      estadoDifusaoSimulada(t0, new Date(t0.getTime() + 11_000)).estado,
    ).toBe('em_difusao');
    const fim = estadoDifusaoSimulada(t0, new Date(t0.getTime() + 3_600_000));
    expect(fim).toMatchObject({ estado: 'concluida' });
    expect(fim.concluida_em!.getTime()).toBe(
      t0.getTime() + 10_000 + 30 * 60_000,
    );
  });

  it('referência de demonstração', () => {
    expect(referenciaDifusaoDemo('abcdef12-3456-7890-abcd-ef1234567890')).toBe(
      'CB-DEMO-ABCDEF12',
    );
  });
});
