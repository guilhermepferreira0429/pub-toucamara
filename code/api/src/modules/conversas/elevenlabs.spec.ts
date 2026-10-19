import {
  assinar,
  consentiuNaAnalise,
  converterTurnos,
  esquemaTranscricao,
  resultadoPorOmissao,
  telefoneDaChamada,
  verificarAssinatura,
} from './elevenlabs.js';

const SEGREDO = 'wsec_teste';
const CORPO = JSON.stringify({
  type: 'post_call_transcription',
  data: { conversation_id: 'abc' },
});

describe('verificarAssinatura', () => {
  const agora = new Date('2026-10-19T10:00:00Z');
  const t = Math.floor(agora.getTime() / 1000);

  it('aceita a assinatura certa (string ou Buffer)', () => {
    const cab = assinar(CORPO, SEGREDO, t);
    expect(verificarAssinatura(cab, CORPO, SEGREDO, agora)).toEqual({
      valida: true,
    });
    expect(
      verificarAssinatura(cab, Buffer.from(CORPO), SEGREDO, agora).valida,
    ).toBe(true);
  });

  it('recusa corpo alterado ou segredo errado', () => {
    const cab = assinar(CORPO, SEGREDO, t);
    expect(verificarAssinatura(cab, CORPO + ' ', SEGREDO, agora)).toEqual({
      valida: false,
      motivo: 'nao_confere',
    });
    expect(verificarAssinatura(cab, CORPO, 'outro', agora).valida).toBe(false);
  });

  it('recusa fora dos 30 minutos', () => {
    const cab = assinar(CORPO, SEGREDO, t - 31 * 60);
    expect(verificarAssinatura(cab, CORPO, SEGREDO, agora)).toEqual({
      valida: false,
      motivo: 'fora_de_tempo',
    });
    const dentro = assinar(CORPO, SEGREDO, t - 29 * 60);
    expect(verificarAssinatura(dentro, CORPO, SEGREDO, agora).valida).toBe(
      true,
    );
  });

  it('recusa cabeçalho em falta ou mal formado', () => {
    expect(verificarAssinatura(undefined, CORPO, SEGREDO, agora)).toEqual({
      valida: false,
      motivo: 'sem_cabecalho',
    });
    expect(verificarAssinatura(`t=${t},v1=abc`, CORPO, SEGREDO, agora)).toEqual(
      { valida: false, motivo: 'formato' },
    );
    expect(verificarAssinatura(`t=${t},v0=abc`, CORPO, SEGREDO, agora)).toEqual(
      { valida: false, motivo: 'formato' },
    );
  });
});

describe('converterTurnos', () => {
  it('tira entradas sem texto, numera e calcula o fim pelo turno seguinte', () => {
    const turnos = converterTurnos(
      [
        { role: 'agent', message: 'Olá, Tou, Câmara?', time_in_call_secs: 0 },
        {
          role: 'user',
          message: '  Quero abrir uma porta ',
          time_in_call_secs: 3,
        },
        { role: 'agent', message: null, time_in_call_secs: 8 },
        {
          role: 'agent',
          message: 'Precisa de comunicação prévia.',
          time_in_call_secs: 9.5,
        },
      ],
      20,
    );
    expect(turnos).toEqual([
      {
        ordem: 1,
        papel: 'agente',
        texto: 'Olá, Tou, Câmara?',
        inicio_ms: 0,
        fim_ms: 3000,
      },
      {
        ordem: 2,
        papel: 'municipe',
        texto: 'Quero abrir uma porta',
        inicio_ms: 3000,
        fim_ms: 9500,
      },
      {
        ordem: 3,
        papel: 'agente',
        texto: 'Precisa de comunicação prévia.',
        inicio_ms: 9500,
        fim_ms: 20000,
      },
    ]);
  });

  it('sem tempos nem duração fica a null', () => {
    const [t] = converterTurnos([{ role: 'user', message: 'Olá' }], null);
    expect(t).toMatchObject({
      inicio_ms: null,
      fim_ms: null,
      papel: 'municipe',
    });
  });
});

describe('resultadoPorOmissao', () => {
  const municipe = converterTurnos([{ role: 'user', message: 'Olá' }], null);
  const soAgente = converterTurnos([{ role: 'agent', message: 'Olá' }], null);

  it('caiu se o munícipe não falou ou a chamada foi muito curta', () => {
    expect(resultadoPorOmissao(60, soAgente)).toBe('caiu');
    expect(resultadoPorOmissao(5, municipe)).toBe('caiu');
  });

  it('resolvida nos outros casos', () => {
    expect(resultadoPorOmissao(60, municipe)).toBe('resolvida');
    expect(resultadoPorOmissao(null, municipe)).toBe('resolvida');
  });
});

describe('payload do ElevenLabs', () => {
  const base = {
    type: 'post_call_transcription',
    event_timestamp: 1739537297,
    data: {
      agent_id: 'agent_x',
      conversation_id: 'conv_x',
      status: 'done',
      transcript: [
        {
          role: 'agent',
          message: 'Olá',
          tool_calls: null,
          time_in_call_secs: 0,
        },
      ],
      metadata: {
        start_time_unix_secs: 1739537297,
        call_duration_secs: 22,
        cost: 296,
      },
      analysis: {
        call_successful: 'success',
        transcript_summary: '…',
        data_collection_results: {
          consentimento_gravacao: {
            data_collection_id: 'x',
            value: true,
            rationale: '',
          },
        },
      },
      conversation_initiation_client_data: {
        dynamic_variables: { system__caller_id: '+351912345678' },
      },
    },
  };

  it('lê o formato oficial e deixa passar campos extra', () => {
    const r = esquemaTranscricao.parse(base);
    expect(consentiuNaAnalise(r.data)).toBe(true);
    expect(telefoneDaChamada(r.data)).toBe('+351912345678');
  });

  it('sem campo de consentimento ou com "não" → sem consentimento', () => {
    const sem = esquemaTranscricao.parse({
      ...base,
      data: {
        ...base.data,
        analysis: null,
        conversation_initiation_client_data: null,
      },
    });
    expect(consentiuNaAnalise(sem.data)).toBe(false);
    expect(telefoneDaChamada(sem.data)).toBeNull();
    const nao = esquemaTranscricao.parse({
      ...base,
      data: {
        ...base.data,
        analysis: {
          data_collection_results: {
            consentimento_gravacao: { value: 'false' },
          },
        },
      },
    });
    expect(consentiuNaAnalise(nao.data)).toBe(false);
  });
});
