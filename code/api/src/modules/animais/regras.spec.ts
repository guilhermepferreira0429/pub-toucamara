import {
  animalDito,
  tiposCorrespondentes,
  validarVisita,
  visitaDita,
} from './regras.js';

describe('animais · regras', () => {
  // 2026-10-22 é quinta-feira.
  const hoje = '2026-10-22';
  const semFeriados = new Set<string>();

  it('visitas: a partir de amanhã, até 60 dias, nos dias e períodos do canil', () => {
    expect(validarVisita('2026-10-23', 'tarde', hoje, semFeriados)).toEqual({
      ok: true,
    });
    expect(
      validarVisita('2026-10-22', 'manha', hoje, semFeriados),
    ).toMatchObject({ ok: false, motivo: 'passado' });
    expect(
      validarVisita('2027-01-30', 'manha', hoje, semFeriados),
    ).toMatchObject({ ok: false, motivo: 'longe' });
    // Sábado só de manhã; domingo fechado.
    expect(validarVisita('2026-10-24', 'manha', hoje, semFeriados).ok).toBe(
      true,
    );
    expect(
      validarVisita('2026-10-24', 'tarde', hoje, semFeriados),
    ).toMatchObject({ ok: false, motivo: 'fechado' });
    expect(
      validarVisita('2026-10-25', 'manha', hoje, semFeriados),
    ).toMatchObject({ ok: false, motivo: 'fechado' });
    expect(
      validarVisita('2026-10-23', 'manha', hoje, new Set(['2026-10-23'])),
    ).toMatchObject({ ok: false, motivo: 'fechado' });
  });

  it('diz o animal e a visita', () => {
    expect(
      animalDito({
        nome: 'Amora',
        especie: 'cao',
        sexo: 'femea',
        porte: 'pequeno',
        idade: 'cerca de 8 anos',
      }),
    ).toBe('Amora, cadela de porte pequeno, cerca de 8 anos');
    expect(visitaDita('2026-10-23', 'manha')).toBe(
      'sexta-feira, 23 de outubro, de manhã',
    );
  });

  it('perdido corresponde a encontrado/abandonado e vice-versa', () => {
    expect(tiposCorrespondentes('perdido')).toEqual([
      'encontrado',
      'abandonado',
    ]);
    expect(tiposCorrespondentes('encontrado')).toEqual(['perdido']);
    expect(tiposCorrespondentes('ferido')).toEqual([]);
  });
});
