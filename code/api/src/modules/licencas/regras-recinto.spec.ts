import {
  avaliarRecinto,
  CONFIG_RECINTO_OMISSAO,
  entradaRecinto,
  esquemaConfigRecinto,
  PedidoRecinto,
  taxaRecinto,
} from './regras-recinto';

const SEM_FERIADOS = new Set<string>();
const HOJE = '2026-10-21'; // quarta-feira
const C = CONFIG_RECINTO_OMISSAO;

const arraial = (p: Partial<PedidoRecinto> = {}): PedidoRecinto => ({
  descricao: 'Arraial de São Martinho da associação',
  morada: 'Largo da Oliveira, Guimarães',
  data_inicio: '2026-11-14',
  dias: 2,
  lotacao: 200,
  estruturas: ['palco', 'barracas'],
  musica: true,
  ...p,
});

describe('avaliarRecinto', () => {
  it('arraial de 200 pessoas com palco e barracas: aprova, taxa fixa + por dia', () => {
    const a = avaliarRecinto(arraial(), C, HOJE, SEM_FERIADOS);
    expect(a.proposta).toBe('aprovar');
    // 25 € + 2 dias × 10 €
    expect(a.taxa.total_cent).toBe(4500);
    expect(a.condicoes.join(' ')).toContain('licença especial de ruído');
    expect(a.condicoes.join(' ')).toContain('termo de responsabilidade');
  });

  it('lotação acima do máximo ou bancadas → vistoria (técnico), com o porquê', () => {
    const muita = avaliarRecinto(
      arraial({ lotacao: 800 }),
      C,
      HOJE,
      SEM_FERIADOS,
    );
    expect(muita.proposta).toBe('tecnico');
    expect(muita.regras.find((r) => r.id === 'lotacao')?.texto).toContain(
      'vistoriado',
    );
    const bancadas = avaliarRecinto(
      arraial({ estruturas: ['palco', 'bancadas'] }),
      C,
      HOJE,
      SEM_FERIADOS,
    );
    const r = bancadas.regras.find((x) => x.id === 'estruturas');
    expect(r?.ok).toBe(false);
    expect(r?.texto).toContain('Bancadas');
  });

  it('dias a mais e pouca antecedência vão a técnico; sem música não fala do ruído', () => {
    const falha = (p: Partial<PedidoRecinto>, id: string) =>
      expect(
        avaliarRecinto(arraial(p), C, HOJE, SEM_FERIADOS).regras.find(
          (r) => r.id === id,
        )?.ok,
      ).toBe(false);
    falha({ dias: 8 }, 'dias');
    falha({ data_inicio: '2026-10-28' }, 'antecedencia');
    const sem = avaliarRecinto(
      arraial({ musica: false, estruturas: [] }),
      C,
      HOJE,
      SEM_FERIADOS,
    );
    expect(sem.condicoes.join(' ')).not.toContain('ruído');
    expect(sem.regras.find((r) => r.id === 'estruturas')?.texto).toBe(
      'Sem estruturas montadas.',
    );
  });

  it('a câmara muda a lotação e as estruturas aceites e a decisão muda', () => {
    const p = arraial({ lotacao: 500, estruturas: ['bancadas'] });
    expect(avaliarRecinto(p, C, HOJE, SEM_FERIADOS).proposta).toBe('tecnico');
    expect(
      avaliarRecinto(
        p,
        { ...C, lotacao_max: 600, estruturas: ['bancadas'] },
        HOJE,
        SEM_FERIADOS,
      ).proposta,
    ).toBe('aprovar');
  });

  it('taxa sem parte fixa e validação zod', () => {
    expect(
      taxaRecinto(arraial({ dias: 3 }), { ...C, taxa_base_cent: 0 }),
    ).toEqual({
      linhas: [expect.objectContaining({ unidade: 'dia', quantidade: 3 })],
      total_cent: 3000,
    });
    expect(entradaRecinto.parse(arraial())).toMatchObject({ lotacao: 200 });
    expect(esquemaConfigRecinto.parse(C)).toEqual(C);
    expect(
      entradaRecinto.safeParse({ ...arraial(), estruturas: ['carrossel'] })
        .success,
    ).toBe(false);
  });
});
