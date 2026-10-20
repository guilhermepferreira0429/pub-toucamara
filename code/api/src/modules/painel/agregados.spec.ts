import {
  LinhaResultados,
  LinhaTrabalho,
  mapaCalor,
  montarSeries,
  resumir,
  resumirProcessos,
  somarTrabalho,
  topTemas,
  trabalhoFeito,
} from './agregados.js';

function res(p: Partial<LinhaResultados>): LinhaResultados {
  return {
    total: 0,
    terminadas: 0,
    resolvidas_sem_humano: 0,
    passadas: 0,
    sem_resposta: 0,
    marcacoes: 0,
    emergencias: 0,
    fora_de_horas: 0,
    duracao_total_s: 0,
    com_duracao: 0,
    ...p,
  };
}

function trab(p: Partial<LinhaTrabalho>): LinhaTrabalho {
  return { ...somarTrabalho([]), ...p };
}

describe('resumir', () => {
  it('soma os canais, separa chamadas e calcula % e médias', () => {
    const r = resumir([
      res({
        canal: 'telefone',
        total: 6,
        terminadas: 5,
        resolvidas_sem_humano: 3,
        fora_de_horas: 1,
        duracao_total_s: 600,
        com_duracao: 5,
      }),
      res({
        canal: 'chat',
        total: 4,
        terminadas: 4,
        resolvidas_sem_humano: 3,
        passadas: 1,
        fora_de_horas: 1,
      }),
    ]);
    expect(r).toMatchObject({
      conversas: 10,
      chamadas: 6,
      escritas: 4,
      resolvidas_sem_humano_pct: 66.7, // 6 de 9 terminadas
      passadas: 1,
      fora_de_horas_pct: 20,
      duracao_media_s: 120,
    });
  });

  it('sem conversas não inventa percentagens', () => {
    expect(resumir([])).toMatchObject({
      conversas: 0,
      resolvidas_sem_humano_pct: null,
      duracao_media_s: null,
    });
  });
});

describe('mapaCalor', () => {
  it('7 × 24 com segunda na primeira linha e o máximo', () => {
    const m = mapaCalor([
      { dia_semana: 1, hora: 9, total: 4 },
      { dia_semana: 7, hora: 23, total: 2 },
      { dia_semana: 1, hora: 9, total: 1 },
      { dia_semana: 8, hora: 0, total: 99 }, // ignorado
    ]);
    expect(m.celulas).toHaveLength(7);
    expect(m.celulas[0]).toHaveLength(24);
    expect(m.celulas[0][9]).toBe(5);
    expect(m.celulas[6][23]).toBe(2);
    expect(m.maximo).toBe(5);
    expect(m.dias[0]).toBe('seg');
  });
});

describe('topTemas', () => {
  it('ordena, corta e compara com o período anterior', () => {
    const t = topTemas(
      [
        { tema_id: 'a', tema: 'Água', total: 5 },
        { tema_id: 'b', tema: 'Obras', total: 10 },
        { tema_id: 'c', tema: 'Lixo', total: 5 },
      ],
      [
        { tema_id: 'b', total: 8 },
        { tema_id: 'a', total: 10 },
      ],
      2,
    );
    expect(t.map((x) => x.tema)).toEqual(['Obras', 'Água']);
    expect(t[0]).toMatchObject({
      total: 10,
      anterior: 8,
      variacao: 25,
      percentagem: 50,
    });
    expect(t[1]).toMatchObject({ variacao: -50, novo: false });
  });

  it('tema que não existia vem marcado como novo', () => {
    const [t] = topTemas([{ tema_id: 'x', tema: 'Feira', total: 3 }], []);
    expect(t).toMatchObject({ anterior: 0, variacao: null, novo: true });
  });
});

describe('trabalhoFeito', () => {
  it('só os números do agente, com variação quando há anterior', () => {
    const atual = trab({ requerimentos: 4, sms_enviados: 50 });
    expect(trabalhoFeito(atual)).toMatchObject({ requerimentos: 4 });
    expect(trabalhoFeito(atual)).not.toHaveProperty('sms_enviados');
    expect(
      trabalhoFeito(atual, trab({ requerimentos: 2 })).requerimentos,
    ).toMatchObject({ valor: 4, anterior: 2, variacao: 100 });
  });
});

describe('montarSeries', () => {
  it('preenche os baldes vazios e junta resultados e trabalho', () => {
    const s = montarSeries(
      ['2026-10-12', '2026-10-19'],
      [
        res({
          balde: '2026-10-19',
          canal: 'telefone',
          total: 3,
          terminadas: 2,
          resolvidas_sem_humano: 1,
        }),
        res({
          balde: '2026-10-19',
          canal: 'chat',
          total: 1,
          terminadas: 1,
          resolvidas_sem_humano: 1,
        }),
      ],
      [
        trab({
          balde: '2026-10-19',
          ocorrencias_resolvidas: 2,
          horas_resolucao: 5,
          sms_enviados: 3,
        }),
      ],
      'semana',
    );
    expect(s[0]).toMatchObject({
      balde: '2026-10-12',
      conversas: { total: 0, por_canal: {} },
      resolvidas_sem_humano_pct: null,
    });
    expect(s[1]).toMatchObject({
      conversas: { total: 4, por_canal: { telefone: 3, chat: 1 } },
      resolvidas_sem_humano_pct: 66.7,
      sms: { enviados: 3 },
      ocorrencias: { resolvidas: 2, tempo_medio_resolucao_h: 2.5 },
    });
  });
});

describe('resumirProcessos', () => {
  it('por fase (média ponderada) e carga por técnico sem os notificados', () => {
    const r = resumirProcessos([
      {
        fase: 'apreciacao',
        tecnico_id: 't1',
        tecnico: 'Ana',
        total: 3,
        atrasados: 1,
        dias_medios_na_fase: 10,
      },
      {
        fase: 'apreciacao',
        tecnico_id: null,
        tecnico: null,
        total: 1,
        atrasados: 0,
        dias_medios_na_fase: 2,
      },
      {
        fase: 'entrada',
        tecnico_id: 't1',
        tecnico: 'Ana',
        total: 2,
        atrasados: 0,
        dias_medios_na_fase: 1,
      },
      {
        fase: 'notificado',
        tecnico_id: 't1',
        tecnico: 'Ana',
        total: 5,
        atrasados: 0,
        dias_medios_na_fase: 3,
      },
    ]);
    // Os 5 notificados aparecem por fase mas não contam como em curso.
    expect(r.em_curso).toBe(6);
    expect(r.atrasados).toBe(1);
    expect(r.por_fase.map((f) => f.fase)).toEqual([
      'entrada',
      'apreciacao',
      'notificado',
    ]);
    expect(r.por_fase[1].dias_medios_na_fase).toBe(8);
    expect(r.por_tecnico).toEqual([
      { tecnico_id: 't1', tecnico: 'Ana', total: 5, atrasados: 1 },
      { tecnico_id: null, tecnico: 'Sem técnico', total: 1, atrasados: 0 },
    ]);
  });
});
