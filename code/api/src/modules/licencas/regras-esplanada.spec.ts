import {
  avaliarEsplanada,
  CONFIG_ESPLANADA_OMISSAO,
  entradaEsplanada,
  esquemaConfigEsplanada,
  PedidoEsplanada,
  taxaEsplanada,
} from './regras-esplanada';

const SEM_FERIADOS = new Set<string>();
const HOJE = '2026-10-21';
const C = CONFIG_ESPLANADA_OMISSAO;

const esplanada = (p: Partial<PedidoEsplanada> = {}): PedidoEsplanada => ({
  estabelecimento: 'Café Central',
  morada: 'Largo do Toural 5, Guimarães',
  data_inicio: '2026-11-02',
  meses: 6,
  area_m2: 12,
  mesas: 4,
  passeio_livre_m: 2,
  ...p,
});

describe('avaliarEsplanada', () => {
  it('4 mesas em 12 m² por 6 meses: dentro das regras, 3 €/m²/mês', () => {
    const a = avaliarEsplanada(esplanada(), C, HOJE, SEM_FERIADOS);
    expect(a.proposta).toBe('aprovar');
    expect(a.taxa.total_cent).toBe(12 * 6 * 300);
    expect(a.condicoes.join(' ')).toContain('23h');
  });

  it('taxa mínima quando a conta dá menos', () => {
    const t = taxaEsplanada(esplanada({ area_m2: 4, meses: 1 }), C);
    expect(t.total_cent).toBe(C.taxa_minima_cent);
    expect(t.linhas[0].descricao).toContain('mínima');
  });

  it('centro histórico e estrado vão a técnico, a não ser que a câmara mude', () => {
    const p = esplanada({ centro_historico: true, estrado: true });
    const a = avaliarEsplanada(p, C, HOJE, SEM_FERIADOS);
    expect(a.proposta).toBe('tecnico');
    expect(a.regras.filter((r) => !r.ok).map((r) => r.id)).toEqual([
      'estrado',
      'centro_historico',
    ]);
    expect(
      avaliarEsplanada(
        p,
        {
          ...C,
          estrado_vai_a_tecnico: false,
          centro_historico_vai_a_tecnico: false,
        },
        HOJE,
        SEM_FERIADOS,
      ).proposta,
    ).toBe('aprovar');
  });

  it('mesas, área, passeio e meses acima dos limites', () => {
    const ids = avaliarEsplanada(
      esplanada({ mesas: 15, area_m2: 40, passeio_livre_m: 1, meses: 18 }),
      C,
      HOJE,
      SEM_FERIADOS,
    )
      .regras.filter((r) => !r.ok)
      .map((r) => r.id);
    expect(ids).toEqual(['area', 'mesas', 'passeio', 'meses']);
  });

  it('a entrada e a config validam com zod', () => {
    expect(entradaEsplanada.parse(esplanada()).mesas).toBe(4);
    expect(
      esquemaConfigEsplanada.safeParse({ ...C, hora_fecho: '25:00' }).success,
    ).toBe(false);
  });
});
