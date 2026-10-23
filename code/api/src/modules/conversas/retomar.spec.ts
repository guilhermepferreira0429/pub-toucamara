import type { WebhookTranscricao } from './elevenlabs.js';
import {
  AVISO_GRAVACAO,
  anteriorDaChamada,
  esquemaInicioChamada,
  frasePendentes,
  primeiroNome,
  quandoFalado,
  quandoFuturoFalado,
  resumoCurto,
  serveDeContexto,
  VARIAVEIS_VAZIAS,
  variaveisInicio,
} from './retomar.js';

const FUSO = 'Europe/Lisbon';
// Segunda-feira, 19 de outubro de 2026, 11:00 em Lisboa (WEST, UTC+1).
const AGORA = new Date('2026-10-19T10:00:00Z');
const lx = (iso: string) => new Date(`${iso}+01:00`);

describe('quandoFalado', () => {
  it('há pouco, hoje e ontem com o período do dia', () => {
    expect(quandoFalado(lx('2026-10-19T10:40:00'), AGORA, FUSO)).toBe(
      'há pouco',
    );
    expect(quandoFalado(lx('2026-10-19T08:15:00'), AGORA, FUSO)).toBe(
      'hoje de manhã',
    );
    expect(quandoFalado(lx('2026-10-18T16:00:00'), AGORA, FUSO)).toBe(
      'ontem à tarde',
    );
    expect(quandoFalado(lx('2026-10-18T22:30:00'), AGORA, FUSO)).toBe(
      'ontem à noite',
    );
  });

  it('conta dias de calendário no fuso do município, não 24 h', () => {
    // 23:30 de domingo em Lisboa já é segunda em UTC+2, mas aqui é ontem.
    expect(quandoFalado(lx('2026-10-18T23:30:00'), AGORA, FUSO)).toBe(
      'ontem à noite',
    );
    // 00:30 de hoje: menos de 24 h, mas é hoje.
    expect(quandoFalado(lx('2026-10-19T00:30:00'), AGORA, FUSO)).toBe(
      'hoje de madrugada',
    );
  });

  it('dia da semana até 6 dias, com "no" para sábado e domingo', () => {
    expect(quandoFalado(lx('2026-10-13T15:00:00'), AGORA, FUSO)).toBe(
      'na terça-feira',
    );
    expect(quandoFalado(lx('2026-10-17T10:00:00'), AGORA, FUSO)).toBe(
      'no sábado',
    );
  });

  it('data por extenso a partir de uma semana (com o ano se for outro)', () => {
    expect(quandoFalado(lx('2026-10-03T10:00:00'), AGORA, FUSO)).toBe(
      'a 3 de outubro',
    );
    expect(
      quandoFalado(
        new Date('2025-12-20T10:00:00Z'),
        new Date('2026-01-05T10:00:00Z'),
        FUSO,
      ),
    ).toBe('a 20 de dezembro de 2025');
  });
});

describe('quandoFuturoFalado', () => {
  it('hoje, amanhã, dia da semana e data, com a hora', () => {
    expect(quandoFuturoFalado(lx('2026-10-19T15:30:00'), AGORA, FUSO)).toBe(
      'hoje às 15h30',
    );
    expect(quandoFuturoFalado(lx('2026-10-20T10:00:00'), AGORA, FUSO)).toBe(
      'amanhã às 10h',
    );
    expect(quandoFuturoFalado(lx('2026-10-22T09:00:00'), AGORA, FUSO)).toBe(
      'na quinta-feira às 9h',
    );
    expect(
      quandoFuturoFalado(new Date('2026-11-03T13:05:00Z'), AGORA, FUSO),
    ).toBe('a 3 de novembro às 13h05');
    expect(quandoFuturoFalado(lx('2026-10-20T01:00:00'), AGORA, FUSO)).toBe(
      'amanhã à 1h',
    );
  });
});

describe('frasePendentes', () => {
  it('vazio sem pendentes', () => {
    expect(frasePendentes([], AGORA, FUSO)).toBe('');
  });

  it('o mais urgente primeiro e no máximo 3', () => {
    const f = frasePendentes(
      [
        { tipo: 'ocorrencia', numero: 'OC-0381', categoria: 'buraco na via' },
        {
          tipo: 'requerimento',
          estado: 'a_preencher',
          nome: 'licença de obras',
        },
        {
          tipo: 'documentos',
          processo: 'CP 412/2026',
          documentos: ['Certidão do registo predial', 'Planta', 'Caderneta'],
        },
        {
          tipo: 'marcacao',
          inicio: lx('2026-10-20T10:00:00'),
          agenda: 'Balcão Único',
        },
        { tipo: 'requerimento', estado: 'pronto', nome: 'ocupação da via' },
      ],
      AGORA,
      FUSO,
    );
    expect(f).toBe(
      'Tem marcação amanhã às 10h (Balcão Único); o requerimento de ocupação da via está por assinar; ' +
        'e faltam documentos no processo CP 412/2026 (Certidão do registo predial e Planta, entre outros).',
    );
  });

  it('um só pendente, sem "e"', () => {
    expect(
      frasePendentes(
        [{ tipo: 'ocorrencia', numero: 'OC-1', categoria: 'lixo' }],
        AGORA,
        FUSO,
      ),
    ).toBe('A ocorrência OC-1 (lixo) ainda está em aberto.');
  });
});

describe('resumoCurto', () => {
  it('prefere o texto do SMS e junta tudo numa linha', () => {
    expect(resumoCurto('Pediu\n licença.', 'Resumo do painel.')).toBe(
      'Pediu licença.',
    );
    expect(resumoCurto(null, '  Resumo do painel. ')).toBe('Resumo do painel.');
    expect(resumoCurto(null, null)).toBe('');
  });

  it('corta no fim de uma frase ou numa palavra', () => {
    const longo = `${'a'.repeat(200)}. ${'b '.repeat(100)}`;
    expect(resumoCurto(null, longo)).toBe(`${'a'.repeat(200)}.`);
    const semPontos = 'palavra '.repeat(60);
    const r = resumoCurto(null, semPontos, 50);
    expect(r.endsWith('…')).toBe(true);
    expect(r.length).toBeLessThanOrEqual(51);
  });
});

describe('serveDeContexto', () => {
  it('só dos últimos 30 dias e nunca uma emergência', () => {
    const ha = (dias: number) => new Date(AGORA.getTime() - dias * 86_400_000);
    expect(serveDeContexto(null, AGORA)).toBe(false);
    expect(
      serveDeContexto({ iniciada_em: ha(29), resultado: 'resolvida' }, AGORA),
    ).toBe(true);
    expect(
      serveDeContexto({ iniciada_em: ha(31), resultado: 'resolvida' }, AGORA),
    ).toBe(false);
    expect(
      serveDeContexto({ iniciada_em: ha(1), resultado: 'emergencia' }, AGORA),
    ).toBe(false);
  });
});

describe('variaveisInicio', () => {
  const ultima = {
    id: '6f1c2b3a-1111-4222-8333-944455566677',
    iniciada_em: lx('2026-10-18T16:00:00'),
    resultado: 'resolvida',
    resumo: 'Resumo para funcionários.',
    resumo_sms: 'Pediu licença para abrir uma porta.',
  };

  it('todas as variáveis são strings e estão sempre presentes', () => {
    const v = variaveisInicio({
      nome: null,
      ultima: null,
      pendentes: [],
      agora: AGORA,
      fuso: FUSO,
    });
    expect(v).toEqual(VARIAVEIS_VAZIAS);
    expect(Object.values(v).every((x) => typeof x === 'string')).toBe(true);
  });

  it('com conversa recente: contexto e o id para ligar no fim', () => {
    expect(
      variaveisInicio({
        nome: 'Maria da Conceição Silva',
        ultima,
        pendentes: [],
        agora: AGORA,
        fuso: FUSO,
      }),
    ).toEqual({
      nome_municipe: 'Maria',
      ja_ligou: 'sim',
      ultima_conversa_quando: 'ontem à tarde',
      ultima_conversa_resumo: 'Pediu licença para abrir uma porta.',
      pendentes: '',
      ultima_conversa_id: ultima.id,
      aviso_gravacao: AVISO_GRAVACAO,
    });
  });

  it('última foi emergência: sem contexto, mas com os pendentes', () => {
    const v = variaveisInicio({
      nome: 'Rui',
      ultima: { ...ultima, resultado: 'emergencia' },
      pendentes: [{ tipo: 'ocorrencia', numero: 'OC-1', categoria: 'lixo' }],
      agora: AGORA,
      fuso: FUSO,
    });
    expect(v.ja_ligou).toBe('nao');
    expect(v.ultima_conversa_id).toBe('');
    expect(v.ultima_conversa_resumo).toBe('');
    expect(v.pendentes).toBe('A ocorrência OC-1 (lixo) ainda está em aberto.');
  });
});

describe('primeiroNome', () => {
  it('primeira palavra ou vazio', () => {
    expect(primeiroNome('  Ana  Rita ')).toBe('Ana');
    expect(primeiroNome(null)).toBe('');
  });
});

describe('esquemaInicioChamada', () => {
  it('aceita o pedido do ElevenLabs e campos a mais', () => {
    const p = esquemaInicioChamada.parse({
      caller_id: '+351912345678',
      agent_id: 'agent_1',
      called_number: '+351253000000',
      call_sid: 'CA123',
      conversation_id: 'conv_1',
      outro: 1,
    });
    expect(p.caller_id).toBe('+351912345678');
  });
});

describe('anteriorDaChamada', () => {
  const dados = (v: unknown) =>
    ({
      agent_id: 'a',
      conversation_id: 'c',
      conversation_initiation_client_data: {
        dynamic_variables: { ultima_conversa_id: v },
      },
    }) as WebhookTranscricao['data'];

  it('lê o id devolvido no início da chamada', () => {
    expect(
      anteriorDaChamada(dados('6f1c2b3a-1111-4222-8333-944455566677')),
    ).toBe('6f1c2b3a-1111-4222-8333-944455566677');
  });

  it('vazio ou inválido: nada a ligar', () => {
    expect(anteriorDaChamada(dados(''))).toBeNull();
    expect(anteriorDaChamada(dados('x'))).toBeNull();
    expect(anteriorDaChamada(dados(undefined))).toBeNull();
  });
});
