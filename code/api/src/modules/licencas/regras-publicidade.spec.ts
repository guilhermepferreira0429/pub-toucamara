import {
  areaPublicidade,
  avaliarPublicidade,
  CONFIG_PUBLICIDADE_OMISSAO,
  entradaPublicidade,
  esquemaConfigPublicidade,
  PedidoPublicidade,
  taxaPublicidade,
} from './regras-publicidade';

const SEM_FERIADOS = new Set<string>();
const HOJE = '2026-10-21'; // quarta-feira
const C = CONFIG_PUBLICIDADE_OMISSAO;

const placa = (p: Partial<PedidoPublicidade> = {}): PedidoPublicidade => ({
  suporte: 'placa',
  estabelecimento: 'Sapataria Moderna',
  mensagem: 'Nome da loja',
  morada: 'Rua de Santo António 10, Guimarães',
  largura_m: 2,
  altura_m: 1,
  iluminado: false,
  no_proprio_estabelecimento: true,
  data_inicio: '2026-11-02',
  meses: 12,
  ...p,
});

describe('avaliarPublicidade', () => {
  it('placa de 2 m² no próprio estabelecimento: aprova, com taxa por m² e mês', () => {
    const a = avaliarPublicidade(placa(), C, HOJE, SEM_FERIADOS);
    expect(a.proposta).toBe('aprovar');
    // 2 m² × 12 meses × 1,50 €
    expect(a.taxa.total_cent).toBe(3600);
    expect(a.taxa.linhas[0]).toMatchObject({ codigo: 'PUB', unidade: 'm2' });
  });

  it('pequena (até 1 m²) no próprio estabelecimento: mera comunicação, sem taxa', () => {
    const a = avaliarPublicidade(
      placa({ largura_m: 1, altura_m: 0.5 }),
      C,
      HOJE,
      SEM_FERIADOS,
    );
    expect(a.proposta).toBe('aprovar');
    expect(a.taxa).toEqual({ linhas: [], total_cent: 0 });
    expect(a.regras.find((r) => r.id === 'area')?.texto).toContain(
      'mera comunicação',
    );
    expect(a.condicoes[0]).toContain('Mera comunicação');
  });

  it('fora do próprio estabelecimento, grande, centro histórico, bandeirola: cada um vai a técnico', () => {
    const falha = (p: Partial<PedidoPublicidade>, id: string) =>
      expect(
        avaliarPublicidade(placa(p), C, HOJE, SEM_FERIADOS).regras.find(
          (r) => r.id === id,
        )?.ok,
      ).toBe(false);
    falha({ no_proprio_estabelecimento: false }, 'proprio');
    falha({ largura_m: 4, altura_m: 2 }, 'area');
    falha({ centro_historico: true }, 'centro_historico');
    falha({ suporte: 'bandeirola' }, 'suporte');
    falha({ meses: 24 }, 'meses');
    falha({ data_inicio: '2026-10-22' }, 'antecedencia');
  });

  it('iluminada paga a taxa de iluminada e leva a condição da luz; a câmara pode mandá-la a técnico', () => {
    const a = avaliarPublicidade(
      placa({ iluminado: true }),
      C,
      HOJE,
      SEM_FERIADOS,
    );
    expect(a.taxa.total_cent).toBe(2 * 12 * 250);
    expect(a.condicoes.join(' ')).toContain('encandear');
    expect(
      avaliarPublicidade(
        placa({ iluminado: true }),
        { ...C, iluminado_vai_a_tecnico: true },
        HOJE,
        SEM_FERIADOS,
      ).proposta,
    ).toBe('tecnico');
  });

  it('taxa mínima quando o cálculo fica abaixo', () => {
    const t = taxaPublicidade(
      placa({ largura_m: 1.5, altura_m: 1, meses: 1 }),
      C,
    );
    expect(t.total_cent).toBe(C.taxa_minima_cent);
    expect(t.linhas[0].descricao).toContain('mínima');
    expect(areaPublicidade(placa({ largura_m: 1.25, altura_m: 0.8 }))).toBe(1);
  });

  it('a entrada e a config validam com zod (os avisos têm valores por omissão)', () => {
    expect(entradaPublicidade.parse(placa())).toMatchObject({ meses: 12 });
    expect(esquemaConfigPublicidade.parse(C)).toEqual(C);
    const antiga: Record<string, unknown> = { ...C };
    delete antiga.aviso_1_dias;
    delete antiga.aviso_2_dias;
    expect(esquemaConfigPublicidade.parse(antiga)).toMatchObject({
      aviso_1_dias: 30,
      aviso_2_dias: 7,
    });
    expect(
      esquemaConfigPublicidade.safeParse({ ...C, suportes: [] }).success,
    ).toBe(false);
  });
});
