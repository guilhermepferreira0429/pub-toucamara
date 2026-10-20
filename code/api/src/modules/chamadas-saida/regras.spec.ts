import { VARIAVEIS_VAZIAS } from '../conversas/retomar.js';
import {
  aposNaoAtendida,
  CONFIG_DESLIGADA,
  ConfigChamadas,
  decidirChamada,
  MotivoChamada,
  dentroDaJanela,
  instanteLocal,
  lerConfig,
  proximaJanela,
  telefoneLigavel,
  VARIAVEIS_SAIDA_VAZIAS,
  variaveisSaida,
} from './regras.js';

const FUSO = 'Europe/Lisbon';
const SEM_FERIADOS = new Set<string>();

describe('telefoneLigavel', () => {
  it('móveis e fixos portugueses, estrangeiros válidos', () => {
    expect(telefoneLigavel('+351912345678')).toBe(true);
    expect(telefoneLigavel('+351253421200')).toBe(true);
    expect(telefoneLigavel('+34612345678')).toBe(true);
  });
  it('nunca tarifa especial, vazio ou mal formado', () => {
    expect(telefoneLigavel('+351808200520')).toBe(false);
    expect(telefoneLigavel('+351760100100')).toBe(false);
    expect(telefoneLigavel(null)).toBe(false);
    expect(telefoneLigavel('912345678')).toBe(false);
  });
});

describe('janela das 10h às 19h em dias úteis', () => {
  // 19/10/2026 é segunda; a hora de verão acaba a 25/10.
  it('instanteLocal acerta o fuso, com e sem hora de verão', () => {
    expect(instanteLocal('2026-10-19', 10, FUSO).toISOString()).toBe(
      '2026-10-19T09:00:00.000Z',
    );
    expect(instanteLocal('2026-10-26', 10, FUSO).toISOString()).toBe(
      '2026-10-26T10:00:00.000Z',
    );
  });

  it('dentro: segunda às 18h30; fora: às 9h, às 19h e ao sábado', () => {
    expect(
      dentroDaJanela(new Date('2026-10-19T17:30:00Z'), FUSO, SEM_FERIADOS),
    ).toBe(true);
    expect(
      dentroDaJanela(new Date('2026-10-19T08:00:00Z'), FUSO, SEM_FERIADOS),
    ).toBe(false);
    expect(
      dentroDaJanela(new Date('2026-10-19T18:00:00Z'), FUSO, SEM_FERIADOS),
    ).toBe(false);
    expect(
      dentroDaJanela(new Date('2026-10-24T11:00:00Z'), FUSO, SEM_FERIADOS),
    ).toBe(false);
  });

  it('próximo período: o próprio instante, as 10h de hoje ou o dia útil seguinte', () => {
    const dentro = new Date('2026-10-19T12:00:00Z');
    expect(proximaJanela(dentro, FUSO, SEM_FERIADOS)).toBe(dentro);
    expect(
      proximaJanela(new Date('2026-10-19T07:00:00Z'), FUSO, SEM_FERIADOS),
    ).toEqual(new Date('2026-10-19T09:00:00Z'));
    expect(
      proximaJanela(new Date('2026-10-19T18:00:00Z'), FUSO, SEM_FERIADOS),
    ).toEqual(new Date('2026-10-20T09:00:00Z'));
    // Sexta às 19h30 → segunda às 10h (já em hora de inverno).
    expect(
      proximaJanela(new Date('2026-10-23T18:30:00Z'), FUSO, SEM_FERIADOS),
    ).toEqual(new Date('2026-10-26T10:00:00Z'));
  });

  it('salta feriados', () => {
    const feriados = new Set(['2026-12-08']);
    expect(
      proximaJanela(new Date('2026-12-07T20:00:00Z'), FUSO, feriados),
    ).toEqual(new Date('2026-12-09T10:00:00Z'));
    // No próprio feriado de manhã também não.
    expect(
      proximaJanela(new Date('2026-12-08T08:00:00Z'), FUSO, feriados),
    ).toEqual(new Date('2026-12-09T10:00:00Z'));
  });
});

describe('lerConfig', () => {
  it('por omissão desligado; inválido também', () => {
    expect(lerConfig(undefined)).toEqual(CONFIG_DESLIGADA);
    expect(lerConfig({ ativo: 'sim' })).toEqual(CONFIG_DESLIGADA);
    expect(
      lerConfig({ ativo: true, motivos: ['manual'], numero_id: 'phn_1' }),
    ).toEqual({
      ativo: true,
      motivos: ['manual'],
      numero_id: 'phn_1',
      via: 'twilio',
    });
  });
});

describe('decidirChamada', () => {
  const ATIVO: ConfigChamadas = {
    ativo: true,
    motivos: ['processo_fase', 'pedido_documento', 'lembrete_prazo'],
    numero_id: 'phn_1',
    via: 'twilio',
  };
  const agora = new Date('2026-10-19T13:00:00Z'); // segunda, 14h
  const base = {
    config: ATIVO,
    motivo: 'pedido_documento' as MotivoChamada,
    municipe: {
      telefone: '+351912345678' as string | null,
      aceita_chamadas: true,
      preferido: null as string | null,
    },
    temPendente: false,
    diasLigados: new Set<string>(),
    agora,
    fuso: FUSO,
    feriados: SEM_FERIADOS,
  };

  it('liga já, dentro do período', () => {
    expect(decidirChamada(base)).toEqual({ liga: true, agendarPara: agora });
  });

  it('fora de horas agenda para o próximo período', () => {
    const noite = new Date('2026-10-19T21:00:00Z');
    expect(decidirChamada({ ...base, agora: noite })).toEqual({
      liga: true,
      agendarPara: new Date('2026-10-20T09:00:00Z'),
    });
  });

  it('desligado por omissão, por motivo e sem número de saída', () => {
    expect(decidirChamada({ ...base, config: CONFIG_DESLIGADA })).toEqual({
      liga: false,
      motivo: 'desligado',
    });
    expect(
      decidirChamada({ ...base, config: { ...ATIVO, motivos: [] } }),
    ).toEqual({ liga: false, motivo: 'motivo_desligado' });
    expect(
      decidirChamada({ ...base, config: { ...ATIVO, numero_id: null } }),
    ).toEqual({ liga: false, motivo: 'sem_numero_saida' });
  });

  it('munícipe: telefone, recusa e canal preferido', () => {
    const com = (m: Partial<typeof base.municipe>, motivo = base.motivo) =>
      decidirChamada({
        ...base,
        motivo,
        municipe: { ...base.municipe, ...m },
      });
    expect(com({ telefone: null })).toMatchObject({ motivo: 'sem_telefone' });
    expect(com({ aceita_chamadas: false })).toMatchObject({
      motivo: 'recusa_chamadas',
    });
    expect(com({ preferido: 'sms' })).toMatchObject({
      motivo: 'canal_preferido',
    });
    expect(com({ preferido: 'email' })).toMatchObject({
      motivo: 'canal_preferido',
    });
    // Sem preferência: só pedido de documento e lembrete de prazo.
    expect(com({}, 'lembrete_prazo')).toMatchObject({ liga: true });
    expect(com({}, 'processo_fase')).toMatchObject({
      motivo: 'canal_preferido',
    });
    expect(com({ preferido: 'telefone' }, 'processo_fase')).toMatchObject({
      liga: true,
    });
  });

  it('uma por dia e nunca duas por fazer', () => {
    expect(decidirChamada({ ...base, temPendente: true })).toMatchObject({
      motivo: 'ja_tem_chamada',
    });
    expect(
      decidirChamada({ ...base, diasLigados: new Set(['2026-10-19']) }),
    ).toMatchObject({ motivo: 'ja_ligado_nesse_dia' });
    // Fora de horas conta o dia para onde fica agendada.
    expect(
      decidirChamada({
        ...base,
        agora: new Date('2026-10-19T21:00:00Z'),
        diasLigados: new Set(['2026-10-19']),
      }),
    ).toMatchObject({ liga: true });
  });

  it('manual: ignora motivos, preferência e limite diário; não a recusa', () => {
    const manual = {
      ...base,
      motivo: 'manual' as const,
      manual: true,
      municipe: { ...base.municipe, preferido: 'sms' },
      diasLigados: new Set(['2026-10-19']),
    };
    expect(decidirChamada(manual)).toMatchObject({ liga: true });
    expect(
      decidirChamada({
        ...manual,
        municipe: { ...manual.municipe, aceita_chamadas: false },
      }),
    ).toMatchObject({ motivo: 'recusa_chamadas' });
    expect(
      decidirChamada({ ...manual, config: { ...ATIVO, ativo: false } }),
    ).toMatchObject({ motivo: 'desligado' });
  });

  it('forçar horário (equipa interna): liga já, mesmo à noite', () => {
    const noite = new Date('2026-10-19T22:00:00Z');
    expect(
      decidirChamada({
        ...base,
        manual: true,
        forcarHorario: true,
        agora: noite,
      }),
    ).toEqual({ liga: true, agendarPara: noite });
  });
});

describe('aposNaoAtendida', () => {
  it('à 1.ª volta a ligar 2 h depois (no período); à 2.ª desiste', () => {
    const agora = new Date('2026-10-19T10:00:00Z'); // 11h
    expect(aposNaoAtendida(1, agora, FUSO, SEM_FERIADOS)).toEqual({
      repetir: true,
      em: new Date('2026-10-19T12:00:00Z'),
    });
    // Às 18h: 2 h depois já passa das 19h → dia seguinte às 10h.
    expect(
      aposNaoAtendida(1, new Date('2026-10-19T17:00:00Z'), FUSO, SEM_FERIADOS),
    ).toEqual({ repetir: true, em: new Date('2026-10-20T09:00:00Z') });
    expect(aposNaoAtendida(2, agora, FUSO, SEM_FERIADOS)).toEqual({
      repetir: false,
    });
  });
});

describe('variáveis dinâmicas', () => {
  it('as da saída juntam a nota ao que mudou e levam o id', () => {
    expect(
      variaveisSaida('id-1', 'pedido_documento', {
        numero_processo: 'OP 12/2026',
        o_que_mudou: 'A câmara pediu-lhe: Planta.',
        nota: 'Pode ser cópia.',
        prazo: '30 de outubro',
      }),
    ).toEqual({
      tipo_chamada: 'saida',
      motivo: 'falta um documento',
      numero_processo: 'OP 12/2026',
      o_que_mudou: 'A câmara pediu-lhe: Planta. Pode ser cópia.',
      o_que_falta: '',
      prazo: '30 de outubro',
      link: '',
      chamada_saida_id: 'id-1',
    });
  });

  it('as vazias têm as mesmas chaves e não colidem com as do início', () => {
    expect(Object.keys(VARIAVEIS_SAIDA_VAZIAS).sort()).toEqual(
      Object.keys(variaveisSaida('x', 'manual', {})).sort(),
    );
    const comuns = Object.keys(VARIAVEIS_SAIDA_VAZIAS).filter(
      (k) => k in VARIAVEIS_VAZIAS,
    );
    expect(comuns).toEqual([]);
  });
});
