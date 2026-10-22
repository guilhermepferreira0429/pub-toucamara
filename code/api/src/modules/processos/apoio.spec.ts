import {
  aplicarEscolha,
  artigosCitados,
  ContextoProcesso,
  conteudoRascunho,
  juntarTrechos,
  limparRascunho,
  limparResumo,
  localizarDestaques,
  montarContextoProcesso,
  perguntasRegulamento,
  proximoPrazo,
  semNif,
  smsComLink,
  TrechoRegulamento,
  trechosAplicaveis,
} from './apoio.js';
import { gerarPdfOficio } from './oficio-pdf.js';

const trecho = (
  id: string,
  texto: string,
  o: Partial<TrechoRegulamento> = {},
): TrechoRegulamento => ({
  trecho_id: id,
  referencia: null,
  texto,
  fonte: 'RJUE',
  entidade: 'Câmara',
  url: 'https://exemplo.pt/rjue',
  data: '2026-10-01',
  origem: 'pesquisa',
  ...o,
});

describe('proximoPrazo', () => {
  const hoje = '2026-10-19';

  it('o mais cedo entre a câmara e os pedidos por responder', () => {
    const r = proximoPrazo(
      { fase: 'apreciacao', prazo_fim: '2026-11-20' },
      [
        { descricao: 'Certidão', prazo: '2026-10-30', estado: 'por_responder' },
        { descricao: 'Planta', prazo: '2026-10-21', estado: 'respondido' },
      ],
      hoje,
    );
    expect(r).toEqual({
      data: '2026-10-30',
      de_quem: 'municipe',
      descricao: 'O munícipe entregar: Certidão.',
      atrasado: false,
    });
  });

  it('o da câmara, e em atraso', () => {
    const r = proximoPrazo(
      { fase: 'decisao', prazo_fim: '2026-10-10' },
      [],
      hoje,
    );
    expect(r).toMatchObject({ de_quem: 'camara', atrasado: true });
  });

  it('processo fechado: sem prazo', () => {
    expect(
      proximoPrazo(
        { fase: 'arquivado', prazo_fim: '2026-10-30' },
        [{ descricao: 'X', prazo: '2026-10-25', estado: 'por_responder' }],
        hoje,
      ),
    ).toBeNull();
  });
});

describe('semNif', () => {
  it('tira nove algarismos seguidos ou em grupos de três', () => {
    expect(semNif('NIF 123456789, tel. 912 345 678, n.º 12')).toBe(
      'NIF [omitido], tel. [omitido], n.º 12',
    );
  });

  it('não mexe em números mais compridos nem em datas', () => {
    expect(semNif('ref 1234567890 a 2026-10-19')).toBe(
      'ref 1234567890 a 2026-10-19',
    );
  });
});

const contexto = (): ContextoProcesso => ({
  numero: 'CP 412/2026',
  tipo: { codigo: 'CP', nome: 'Comunicação prévia', prazo_dias_uteis: 20 },
  assunto: 'Porta na cozinha',
  morada: 'Rua A, 1',
  freguesia: 'Oliveira',
  fase: 'documentos',
  fase_rotulo: 'Documentos',
  decisao: null,
  tecnico: 'Ana Costa',
  prazo: { inicio: null, fim: null, dias_uteis_restantes: null },
  municipe: { nome: 'Maria F.', tem_telefone: true, tem_email: false },
  requerimento: {
    estado: 'entregue',
    assinatura: 'simulada',
    campos: [
      {
        chave: 'nif',
        rotulo: 'NIF',
        tipo: 'nif',
        obrigatorio: true,
        valor: 'Registado (não se mostra)',
      },
      {
        chave: 'descricao',
        rotulo: 'Descrição da obra',
        tipo: 'texto',
        obrigatorio: true,
        valor: 'Abrir uma porta; contacto 912345678',
      },
    ],
  },
  documentos: [
    {
      tipo_documento: 'Certidão do registo predial',
      origem: 'foto',
      verificacao_estado: 'fora_de_prazo',
      verificacao: [
        { regra: 'validade', ok: false, detalhe: 'emitida há 8 meses' },
      ],
      emitido_em: '2026-02-01',
      recebido_em: new Date('2026-10-10T10:00:00Z'),
    },
  ],
  em_falta: [{ nome: 'Planta de localização', prazo: '2026-10-30' }],
  pedidos: [
    {
      descricao: 'Planta de localização',
      nota: null,
      prazo: '2026-10-30',
      estado: 'por_responder',
    },
  ],
  eventos: [
    {
      tipo: 'nota_interna',
      descricao: 'Ligar ao requerente.',
      interno: true,
      ator_nome: 'Ana Costa',
      em: new Date('2026-10-12T09:00:00Z'),
    },
  ],
  conversa: {
    canal: 'telefone',
    iniciada_em: new Date('2026-10-09T15:00:00Z'),
    resumo: 'Quer abrir uma porta.',
    proximos_passos: ['Enviar a planta'],
  },
});

describe('montarContextoProcesso', () => {
  it('tem as secções e não leva NIF nem telefones', () => {
    const t = montarContextoProcesso(contexto(), '2026-10-19');
    expect(t).toContain('Processo CP 412/2026');
    expect(t).toContain('- NIF: registado');
    expect(t).toContain(
      'verificação: fora_de_prazo (falhou: validade: emitida há 8 meses)',
    );
    expect(t).toContain('Planta de localização (pedido, prazo 2026-10-30)');
    expect(t).toContain('(nota interna) · Ana Costa: Ligar ao requerente.');
    expect(t).toContain('Quer abrir uma porta.');
    expect(t).not.toContain('912345678');
    expect(t).toContain('ainda não começou');
  });
});

describe('limparResumo', () => {
  it('limpa espaços, tira NIF, corta pontos e usa o prazo calculado', () => {
    const r = limparResumo(
      {
        o_caso: '  Pede   licença. ',
        requerente: 'Maria, NIF 123456789.',
        o_que_ja_ha: 'Requerimento.',
        o_que_falta: 'Planta.',
        prazos: 'Até 30/10.',
        pontos_de_atencao: ['a', '', 'b', 'c', 'd', 'e', 'f'],
        proximo_passo_sugerido: 'Aguardar a planta.',
      },
      null,
    );
    expect(r.o_caso).toBe('Pede licença.');
    expect(r.requerente).toBe('Maria, NIF [omitido].');
    expect(r.pontos_de_atencao).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.prazos).toEqual({ texto: 'Até 30/10.', proximo: null });
  });
});

describe('juntarTrechos', () => {
  it('base legal primeiro, sem repetir id nem texto', () => {
    const base = [trecho('a', 'Art. 4.º texto', { origem: 'base_legal' })];
    const p1 = [trecho('b', 'Outro'), trecho('a', 'Art. 4.º texto')];
    const p2 = [trecho('c', '  outro '), trecho('d', 'Terceiro')];
    expect(juntarTrechos([base, p1, p2]).map((t) => t.trecho_id)).toEqual([
      'a',
      'b',
      'd',
    ]);
  });

  it('respeita o máximo', () => {
    const l = [trecho('a', '1'), trecho('b', '2'), trecho('c', '3')];
    expect(juntarTrechos([l], 2)).toHaveLength(2);
  });
});

describe('trechosAplicaveis', () => {
  const ampliacao =
    'CP Comunicação prévia · obras de alteração. Ampliação da moradia (1.º andar)';
  const esplanada = (id: string) =>
    trecho(id, 'Artigo 2.º A instalação de esplanada aberta…', {
      fonte: 'Regulamento das esplanadas abertas (texto de demonstração)',
      tipo_fonte: 'regulamento',
    });

  it('tira as esplanadas de uma ampliação de moradia e fica com o RJUE', () => {
    const l = [
      esplanada('e1'),
      trecho('r1', 'Estão sujeitas a comunicação prévia as obras…'),
      esplanada('e2'),
      trecho('r2', 'Estão isentas de controlo prévio…'),
    ];
    expect(trechosAplicaveis(l, ampliacao).map((t) => t.trecho_id)).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('mantém as esplanadas num processo de esplanada', () => {
    const l = [esplanada('e1'), trecho('r1', 'RJUE')];
    expect(
      trechosAplicaveis(l, 'ESP Licença de esplanada. Esplanada · Café').map(
        (t) => t.trecho_id,
      ),
    ).toEqual(['e1', 'r1']);
  });

  it('a base legal fica sempre; turismo e contactos nunca; no máximo 3', () => {
    const l = [
      { ...esplanada('base'), origem: 'base_legal' as const },
      trecho('t', 'Visite o castelo', { tipo_fonte: 'turismo' }),
      trecho('c', 'Telefone 253…', { tipo_fonte: 'contactos' }),
      trecho('r1', 'a'),
      trecho('r2', 'b'),
      trecho('r3', 'c'),
    ];
    expect(trechosAplicaveis(l, ampliacao).map((t) => t.trecho_id)).toEqual([
      'base',
      'r1',
      'r2',
    ]);
  });

  it('sem nada aplicável devolve a lista vazia', () => {
    expect(trechosAplicaveis([esplanada('e1')], ampliacao)).toEqual([]);
  });

  it('o ruído não entra numa obra, mas entra numa licença de ruído', () => {
    const r = trecho('ru', 'Atividades ruidosas temporárias…', {
      fonte: 'Regulamento Geral do Ruído',
    });
    expect(trechosAplicaveis([r], ampliacao)).toEqual([]);
    expect(
      trechosAplicaveis([r], 'LER Licença especial de ruído. Arraial'),
    ).toHaveLength(1);
  });
});

describe('perguntasRegulamento', () => {
  it('duas perguntas quando há pontos do caso', () => {
    expect(
      perguntasRegulamento({
        tipo: 'Comunicação prévia',
        assunto: 'Porta',
        descricao: '',
        pontos: ['Certidão fora de prazo'],
      }),
    ).toEqual(['Comunicação prévia. Porta', 'Certidão fora de prazo']);
  });

  it('só uma sem pontos', () => {
    expect(
      perguntasRegulamento({
        tipo: 'X',
        assunto: 'Y',
        descricao: 'Z',
        pontos: [],
      }),
    ).toEqual(['X. Y. Z']);
  });
});

describe('localizarDestaques', () => {
  const texto =
    'Estão isentas de controlo prévio as obras de alteração no interior. Exceto as que alterem a estrutura.';

  it('posições das frases literais; as inventadas descartam-se', () => {
    const d = localizarDestaques(texto, [
      'as obras de alteração no interior',
      'obras de conservação', // não existe
      '"Exceto as que alterem a estrutura."',
    ]);
    expect(d.map((x) => texto.slice(x.inicio, x.fim))).toEqual([
      'as obras de alteração no interior',
      'Exceto as que alterem a estrutura.',
    ]);
  });

  it('junta sobrepostas e ignora frases curtas', () => {
    const d = localizarDestaques(texto, [
      'isentas de controlo',
      'controlo prévio',
      'as',
    ]);
    expect(d).toHaveLength(1);
    expect(texto.slice(d[0].inicio, d[0].fim)).toBe(
      'isentas de controlo prévio',
    );
  });
});

describe('aplicarEscolha', () => {
  const trechos = [
    trecho('base', 'Base legal do tipo.', { origem: 'base_legal' }),
    trecho('x', 'Regra que se aplica aqui.'),
    trecho('y', 'Regra que não interessa.'),
  ];

  it('só os escolhidos, pela ordem da IA; a base legal fica sempre', () => {
    const r = aplicarEscolha(trechos, {
      trechos: [
        { n: 2, porque_se_aplica: 'Porque sim.', frases: ['se aplica'] },
        { n: 2, porque_se_aplica: 'Repetido.', frases: [] },
        { n: 9, porque_se_aplica: 'Fora da lista.', frases: [] },
      ],
    });
    expect(r.map((t) => t.trecho_id)).toEqual(['base', 'x']);
    expect(r[0].porque_se_aplica).toBeNull();
    expect(r[1].destaques).toEqual([{ inicio: 10, fim: 19 }]);
  });
});

describe('rascunhos', () => {
  it('o conteúdo leva elementos, prazo, destaques e modelo', () => {
    const c = conteudoRascunho({
      tipo: 'pedido_elementos',
      municipio: 'Câmara Municipal de X',
      processo: 'Processo CP 1/2026',
      destinatario: 'Maria Fernandes',
      regulamento: [
        {
          ...trecho('a', 'O prazo é de 10 dias.', { referencia: 'art. 11.º' }),
          porque_se_aplica: 'Fixa o prazo.',
          destaques: [{ inicio: 2, fim: 7 }],
        },
      ],
      modelo: { nome: 'Pedido de elementos', corpo: 'Exmo(a). {nome}' },
      documentos_pedidos: [{ nome: 'Planta' }],
      prazo_dias_uteis: 10,
      instrucoes: 'Tom simpático.',
    });
    expect(c).toContain('Destinatário: Maria Fernandes');
    expect(c).toContain('RJUE · art. 11.º (Fixa o prazo.)');
    expect(c).toContain('O »prazo« é de 10 dias.');
    expect(c).toContain('- Planta\nPrazo: 10 dias úteis');
    expect(c).toContain('Exmo(a). {nome}');
    expect(c).toContain('Tom simpático.');
  });

  it('sem regulamento manda não citar artigos', () => {
    const c = conteudoRascunho({
      tipo: 'oficio',
      municipio: 'X',
      processo: 'P',
      destinatario: null,
      regulamento: [],
      modelo: null,
      documentos_pedidos: [],
      prazo_dias_uteis: null,
      instrucoes: null,
    });
    expect(c).toContain('não cites artigos');
    expect(c).not.toContain('Elementos a pedir');
  });

  it('limpa cercas de código; o SMS fica numa linha', () => {
    expect(limparRascunho('```\nOlá\n\n\n\nAdeus  \n```', 'oficio')).toBe(
      'Olá\n\nAdeus',
    );
    expect(limparRascunho('Câmara:\nprocesso\n CP 1', 'notificacao_sms')).toBe(
      'Câmara: processo CP 1',
    );
  });

  it('artigos citados pelo corpo', () => {
    const r = artigosCitados('Nos termos do Art. 11.º do RJUE, pedimos…', [
      { referencia: 'art. 11.º, n.º 2', fonte: 'RJUE' },
      { referencia: 'art. 4.º', fonte: 'RJUE' },
      { referencia: null, fonte: 'Tabela' },
    ]);
    expect(r).toEqual([{ referencia: 'art. 11.º, n.º 2', fonte: 'RJUE' }]);
  });

  it('o SMS leva o link uma vez', () => {
    expect(smsComLink('Câmara X: processo CP 1.', 'https://t.pt/r/a')).toBe(
      'Câmara X: processo CP 1. https://t.pt/r/a',
    );
    expect(smsComLink('Veja https://t.pt/r/a', 'https://t.pt/r/a')).toBe(
      'Veja https://t.pt/r/a',
    );
  });
});

describe('gerarPdfOficio', () => {
  it('gera um PDF', async () => {
    const pdf = await gerarPdfOficio({
      municipio: 'Câmara Municipal de X',
      titulo: 'Pedido de elementos',
      numeroProcesso: 'CP 1/2026',
      assuntoProcesso: 'Porta',
      data: '2026-10-19',
      corpo: 'Exma. Senhora,\n\nPedimos a planta.',
      aprovacao: { por: 'Ana Costa', em: new Date(), simulada: true },
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
