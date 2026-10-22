import { PARQUES_DEMO } from './demonstracao.js';
import {
  chaveAuto,
  custoEstacionar,
  dentroDoHorario,
  horarioDito,
  normalizarMatricula,
  parquesPerto,
  situacaoMulta,
  tarifaDita,
} from './regras.js';

const LISBOA = 'Europe/Lisbon';

describe('estacionamento · regras', () => {
  it('matrículas portuguesas em qualquer escrita; o resto não', () => {
    expect(normalizarMatricula('aa 12 bc')).toBe('AA-12-BC');
    expect(normalizarMatricula('45-ZX-90')).toBe('45-ZX-90');
    expect(normalizarMatricula('00aa00')).toBe('00-AA-00');
    expect(normalizarMatricula('AA-BB-CC')).toBeNull();
    expect(normalizarMatricula('12-34-56')).toBeNull();
    expect(normalizarMatricula('A1-23-BC')).toBeNull();
    expect(normalizarMatricula('AA-12')).toBeNull();
    expect(chaveAuto('est-demo 0001')).toBe('ESTDEMO0001');
  });

  it('por pagar e dentro do prazo: paga ou defende', () => {
    const s = situacaoMulta(
      {
        estado: 'por_pagar',
        prazo_pagamento: '2026-11-10',
        prazo_defesa: '2026-11-10',
      },
      '2026-11-01',
    );
    expect(s).toMatchObject({
      pode_pagar: true,
      pode_defender: true,
      fora_do_prazo_pagamento: false,
    });
  });

  it('fora do prazo: ainda paga, já não defende; defesa recusada não se repete', () => {
    const fora = situacaoMulta(
      {
        estado: 'por_pagar',
        prazo_pagamento: '2026-11-10',
        prazo_defesa: '2026-11-10',
      },
      '2026-11-11',
    );
    expect(fora).toMatchObject({
      pode_pagar: true,
      pode_defender: false,
      fora_do_prazo_pagamento: true,
    });
    const recusada = situacaoMulta(
      {
        estado: 'por_pagar',
        prazo_pagamento: '2026-11-30',
        prazo_defesa: '2026-11-30',
        defesa_estado: 'recusada',
      },
      '2026-11-11',
    );
    expect(recusada.pode_defender).toBe(false);
  });

  it('em defesa, paga ou anulada: nada a pagar agora', () => {
    for (const estado of ['em_defesa', 'paga', 'anulada'] as const) {
      const s = situacaoMulta(
        { estado, prazo_pagamento: '2026-11-10', prazo_defesa: '2026-11-10' },
        '2026-11-01',
      );
      expect(s.pode_pagar).toBe(false);
      expect(s.pode_defender).toBe(false);
    }
  });

  it('custo: minutos grátis, hora começada paga-se, teto diário', () => {
    const t = {
      primeira_hora_cent: 90,
      hora_seguinte_cent: 70,
      maximo_dia_cent: 800,
      minutos_gratis: 15,
    };
    expect(custoEstacionar(t, 10)).toBe(0);
    expect(custoEstacionar(t, 60)).toBe(90); // 45 min pagos → 1 hora
    expect(custoEstacionar(t, 136)).toBe(230); // 121 min pagos → 3 horas
    expect(custoEstacionar(t, 24 * 60)).toBe(800);
  });

  it('horário: dentro e fora, no fuso de Lisboa', () => {
    const zona = PARQUES_DEMO.find((p) => p.chave === 'zona_centro')!;
    // Quinta-feira 22 de outubro de 2026, 10h em Lisboa (09h UTC, hora de verão).
    expect(
      dentroDoHorario(zona.horario, new Date('2026-10-22T09:00:00Z'), LISBOA),
    ).toBe(true);
    // A mesma quinta às 19h30.
    expect(
      dentroDoHorario(zona.horario, new Date('2026-10-22T18:30:00Z'), LISBOA),
    ).toBe(false);
    // Domingo: grátis.
    expect(
      dentroDoHorario(zona.horario, new Date('2026-10-25T10:00:00Z'), LISBOA),
    ).toBe(false);
  });

  it('horário e tarifa ditos em português', () => {
    const zona = PARQUES_DEMO.find((p) => p.chave === 'zona_centro')!;
    expect(horarioDito(zona.horario)).toBe(
      'segunda a sexta das 8h às 19h; sábado das 8h às 13h',
    );
    expect(horarioDito({ seg: ['00:00-24:00'], ter: ['00:00-24:00'] })).toBe(
      'segunda a terça 24 horas',
    );
    expect(
      tarifaDita({
        primeira_hora_cent: 90,
        hora_seguinte_cent: 70,
        maximo_dia_cent: 800,
        minutos_gratis: 15,
      }),
    ).toBe(
      '15 minutos grátis, 0,90 € a primeira hora, 0,70 € cada hora seguinte, máximo de 8,00 € por dia',
    );
  });

  it('parques perto de uma zona; sem zona, todos; zona desconhecida, nenhum', () => {
    const perto = parquesPerto(PARQUES_DEMO, 'perto do Paço dos Duques');
    expect(perto.encontrou).toBe(true);
    expect(perto.parques[0].chave).toBe('parque_mumadona');
    const toural = parquesPerto(PARQUES_DEMO, 'Largo do Toural');
    expect(toural.parques.map((p) => p.chave)).toContain(
      'parque_sao_francisco',
    );
    expect(parquesPerto(PARQUES_DEMO, undefined)).toMatchObject({
      encontrou: true,
    });
    expect(parquesPerto(PARQUES_DEMO, 'centro').parques).toHaveLength(
      PARQUES_DEMO.length,
    );
    expect(parquesPerto(PARQUES_DEMO, 'Lisboa Oriente')).toEqual({
      parques: [],
      encontrou: false,
    });
  });
});
