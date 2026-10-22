import {
  assinaturaTwilio,
  assinaturaValida,
  estadoDoParticipante,
  nomeSala,
  quemFalado,
  twimlSala,
} from './juncao-familiar';

describe('juntar familiar', () => {
  it('TwiML da sala escapa o nome e acaba quando o munícipe sai', () => {
    const t = twimlSala('a<b>&"c"');
    expect(t).toContain('a&lt;b&gt;&amp;&quot;c&quot;');
    expect(t).toContain('endConferenceOnExit="true"');
    expect(t.startsWith('<?xml')).toBe(true);
  });

  it('a sala não leva dados pessoais', () => {
    expect(nomeSala('0f0e1d2c-3b4a-5968-7766-554433221100')).toBe(
      'tc-familiar-0f0e1d2c3b4a5968',
    );
  });

  it('estado do familiar pelo CallStatus', () => {
    expect(estadoDoParticipante('ringing', 'agente_ligado')).toBeNull();
    expect(estadoDoParticipante('in-progress', 'agente_ligado')).toBe(
      'familiar_atendeu',
    );
    expect(estadoDoParticipante('no-answer', 'agente_ligado')).toBe(
      'familiar_nao_atendeu',
    );
    expect(estadoDoParticipante('completed', 'familiar_atendeu')).toBe(
      'terminada',
    );
    expect(estadoDoParticipante('completed', 'agente_ligado')).toBe(
      'familiar_nao_atendeu',
    );
  });

  it('assinatura do Twilio (exemplo da documentação do Twilio)', () => {
    // https://www.twilio.com/docs/usage/security#validating-requests
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    const params = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+12349013030',
      Digits: '1234',
      From: '+12349013030',
      To: '+18005551212',
    };
    const a = assinaturaTwilio('12345', url, params);
    expect(a).toBe('0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
    expect(assinaturaValida('12345', url, params, a)).toBe(true);
    expect(assinaturaValida('12345', url, { ...params, Digits: '9' }, a)).toBe(
      false,
    );
    expect(assinaturaValida('', url, params, a)).toBe(false);
  });

  it('como o agente fala do familiar', () => {
    expect(quemFalado('Ana', 'a sua filha')).toBe('a sua filha Ana');
    expect(quemFalado(null, 'o seu filho')).toBe('o seu filho');
    expect(quemFalado(null, null)).toBe('o seu familiar');
  });
});
