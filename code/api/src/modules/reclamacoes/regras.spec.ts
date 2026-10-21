import {
  calcularPrazo,
  CONFIG_DEMONSTRACAO,
  indicadores,
  lerConfig,
  precisaAviso,
  situacaoPrazo,
  smsRegisto,
  textoLerDeVolta,
} from './regras.js';

// 8 de dezembro (nacional) e 24 de junho (feriado municipal de Guimarães).
const feriados = new Set(['2026-12-08', '2026-12-25', '2026-06-24']);

describe('reclamações · prazo em dias úteis', () => {
  it('conta 15 dias úteis a partir do dia seguinte, sem fins de semana', () => {
    // quarta 21 out. + 15 dias úteis → quarta 11 nov.
    expect(calcularPrazo('2026-10-21', 15, new Set())).toBe('2026-11-11');
  });

  it('salta os feriados nacionais e os municipais', () => {
    // sexta 4 dez. + 3: seg 7, (ter 8 feriado), qua 9, qui 10
    expect(calcularPrazo('2026-12-04', 3, feriados)).toBe('2026-12-10');
    // segunda 22 jun. + 3: ter 23, (qua 24 feriado municipal), qui 25, sex 26
    expect(calcularPrazo('2026-06-22', 3, feriados)).toBe('2026-06-26');
    // sem o feriado municipal seria a quinta
    expect(calcularPrazo('2026-06-22', 3, new Set())).toBe('2026-06-25');
  });

  it('uma reclamação entrada ao sábado conta a partir de segunda', () => {
    // sábado 24 out. + 1 → segunda 26 out.
    expect(calcularPrazo('2026-10-24', 1, feriados)).toBe('2026-10-26');
  });
});

describe('reclamações · situação do prazo', () => {
  const aberta = (responder_ate: string) => ({
    estado: 'recebida' as const,
    responder_ate,
    respondida_em: null,
  });

  it('no prazo, a terminar, termina hoje e em atraso', () => {
    // hoje qua 4 nov.; limite qua 11 nov. → 5 dias úteis
    expect(
      situacaoPrazo(aberta('2026-11-11'), '2026-11-04', 2, feriados),
    ).toEqual({
      situacao: 'no_prazo',
      dias_uteis_restantes: 5,
    });
    // limite sexta 6 nov. → 2 dias úteis → a terminar
    expect(
      situacaoPrazo(aberta('2026-11-06'), '2026-11-04', 2, feriados).situacao,
    ).toBe('a_terminar');
    expect(
      situacaoPrazo(aberta('2026-11-04'), '2026-11-04', 2, feriados),
    ).toEqual({ situacao: 'termina_hoje', dias_uteis_restantes: 0 });
    const atraso = situacaoPrazo(
      aberta('2026-11-02'),
      '2026-11-04',
      2,
      feriados,
    );
    expect(atraso).toEqual({ situacao: 'em_atraso', dias_uteis_restantes: -2 });
    expect(precisaAviso(atraso)).toBe(true);
  });

  it('em atraso conta pelo menos 1 dia mesmo ao fim de semana', () => {
    // limite sexta 6 nov., hoje sábado 7 → -1
    expect(
      situacaoPrazo(aberta('2026-11-06'), '2026-11-07', 2, feriados),
    ).toEqual({ situacao: 'em_atraso', dias_uteis_restantes: -1 });
  });

  it('o feriado conta nos dias que faltam', () => {
    // hoje seg 7 dez., limite qua 9 dez. (ter 8 feriado) → 1 dia útil
    expect(
      situacaoPrazo(aberta('2026-12-09'), '2026-12-07', 0, feriados)
        .dias_uteis_restantes,
    ).toBe(1);
  });

  it('respondida: no prazo ou fora do prazo', () => {
    expect(
      situacaoPrazo(
        {
          estado: 'respondida',
          responder_ate: '2026-11-11',
          respondida_em: '2026-11-11',
        },
        '2026-11-20',
        2,
        feriados,
      ).situacao,
    ).toBe('respondida_no_prazo');
    expect(
      situacaoPrazo(
        {
          estado: 'encerrada',
          responder_ate: '2026-11-11',
          respondida_em: '2026-11-12',
        },
        '2026-11-20',
        2,
        feriados,
      ).situacao,
    ).toBe('respondida_fora_do_prazo');
  });
});

describe('reclamações · configuração e indicadores', () => {
  it('sem config usa o valor de demonstração, marcado', () => {
    expect(lerConfig(null)).toBe(CONFIG_DEMONSTRACAO);
    expect(lerConfig({ lixo: 1 })).toBe(CONFIG_DEMONSTRACAO);
    expect(CONFIG_DEMONSTRACAO.demonstracao).toBe(true);
    expect(CONFIG_DEMONSTRACAO.fonte.titulo).toContain(
      'a confirmar com o jurista',
    );
    expect(
      lerConfig({
        ...CONFIG_DEMONSTRACAO,
        prazo_dias_uteis: 10,
        demonstracao: false,
      }).prazo_dias_uteis,
    ).toBe(10);
  });

  it('respondidas no prazo, tempo médio e por serviço', () => {
    const i = indicadores(
      [
        {
          estado: 'respondida',
          recebida_em: '2026-11-02',
          responder_ate: '2026-11-23',
          respondida_em: '2026-11-04',
          servico: 'Obras',
        },
        {
          estado: 'encerrada',
          recebida_em: '2026-11-02',
          responder_ate: '2026-11-03',
          respondida_em: '2026-11-06',
          servico: 'Obras',
        },
        {
          estado: 'recebida',
          recebida_em: '2026-11-02',
          responder_ate: '2026-11-03',
          respondida_em: null,
          servico: null,
        },
        {
          estado: 'em_analise',
          recebida_em: '2026-11-05',
          responder_ate: '2026-11-26',
          respondida_em: null,
          servico: 'Ambiente',
        },
      ],
      '2026-11-10',
      feriados,
    );
    expect(i).toMatchObject({
      total: 4,
      abertas: 2,
      em_atraso: 1,
      respondidas: 2,
      respondidas_no_prazo_pct: 50,
      tempo_medio_dias_uteis: 3, // 2 e 4 dias úteis
    });
    expect(i.por_servico[0]).toEqual({
      servico: 'Obras',
      total: 2,
      abertas: 0,
      em_atraso: 0,
      respondidas_no_prazo_pct: 50,
    });
    expect(
      indicadores([], '2026-11-10', feriados).respondidas_no_prazo_pct,
    ).toBeNull();
  });
});

describe('reclamações · textos', () => {
  it('lê de volta o essencial', () => {
    const t = textoLerDeVolta({
      nome: 'Ana Sousa',
      servico_visado: 'o balcão de urbanismo',
      descricao: 'Esperei duas horas e ninguém me atendeu.',
      pedido: 'Quero uma explicação',
      resposta_por: 'sms',
    });
    expect(t).toBe(
      'Reclamação em nome de Ana Sousa, sobre o balcão de urbanismo. O que aconteceu: Esperei duas horas e ninguém me atendeu. O que pede: Quero uma explicação. A resposta segue por SMS.',
    );
  });

  it('SMS com o número, a data-limite e o link', () => {
    expect(
      smsRegisto(
        'Guimarães',
        'REC 3/2026',
        '2026-11-11',
        'https://x/reclamacao/ABC',
      ),
    ).toBe(
      'Guimarães: a sua reclamação ficou registada com o n.º REC 3/2026. A câmara tem de responder até 11 de novembro de 2026. Estado e resposta: https://x/reclamacao/ABC',
    );
  });
});
