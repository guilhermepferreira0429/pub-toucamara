import { limparNif, nifPorConfirmar } from './atendimento.ferramentas.js';
import {
  ContactoDito,
  eEmergencia,
  escolherContacto,
  fraseEncaminhar,
  TipoContacto,
} from './encaminhamento.service.js';
import { chaveResposta, frasePassagem } from './passagens.service.js';

const c = (id: string, tipo: TipoContacto) => ({ id, tipo });

describe('encaminhar', () => {
  it('contacto da regra ganha; senão telefone antes de email', () => {
    const lista = [c('1', 'email'), c('2', 'avarias'), c('3', 'telefone')];
    expect(escolherContacto(lista, '2').principal?.id).toBe('2');
    expect(escolherContacto(lista, null).principal?.id).toBe('3');
    expect(escolherContacto(lista, 'outro').principal?.id).toBe('3');
    expect(escolherContacto(lista, null).outros.map((x) => x.id)).toEqual([
      '2',
      '1',
    ]);
    expect(escolherContacto([], null)).toEqual({ principal: null, outros: [] });
  });

  it('emergência: prioridade 0 ou entidade de emergência', () => {
    expect(eEmergencia({ prioridade: 0, entidade_tipo: 'nacional' })).toBe(
      true,
    );
    expect(eEmergencia({ prioridade: 50, entidade_tipo: 'emergencia' })).toBe(
      true,
    );
    expect(
      eEmergencia({ prioridade: 100, entidade_tipo: 'empresa_municipal' }),
    ).toBe(false);
  });

  it('frase a dizer', () => {
    const linha: ContactoDito = {
      tipo: 'avarias',
      rotulo: 'Avarias, 24 horas',
      valor: '800 000 000',
      horario: '24 horas, todos os dias',
      aberto_agora: true,
    };
    expect(fraseEncaminhar('Águas', linha)).toBe(
      'Isso é tratado por Águas: pode ligar para o 800 000 000 (Avarias, 24 horas), que está aberto agora.',
    );
    expect(
      fraseEncaminhar('Ambiente', {
        tipo: 'telefone',
        rotulo: null,
        valor: '253 000 000',
        horario: 'seg-sex 9:00-16:00',
        aberto_agora: false,
      }),
    ).toBe(
      'Isso é tratado por Ambiente: pode ligar para o 253 000 000, que agora está fechado; o horário é seg-sex 9:00-16:00.',
    );
    expect(
      fraseEncaminhar('Finanças', {
        tipo: 'site',
        rotulo: null,
        valor: 'portaldasfinancas.gov.pt',
        horario: null,
        aberto_agora: null,
      }),
    ).toBe(
      'Isso é tratado por Finanças: tem tudo em portaldasfinancas.gov.pt.',
    );
    expect(fraseEncaminhar('X', null)).toBe('Isso é tratado por X.');
  });
});

describe('passagem', () => {
  it('frase com prazo, canal e fora de horas', () => {
    expect(
      frasePassagem({
        foraDeHoras: false,
        quando: 'amanhã às 12h',
        preferencia: 'sms',
      }),
    ).toBe(
      'Passei o seu caso a um colega, com tudo o que me disse. Responde-lhe até amanhã às 12h, por SMS.',
    );
    expect(
      frasePassagem({
        foraDeHoras: true,
        quando: 'terça-feira às 12h',
        preferencia: 'telefone',
      }),
    ).toMatch(
      /^Os serviços estão fechados.*Ele liga-lhe até terça-feira às 12h\.$/,
    );
  });

  it('chave da resposta: mesmo texto, mesma chave', () => {
    const a = chaveResposta('p1', 'Olá, já está tratado.');
    expect(a).toBe(chaveResposta('p1', 'Olá, já está tratado.'));
    expect(a).not.toBe(chaveResposta('p1', 'Outro texto'));
    expect(a).not.toBe(chaveResposta('p2', 'Olá, já está tratado.'));
    expect(a).toMatch(/^passagem:p1:[0-9a-f]{16}$/);
  });

  it('NIF ditado com espaços ou prefixo', () => {
    expect(limparNif('123 456 789')).toBe('123456789');
    expect(limparNif('PT123456789')).toBe('123456789');
  });
});

describe('NIF ditado ao telefone', () => {
  it('válido: segue', () => {
    expect(nifPorConfirmar('213456788')).toBeNull();
  });

  it('com o último algarismo perdido: pede só esse', () => {
    expect(nifPorConfirmar(limparNif('212 345 67'))).toMatchObject({
      motivo: 'nif_incompleto',
      algarismos: 8,
    });
    expect(nifPorConfirmar('21234567')?.dizer).toMatch(/último/);
  });

  it('nove que não conferem: o número está errado, não a audição', () => {
    expect(nifPorConfirmar('213456789')).toMatchObject({
      motivo: 'nif_nao_confere',
    });
  });

  it('algarismos a mais', () => {
    expect(nifPorConfirmar('2134567880')?.motivo).toBe('nif_a_mais');
  });
});
