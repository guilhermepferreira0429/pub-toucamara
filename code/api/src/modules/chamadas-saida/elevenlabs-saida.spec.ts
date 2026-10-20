import { esquemaTranscricao } from '../conversas/elevenlabs.js';
import {
  chamadaDaTranscricao,
  esquemaFalhaInicio,
  municipeFalou,
  pedirChamada,
  refDaFalha,
} from './elevenlabs-saida.js';

const PEDIDO = {
  apiKey: 'xi_teste',
  via: 'twilio' as const,
  agentId: 'agent_1',
  numeroId: 'phn_1',
  para: '+351912345678',
  variaveis: { tipo_chamada: 'saida', nome_municipe: 'Maria' },
  utilizador: 'mun-1',
};

function resposta(status: number, corpo: unknown): Response {
  return new Response(
    typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    { status },
  );
}

describe('pedirChamada', () => {
  it('Twilio: URL, header, corpo e conversation_id/callSid', async () => {
    const buscar = jest.fn().mockResolvedValue(
      resposta(200, {
        success: true,
        message: 'ok',
        conversation_id: 'conv_1',
        callSid: 'CA123',
      }),
    );
    await expect(pedirChamada(buscar, PEDIDO)).resolves.toEqual({
      ok: true,
      conversationId: 'conv_1',
      callRef: 'CA123',
    });
    const [url, init] = buscar.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.elevenlabs.io/v1/convai/twilio/outbound-call',
    );
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe(
      'xi_teste',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      agent_id: 'agent_1',
      agent_phone_number_id: 'phn_1',
      to_number: '+351912345678',
      conversation_initiation_client_data: {
        dynamic_variables: { tipo_chamada: 'saida', nome_municipe: 'Maria' },
        user_id: 'mun-1',
      },
      telephony_call_config: { ringing_timeout_secs: 40 },
    });
  });

  it('SIP trunk: outro caminho, sip_call_id', async () => {
    const buscar = jest.fn().mockResolvedValue(
      resposta(200, {
        success: true,
        message: 'ok',
        conversation_id: 'conv_2',
        sip_call_id: 'sip-9',
      }),
    );
    const r = await pedirChamada(buscar, { ...PEDIDO, via: 'sip_trunk' });
    expect((buscar.mock.calls[0] as [string])[0]).toBe(
      'https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call',
    );
    expect(r).toEqual({ ok: true, conversationId: 'conv_2', callRef: 'sip-9' });
  });

  it('erros voltam no resultado, sem lançar', async () => {
    const com = (r: Response | Error) =>
      pedirChamada(
        r instanceof Error
          ? jest.fn().mockRejectedValue(r)
          : jest.fn().mockResolvedValue(r),
        PEDIDO,
      );
    await expect(
      com(resposta(422, { detail: [{ msg: 'to_number' }] })),
    ).resolves.toMatchObject({
      ok: false,
      erro: expect.stringContaining('422') as unknown,
    });
    await expect(
      com(resposta(200, { success: false, message: 'sem saldo' })),
    ).resolves.toEqual({ ok: false, erro: 'ElevenLabs recusou: sem saldo' });
    await expect(com(resposta(200, 'não é json'))).resolves.toMatchObject({
      ok: false,
    });
    await expect(com(new Error('ECONNRESET'))).resolves.toEqual({
      ok: false,
      erro: 'ElevenLabs inacessível: ECONNRESET',
    });
  });
});

describe('call_initiation_failure (exemplos da documentação)', () => {
  const twilio = {
    type: 'call_initiation_failure',
    event_timestamp: 1759931652,
    data: {
      agent_id: 'xyz',
      conversation_id: 'abc',
      failure_reason: 'busy',
      metadata: {
        type: 'twilio',
        body: {
          Direction: 'outbound-api',
          CallSid: 'CA8367245817625617832576245724',
          CallStatus: 'busy',
          To: '+441111111111',
        },
      },
    },
  };
  const sip = {
    type: 'call_initiation_failure',
    event_timestamp: 1759931652,
    data: {
      agent_id: 'xyz',
      conversation_id: 'abc',
      failure_reason: 'no-answer',
      metadata: {
        type: 'sip',
        body: {
          sip_status_code: 486,
          call_sid: 'd8e7f6a5-b4c3-4d5e-8f9a-0b1c2d3e4f5a',
        },
      },
    },
  };

  it('lê o payload e o id do operador', () => {
    const t = esquemaFalhaInicio.parse(twilio).data;
    expect(t.failure_reason).toBe('busy');
    expect(refDaFalha(t)).toBe('CA8367245817625617832576245724');
    expect(refDaFalha(esquemaFalhaInicio.parse(sip).data)).toBe(
      'd8e7f6a5-b4c3-4d5e-8f9a-0b1c2d3e4f5a',
    );
  });
});

describe('transcrição de uma chamada de saída', () => {
  const ID = '6f1c2b1e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';
  const transcricao = (transcript: { role: string; message: string }[]) =>
    esquemaTranscricao.parse({
      type: 'post_call_transcription',
      data: {
        agent_id: 'agent_1',
        conversation_id: 'conv_1',
        transcript,
        conversation_initiation_client_data: {
          dynamic_variables: { tipo_chamada: 'saida', chamada_saida_id: ID },
        },
      },
    }).data;

  it('a nossa chamada pela variável chamada_saida_id', () => {
    expect(chamadaDaTranscricao(transcricao([]))).toBe(ID);
  });

  it('atendida só se o munícipe disse alguma coisa', () => {
    expect(
      municipeFalou(
        transcricao([
          { role: 'agent', message: 'Bom dia, fala da câmara.' },
          { role: 'user', message: 'Sim, diga.' },
        ]),
      ),
    ).toBe(true);
    expect(
      municipeFalou(
        transcricao([{ role: 'agent', message: 'Bom dia, fala da câmara.' }]),
      ),
    ).toBe(false);
  });
});
