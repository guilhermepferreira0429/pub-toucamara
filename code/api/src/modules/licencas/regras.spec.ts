import {
  avaliarRuido,
  CONFIG_RUIDO_OMISSAO,
  eNoiteLonga,
  PedidoRuido,
} from './regras';

const SEM_FERIADOS = new Set<string>();
// Quarta-feira, 21 de outubro de 2026.
const HOJE = '2026-10-21';

const festa = (p: Partial<PedidoRuido> = {}): PedidoRuido => ({
  atividade: 'festa_privada',
  data: '2026-10-31', // sábado
  hora_inicio: '20:00',
  hora_fim: '01:00',
  pessoas: 40,
  musica_amplificada: true,
  ...p,
});

describe('avaliarRuido', () => {
  it('festa no sábado até à 1h, com antecedência: dentro das regras', () => {
    const a = avaliarRuido(festa(), CONFIG_RUIDO_OMISSAO, HOJE, SEM_FERIADOS);
    expect(a.proposta).toBe('aprovar');
    expect(a.hora_fim_max).toBe('02:00');
    expect(a.regras.every((r) => r.ok)).toBe(true);
    // Música depois da meia-noite: a condição de passar para dentro.
    expect(a.condicoes.join(' ')).toContain('dentro de casa');
  });

  it('numa terça o limite é a meia-noite: até à 1h vai para um técnico', () => {
    const a = avaliarRuido(
      festa({ data: '2026-11-03' }),
      CONFIG_RUIDO_OMISSAO,
      HOJE,
      SEM_FERIADOS,
    );
    expect(a.proposta).toBe('tecnico');
    expect(a.regras.find((r) => r.id === 'hora_fim')).toMatchObject({
      ok: false,
    });
  });

  it('véspera de feriado conta como noite longa', () => {
    expect(eNoiteLonga('2026-11-30', new Set(['2026-12-01']))).toBe(true);
    expect(eNoiteLonga('2026-11-30', SEM_FERIADOS)).toBe(false);
  });

  it('sem antecedência mínima (amanhã) → técnico', () => {
    const a = avaliarRuido(
      festa({ data: '2026-10-22' }),
      CONFIG_RUIDO_OMISSAO,
      HOJE,
      SEM_FERIADOS,
    );
    expect(a.proposta).toBe('tecnico');
    expect(a.regras.find((r) => r.id === 'antecedencia')?.ok).toBe(false);
  });

  it('data no passado, muitas pessoas, obra: técnico com o motivo de cada regra', () => {
    expect(
      avaliarRuido(
        festa({ data: '2026-10-01' }),
        CONFIG_RUIDO_OMISSAO,
        HOJE,
        SEM_FERIADOS,
      ).regras[0],
    ).toMatchObject({ id: 'data', ok: false });
    expect(
      avaliarRuido(
        festa({ pessoas: 400 }),
        CONFIG_RUIDO_OMISSAO,
        HOJE,
        SEM_FERIADOS,
      ).regras.find((r) => r.id === 'pessoas')?.ok,
    ).toBe(false);
    expect(
      avaliarRuido(
        festa({ atividade: 'obra' }),
        CONFIG_RUIDO_OMISSAO,
        HOJE,
        SEM_FERIADOS,
      ).proposta,
    ).toBe('tecnico');
  });

  it('duração acima do máximo e início cedo demais', () => {
    const a = avaliarRuido(
      festa({ hora_inicio: '08:00', hora_fim: '23:00' }),
      CONFIG_RUIDO_OMISSAO,
      HOJE,
      SEM_FERIADOS,
    );
    expect(a.regras.find((r) => r.id === 'hora_inicio')?.ok).toBe(false);
    expect(a.regras.find((r) => r.id === 'duracao')?.ok).toBe(false);
  });

  it('a câmara muda os números e a decisão muda com eles', () => {
    const a = avaliarRuido(
      festa({ data: '2026-11-03' }),
      { ...CONFIG_RUIDO_OMISSAO, hora_fim_max_semana: '01:00' },
      HOJE,
      SEM_FERIADOS,
    );
    expect(a.proposta).toBe('aprovar');
  });
});
