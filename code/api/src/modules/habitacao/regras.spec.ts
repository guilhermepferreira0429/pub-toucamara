import {
  avaliarCandidatura,
  classificarReparacao,
  estimarRenda,
  limiteRendimento,
  proximasPrestacoes,
} from './regras.js';

describe('habitação · regras', () => {
  it('limites de rendimento por regime e agregado', () => {
    // 14 × 522,50 € × 1,5 = 10 972,50 €
    expect(limiteRendimento('apoiado', 1)).toBe(1_097_250);
    expect(limiteRendimento('apoiado', 3)).toBe(Math.round(14 * 52250 * 2.5));
    expect(limiteRendimento('acessivel', 1)).toBe(3_500_000);
    expect(limiteRendimento('acessivel', 2)).toBe(4_500_000);
    expect(limiteRendimento('acessivel', 4)).toBe(5_500_000);
  });

  it('pontuação provisória explicada, critério a critério', () => {
    const a = avaliarCandidatura({
      regime: 'apoiado',
      agregado: 3,
      rendimento_anual_cent: 980_000,
      situacao: 'sem_condicoes',
      menores: 2,
      idosos_ou_deficiencia: 0,
      anos_residencia: 6,
    });
    expect(a.elegivel).toBe(true);
    // 25 (casa sem condições) + 25 (< 0,5 IAS por pessoa) + 10 + 0 + 10
    expect(a.criterios.map((c) => c.pontos)).toEqual([25, 25, 10, 0, 10]);
    expect(a.pontuacao).toBe(70);
    expect(a.criterios.every((c) => c.porque.length > 5)).toBe(true);
  });

  it('exclui acima do limite ou com casa própria (e pontua na mesma)', () => {
    const a = avaliarCandidatura({
      regime: 'apoiado',
      agregado: 1,
      rendimento_anual_cent: 2_000_000,
      situacao: 'adequada',
      casa_propria: true,
    });
    expect(a.elegivel).toBe(false);
    expect(a.exclusoes).toHaveLength(2);
    expect(a.pontuacao).toBe(0);
  });

  it('máximos de cada critério', () => {
    const a = avaliarCandidatura({
      regime: 'apoiado',
      agregado: 6,
      rendimento_anual_cent: 0,
      situacao: 'sem_casa',
      menores: 5,
      idosos_ou_deficiencia: 3,
      anos_residencia: 20,
    });
    expect(a.pontuacao).toBe(100);
  });

  it('renda apoiada: taxa de esforço pelo rendimento corrigido, com mínimo', () => {
    const r = estimarRenda({
      regime: 'apoiado',
      rendimento_mensal_cent: 80_000,
      agregado: 1,
      renda_atual_cent: 15_000,
    });
    // 0,067 × 800/522,5 = 10,26% → 82,07 €
    expect(r.renda_cent).toBe(8207);
    expect(
      estimarRenda({
        regime: 'apoiado',
        rendimento_mensal_cent: 0,
        agregado: 2,
        renda_atual_cent: 5000,
      }).renda_cent,
    ).toBe(523);
    // Rendimentos altos: no máximo 23%.
    expect(
      estimarRenda({
        regime: 'apoiado',
        rendimento_mensal_cent: 500_000,
        agregado: 1,
        renda_atual_cent: 0,
      }).taxa,
    ).toBe(0.23);
  });

  it('renda acessível: até 35% do rendimento, nunca acima da atual', () => {
    expect(
      estimarRenda({
        regime: 'acessivel',
        rendimento_mensal_cent: 100_000,
        agregado: 2,
        renda_atual_cent: 40_000,
      }).renda_cent,
    ).toBe(35_000);
    expect(
      estimarRenda({
        regime: 'acessivel',
        rendimento_mensal_cent: 200_000,
        agregado: 2,
        renda_atual_cent: 40_000,
      }).renda_cent,
    ).toBe(40_000);
  });

  it('reparações: gás e faíscas são perigo; fugas e inundações são urgentes', () => {
    expect(
      classificarReparacao({ categoria: 'gas', descricao: 'esquentador' }),
    ).toEqual({
      urgencia: 'urgente',
      perigo: true,
    });
    expect(
      classificarReparacao({
        categoria: 'agua',
        descricao: 'Há uma fuga no cano da cozinha',
      }),
    ).toEqual({ urgencia: 'urgente', perigo: false });
    expect(
      classificarReparacao({
        categoria: 'portas_janelas',
        descricao: 'A janela do quarto não fecha bem',
      }),
    ).toEqual({ urgencia: 'normal', perigo: false });
    expect(
      classificarReparacao({
        categoria: 'outro',
        descricao: 'estore partido',
        urgente: true,
      }).urgencia,
    ).toBe('urgente');
  });

  it('próximas prestações a partir de hoje', () => {
    expect(proximasPrestacoes('2026-10-22', 8, 9000)).toEqual([
      { vence: '2026-11-08', valor_cent: 9000 },
      { vence: '2026-12-08', valor_cent: 9000 },
      { vence: '2027-01-08', valor_cent: 9000 },
    ]);
    expect(proximasPrestacoes('2026-10-05', 8, 9000, 1)).toEqual([
      { vence: '2026-10-08', valor_cent: 9000 },
    ]);
  });
});
