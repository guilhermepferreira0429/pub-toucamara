import { somarTrabalho } from '../painel/agregados.js';
import {
  formatarDia,
  formatarValor,
  formatarVariacao,
  gerarPdf,
} from './pdf.js';
import {
  EntradaRelatorio,
  montarDados,
  periodoDeComparacao,
  periodoRelatorio,
} from './relatorio.js';
import { textoEmail } from './relatorios.service.js';

describe('período do relatório', () => {
  it('semanal: a semana passada, de segunda a domingo', () => {
    expect(periodoRelatorio('semanal', '2026-10-19')).toEqual({
      de: '2026-10-12',
      ate: '2026-10-18',
    });
    // a meio da semana dá a mesma semana fechada
    expect(periodoRelatorio('semanal', '2026-10-22')).toEqual({
      de: '2026-10-12',
      ate: '2026-10-18',
    });
  });

  it('mensal: o mês passado, também em janeiro', () => {
    expect(periodoRelatorio('mensal', '2026-11-01')).toEqual({
      de: '2026-10-01',
      ate: '2026-10-31',
    });
    expect(periodoRelatorio('mensal', '2027-01-01')).toEqual({
      de: '2026-12-01',
      ate: '2026-12-31',
    });
  });

  it('o mensal compara com o mês de calendário anterior', () => {
    expect(
      periodoDeComparacao('mensal', { de: '2026-10-01', ate: '2026-10-31' }),
    ).toEqual({ de: '2026-09-01', ate: '2026-09-30' });
    expect(
      periodoDeComparacao('semanal', { de: '2026-10-12', ate: '2026-10-18' }),
    ).toEqual({ de: '2026-10-05', ate: '2026-10-11' });
    // mensal manual a meio do mês: mesmo tamanho
    expect(
      periodoDeComparacao('mensal', { de: '2026-10-05', ate: '2026-10-11' }),
    ).toEqual({ de: '2026-09-28', ate: '2026-10-04' });
  });
});

function entrada(): EntradaRelatorio {
  const zero = {
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
  };
  return {
    municipio: { nome: 'Município de Teste', slug: 'teste' },
    tipo: 'semanal',
    periodo: { de: '2026-10-12', ate: '2026-10-18' },
    anterior: { de: '2026-10-05', ate: '2026-10-11' },
    resultados: {
      atual: [
        {
          ...zero,
          canal: 'telefone',
          total: 80,
          terminadas: 80,
          resolvidas_sem_humano: 60,
          passadas: 15,
          fora_de_horas: 20,
          duracao_total_s: 16000,
          com_duracao: 80,
        },
        {
          ...zero,
          canal: 'chat',
          total: 20,
          terminadas: 20,
          resolvidas_sem_humano: 18,
          passadas: 2,
        },
      ],
      anterior: [
        {
          ...zero,
          canal: 'telefone',
          total: 50,
          terminadas: 50,
          resolvidas_sem_humano: 35,
          passadas: 10,
          fora_de_horas: 10,
        },
      ],
    },
    trabalho: {
      atual: {
        ...somarTrabalho([]),
        requerimentos: 12,
        ocorrencias: 8,
        ocorrencias_resolvidas: 4,
        horas_resolucao: 20,
        sms_enviados: 90,
        sms_segmentos: 130,
        sms_custo_cent: 520,
      },
      anterior: { ...somarTrabalho([]), requerimentos: 6, ocorrencias: 10 },
    },
    temas: {
      atual: [
        { tema_id: 't1', tema: 'Obras dentro de casa', total: 30 },
        { tema_id: 't2', tema: 'Água e saneamento', total: 12 },
      ],
      anterior: [{ tema_id: 't1', total: 20 }],
    },
    semResposta: [
      { texto: 'Posso pôr toldo na varanda?', vezes: 7, estado: 'nova' },
    ],
    ocorrenciasAbertas: 5,
    processos: [
      {
        fase: 'apreciacao',
        tecnico_id: 't',
        tecnico: 'Ana',
        total: 4,
        atrasados: 1,
        dias_medios_na_fase: 6,
      },
    ],
  };
}

describe('montarDados', () => {
  it('totais com variação, trabalho feito, temas, ocorrências e processos', () => {
    const d = montarDados(entrada());
    expect(d.titulo).toBe('Relatório semanal');
    expect(d.totais.conversas).toMatchObject({
      valor: 100,
      anterior: 50,
      variacao: 100,
    });
    expect(d.totais.resolvidas_sem_humano_pct).toMatchObject({
      valor: 78,
      anterior: 70,
      variacao: 8,
      unidade: 'pct',
    });
    expect(d.totais.chamadas.valor).toBe(80);
    expect(d.trabalho_feito.requerimentos).toMatchObject({
      valor: 12,
      variacao: 100,
    });
    expect(d.top_temas[0]).toMatchObject({
      tema: 'Obras dentro de casa',
      variacao: 50,
    });
    expect(d.top_temas[1]).toMatchObject({ novo: true });
    expect(d.ocorrencias).toMatchObject({
      registadas: { valor: 8, variacao: -20 },
      tempo_medio_resolucao_h: { valor: 5 },
      abertas_agora: 5,
    });
    expect(d.processos).toMatchObject({ em_curso: 4, atrasados: 1 });
    expect(d.sem_resposta).toHaveLength(1);
    // vai para jsonb: tem de sobreviver ao JSON
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  it('texto do email com os números principais', () => {
    const t = textoEmail(montarDados(entrada()));
    expect(t).toContain('12/10/2026 a 18/10/2026');
    expect(t).toContain('Conversas: 100');
    expect(t).toContain('78,0%');
    expect(t).toContain('- Obras dentro de casa: 30');
  });
});

describe('PDF', () => {
  it('formata dias, valores e variações à portuguesa', () => {
    expect(formatarDia('2026-10-05')).toBe('05/10/2026');
    expect(
      formatarValor({
        valor: 62.5,
        anterior: null,
        variacao: null,
        unidade: 'pct',
      }),
    ).toBe('62,5%');
    expect(
      formatarValor({
        valor: 200,
        anterior: null,
        variacao: null,
        unidade: 's',
      }),
    ).toBe('3 min 20 s');
    expect(
      formatarValor({
        valor: null,
        anterior: null,
        variacao: null,
        unidade: 'n',
      }),
    ).toBe('—');
    expect(
      formatarVariacao({ valor: 1, anterior: 1, variacao: 12.5, unidade: 'n' }),
    ).toBe('+12,5%');
    expect(
      formatarVariacao({
        valor: 1,
        anterior: 1,
        variacao: -3.1,
        unidade: 'pct',
      }),
    ).toBe('-3,1 p.p.');
    expect(
      formatarVariacao({ valor: 1, anterior: 0, variacao: null, unidade: 'n' }),
    ).toBe('');
  });

  it('gera um PDF', async () => {
    const pdf = await gerarPdf(montarDados(entrada()));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
