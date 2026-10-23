import {
  avaliarOcupacao,
  CONFIG_OCUPACAO_OMISSAO,
  entradaOcupacao,
  esquemaConfigOcupacao,
  PedidoOcupacao,
  taxaOcupacao,
} from './regras-ocupacao';

const SEM_FERIADOS = new Set<string>();
const HOJE = '2026-10-21'; // quarta-feira
const C = CONFIG_OCUPACAO_OMISSAO;

const andaime = (p: Partial<PedidoOcupacao> = {}): PedidoOcupacao => ({
  equipamento: 'andaime',
  descricao: 'Pintar a fachada',
  morada: 'Rua de Santo António 10, Guimarães',
  data_inicio: '2026-11-09',
  dias: 10,
  area_m2: 12,
  passeio_livre_m: 1.5,
  ...p,
});

describe('avaliarOcupacao', () => {
  it('andaime de 12 m² por 10 dias, com passeio livre: dentro das regras', () => {
    const a = avaliarOcupacao(andaime(), C, HOJE, SEM_FERIADOS);
    expect(a.proposta).toBe('aprovar');
    expect(a.regras.every((r) => r.ok)).toBe(true);
    // 12 m² × 10 dias × 0,50 € = 60 € (a apreciação de 10 € é deduzida)
    expect(a.taxa.total_cent).toBe(6000);
    expect(a.condicoes.join(' ')).toContain('rede de proteção');
  });

  it('passeio livre abaixo do mínimo → técnico, com o porquê', () => {
    const a = avaliarOcupacao(
      andaime({ passeio_livre_m: 0.8 }),
      C,
      HOJE,
      SEM_FERIADOS,
    );
    expect(a.proposta).toBe('tecnico');
    const passeio = a.regras.find((r) => r.id === 'passeio');
    expect(passeio?.ok).toBe(false);
    expect(passeio?.texto).toContain('0,8 m');
  });

  it('área, dias, estrada, plataforma e antecedência: cada uma manda para técnico', () => {
    const falha = (p: Partial<PedidoOcupacao>, id: string) =>
      expect(
        avaliarOcupacao(andaime(p), C, HOJE, SEM_FERIADOS).regras.find(
          (r) => r.id === id,
        )?.ok,
      ).toBe(false);
    falha({ area_m2: 30 }, 'area');
    falha({ dias: 45 }, 'dias');
    falha({ ocupa_estrada: true }, 'estrada');
    falha({ equipamento: 'plataforma' }, 'equipamento');
    falha({ data_inicio: '2026-10-23' }, 'antecedencia');
    falha({ data_inicio: '2026-10-01' }, 'data');
  });

  it('a câmara muda as regras e a decisão muda com elas', () => {
    const p = andaime({ ocupa_estrada: true, area_m2: 25 });
    expect(avaliarOcupacao(p, C, HOJE, SEM_FERIADOS).proposta).toBe('tecnico');
    expect(
      avaliarOcupacao(
        p,
        { ...C, estrada_vai_a_tecnico: false, area_max_m2: 30 },
        HOJE,
        SEM_FERIADOS,
      ).proposta,
    ).toBe('aprovar');
  });

  it('taxa: sem a parte fixa só fica a linha por m² e dia', () => {
    const t = taxaOcupacao(andaime({ area_m2: 2.5, dias: 3 }), {
      ...C,
      taxa_base_cent: 0,
    });
    expect(t.linhas).toHaveLength(1);
    expect(t.total_cent).toBe(375);
  });

  it('a entrada e a config validam com zod', () => {
    expect(entradaOcupacao.parse(andaime())).toMatchObject({ dias: 10 });
    expect(
      esquemaConfigOcupacao.safeParse({ ...C, equipamentos: [] }).success,
    ).toBe(false);
    expect(esquemaConfigOcupacao.parse(C)).toEqual(C);
  });
});
