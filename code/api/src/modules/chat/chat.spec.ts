import { cartaoDe, fontesDe, trechosDe } from './chat.cartoes.js';
import { conteudoRedigir, entradaRedigir } from './chat.ferramentas.js';
import { mensagensDoHistorico, MAX_TURNOS } from './chat.historico.js';
import { blocoMunicipio, SISTEMA_CHAT } from './chat.prompt.js';
import { dataLocal } from './chat.service.js';
import { LimitePedidos } from './limite.js';
import { formatarEvento } from './sse.js';

const fonte = (id: string, url: string, referencia: string | null = null) => ({
  trecho_id: id,
  titulo: 'RJUE',
  url,
  entidade: 'Câmara',
  referencia,
  lida_em: '2026-10-01',
});

describe('cartaoDe', () => {
  const pesquisa = {
    sem_fonte: false,
    respostas: [
      { resposta_id: 'r1', fontes: [fonte('a', 'https://x/rjue', 'art. 6.º')] },
    ],
    trechos: [
      { ...fonte('a', 'https://x/rjue', 'art. 6.º'), texto: '...' },
      { ...fonte('b', 'https://x/taxas'), texto: '...' },
    ],
  };

  it('procurar_conhecimento dá o cartão de fontes, sem repetidos', () => {
    expect(cartaoDe('procurar_conhecimento', pesquisa)).toEqual({
      tipo: 'fonte',
      fontes: [
        {
          titulo: 'RJUE',
          url: 'https://x/rjue',
          entidade: 'Câmara',
          referencia: 'art. 6.º',
        },
        {
          titulo: 'RJUE',
          url: 'https://x/taxas',
          entidade: 'Câmara',
          referencia: null,
        },
      ],
    });
  });

  it('sem fonte não há cartão', () => {
    expect(
      cartaoDe('procurar_conhecimento', {
        sem_fonte: true,
        respostas: [],
        trechos: [],
      }),
    ).toBeNull();
  });

  it('passagem, vagas e processo levam o resultado da ferramenta', () => {
    const passagem = {
      passagem_id: 'p1',
      fora_de_horas: true,
      responder_ate: '2026-10-21T10:00:00.000Z',
      dizer: 'Respondemos até amanhã às 11h.',
    };
    expect(cartaoDe('passar_a_humano', passagem)).toEqual({
      tipo: 'passagem',
      ferramenta: 'passar_a_humano',
      dados: passagem,
    });
    const vagas = {
      agenda: { agenda_id: 'a1', nome: 'Urbanismo', local: 'Balcão 2' },
      vagas: [{ inicio: '2026-10-22T09:00:00+01:00', dito: 'quinta às 9h' }],
      sem_vagas: false,
    };
    expect(cartaoDe('ver_vagas', vagas)).toMatchObject({
      tipo: 'vagas',
      dados: vagas,
    });
    expect(
      cartaoDe('estado_processo', { precisa_identificacao: true }),
    ).toMatchObject({
      tipo: 'processo',
      dados: { precisa_identificacao: true },
    });
    expect(cartaoDe('ver_vagas', vagas, true)).toBeNull();
  });

  it('mapeia cada ferramenta conhecida para o seu cartão', () => {
    const casos: [string, string][] = [
      ['encaminhar', 'contacto'],
      ['marcar', 'marcacao'],
      ['agendar_recolha', 'marcacao'],
      ['simular_taxa', 'simulacao'],
      ['criar_pagamento', 'pagamento'],
      ['redigir', 'rascunho'],
      ['iniciar_requerimento', 'requerimento'],
      ['concluir_requerimento', 'requerimento'],
      ['registar_ocorrencia', 'ocorrencia'],
    ];
    for (const [nome, tipo] of casos) {
      expect(cartaoDe(nome, { a: 1 })).toEqual({
        tipo,
        ferramenta: nome,
        dados: { a: 1 },
      });
    }
  });

  it('ferramentas desconhecidas e erros não geram cartão', () => {
    expect(cartaoDe('identificar_municipe', { identificado: true })).toBeNull();
    expect(cartaoDe('inventada', {})).toBeNull();
    expect(cartaoDe('marcar', { erro: {} }, true)).toBeNull();
  });

  it('a emergência mostra sempre o 112, mesmo com erro', () => {
    expect(cartaoDe('emergencia', { registado: true })).toEqual({
      tipo: 'emergencia',
      telefone: '112',
      dados: { registado: true },
    });
    expect(cartaoDe('emergencia', null, true)).toEqual({
      tipo: 'emergencia',
      telefone: '112',
      dados: {},
    });
  });

  it('trechosDe junta os trechos das respostas e da pesquisa', () => {
    expect(trechosDe(pesquisa)).toEqual(['a', 'b']);
    expect(trechosDe(null)).toEqual([]);
    expect(fontesDe('lixo')).toEqual([]);
  });
});

describe('mensagensDoHistorico', () => {
  it('começa no munícipe, põe o contexto na primeira e alterna papéis', () => {
    const m = mensagensDoHistorico(
      [
        { papel: 'agente', texto: 'Olá!' },
        { papel: 'municipe', texto: 'Preciso de licença?' },
        { papel: 'agente', texto: 'Depende.' },
        { papel: 'sistema', texto: 'nota interna' },
        { papel: 'municipe', texto: 'Para a cozinha.' },
      ],
      '<contexto>c</contexto>',
    );
    expect(m).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '<contexto>c</contexto>' },
          { type: 'text', text: 'Preciso de licença?' },
        ],
      },
      { role: 'assistant', content: 'Depende.' },
      { role: 'user', content: 'Para a cozinha.' },
    ]);
  });

  it('sem mensagens do munícipe não há nada a mandar', () => {
    expect(
      mensagensDoHistorico([{ papel: 'agente', texto: 'Olá' }], 'c'),
    ).toEqual([]);
  });

  it('fica só com os últimos turnos', () => {
    const turnos = Array.from({ length: MAX_TURNOS + 10 }, (_, i) => ({
      papel: i % 2 ? ('agente' as const) : ('municipe' as const),
      texto: String(i),
    }));
    const m = mensagensDoHistorico(turnos, 'c');
    expect(m.length).toBeLessThanOrEqual(MAX_TURNOS);
    expect(m[0].role).toBe('user');
    expect(m[m.length - 1].content).toBe(String(MAX_TURNOS + 9));
  });
});

describe('LimitePedidos', () => {
  it('deixa passar até ao máximo na janela e volta a deixar depois', () => {
    const l = new LimitePedidos(2, 1000);
    expect(l.permitir('s', 0)).toBe(true);
    expect(l.permitir('s', 10)).toBe(true);
    expect(l.permitir('s', 20)).toBe(false);
    expect(l.permitir('outra', 20)).toBe(true);
    expect(l.permitir('s', 1001)).toBe(true);
  });
});

describe('prompt do chat', () => {
  it('o system fixo não tem datas', () => {
    expect(SISTEMA_CHAT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(SISTEMA_CHAT).toContain('112');
  });

  it('o bloco do município leva nome, tratamento e idiomas', () => {
    const b = blocoMunicipio({
      municipio: 'Vila Exemplo',
      nome: 'Ana',
      trata_por: 'você',
      idiomas: ['pt-PT', 'en'],
    });
    expect(b).toContain('Vila Exemplo');
    expect(b).toContain('Ana');
    expect(b).toContain('"você"');
    expect(b).toContain('pt-PT, en');
  });

  it('dataLocal usa o fuso do município', () => {
    const d = new Date('2026-10-19T23:30:00Z');
    expect(dataLocal(d, 'Europe/Lisbon')).toContain('20 de outubro de 2026');
    expect(dataLocal(d, 'Atlantic/Azores')).toContain('19 de outubro de 2026');
  });
});

describe('redigir', () => {
  it('monta o pedido com os factos e destinatário por omissão', () => {
    const e = entradaRedigir.parse({
      tipo: 'reclamacao',
      assunto: 'Buraco na rua',
      factos: 'Há um buraco na Rua Direita há três semanas.',
    });
    const c = conteudoRedigir('Vila Exemplo', e);
    expect(c).toContain('Tipo: reclamação');
    expect(c).toContain('Destinatário: Câmara Municipal');
    expect(c).toContain('Há um buraco na Rua Direita');
  });
});

describe('formatarEvento', () => {
  it('escreve no formato text/event-stream', () => {
    expect(formatarEvento('fim', { turno_id: '7' })).toBe(
      'event: fim\ndata: {"turno_id":"7"}\n\n',
    );
  });
});
