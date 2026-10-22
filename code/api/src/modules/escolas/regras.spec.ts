import {
  avaliarTransporte,
  contaDoMes,
  diasDeAulasDoMes,
  escalaoDoAbono,
  escolherPorNome,
  podeAlterarRefeicao,
  precoRefeicao,
} from './regras.js';

const SEM_FERIADOS = new Set<string>();

describe('escolas · regras', () => {
  it('escalão da ação social pelo abono: 1 → A, 2 → B, resto sem escalão', () => {
    expect(escalaoDoAbono(1)).toBe('A');
    expect(escalaoDoAbono(2)).toBe('B');
    expect(escalaoDoAbono(3)).toBe('sem');
    expect(escalaoDoAbono(undefined)).toBe('sem');
  });

  it('preço da refeição: A gratuito, B metade, sem escalão o preço inteiro', () => {
    expect(precoRefeicao('A')).toBe(0);
    expect(precoRefeicao('B')).toBe(73);
    expect(precoRefeicao('sem')).toBe(146);
  });

  it('dias de aulas do mês sem fins de semana nem feriados', () => {
    // Outubro de 2026: 22 dias úteis; 5 de outubro é feriado.
    expect(diasDeAulasDoMes('2026-10', SEM_FERIADOS)).toHaveLength(22);
    expect(diasDeAulasDoMes('2026-10', new Set(['2026-10-05']))).toHaveLength(
      21,
    );
  });

  it('conta do mês: desde a inscrição, sem os desmarcados, com os marcados à parte', () => {
    const c = contaDoMes({
      mes: '2026-10',
      desde: '2026-10-19',
      escalao: 'B',
      excecoes: new Map([
        ['2026-10-20', false],
        ['2026-10-15', true],
      ]),
      feriados: SEM_FERIADOS,
    });
    // 19–30 out: 10 dias úteis, menos 1 desmarcado, mais 1 marcado antes.
    expect(c.refeicoes).toBe(10);
    expect(c.preco_cent).toBe(73);
    expect(c.total_cent).toBe(730);
  });

  it('marcar/desmarcar: até às 10h do dia anterior, só em dias de aulas', () => {
    // 22 out 2026 (quinta) às 09:00 em Lisboa (UTC+1 no verão).
    const manha = new Date('2026-10-22T08:00:00Z');
    const tarde = new Date('2026-10-22T14:00:00Z');
    expect(podeAlterarRefeicao('2026-10-23', SEM_FERIADOS, manha).ok).toBe(
      true,
    );
    const tardeDemais = podeAlterarRefeicao('2026-10-23', SEM_FERIADOS, tarde);
    expect(tardeDemais.ok).toBe(false);
    expect(!tardeDemais.ok && tardeDemais.motivo).toBe('fora_de_prazo');
    expect(podeAlterarRefeicao('2026-10-26', SEM_FERIADOS, tarde).ok).toBe(
      true,
    );
    const sabado = podeAlterarRefeicao('2026-10-24', SEM_FERIADOS, manha);
    expect(!sabado.ok && sabado.motivo).toBe('sem_aulas');
    const hoje = podeAlterarRefeicao('2026-10-22', SEM_FERIADOS, manha);
    expect(!hoje.ok && hoje.motivo).toBe('dia_passado');
  });

  it('transporte: a partir de 3 km cumpre; sem distância, a câmara mede', () => {
    expect(avaliarTransporte(4.2).proposta).toBe('cumpre');
    expect(avaliarTransporte(3).proposta).toBe('cumpre');
    expect(avaliarTransporte(1.5).proposta).toBe('nao_cumpre');
    expect(avaliarTransporte(undefined).proposta).toBe('por_medir');
  });

  it('escolher pelo nome dito, sem acentos e com palavras soltas', () => {
    const escolas = [
      { nome: 'EB de Azurém' },
      { nome: 'EB de Pevidém' },
      { nome: 'Jardim de Infância de Creixomil' },
    ];
    expect(escolherPorNome(escolas, 'azurem')).toEqual({ um: escolas[0] });
    expect(escolherPorNome(escolas, 'a escola de Pevidem')).toEqual({
      um: escolas[1],
    });
    expect(escolherPorNome(escolas, 'EB')).toEqual({
      varios: escolas.slice(0, 2),
    });
    expect(escolherPorNome(escolas, 'Braga')).toEqual({ nenhum: true });
  });
});
