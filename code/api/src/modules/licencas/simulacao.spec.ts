import { gerarHistoricoDemonstracao } from './historico-demonstracao';
import { CONFIG_OCUPACAO_OMISSAO } from './regras-ocupacao';
import { CONFIG_RUIDO_OMISSAO } from './regras';
import { Avaliador, PedidoAntigo, simular } from './simulacao';
import { DEFS, ENTRADAS, TIPOS } from './tipos';

/** Uma regra de brincar: aprova se n ≤ max; taxa = n × preço. */
type C = { max: number; preco: number };
const avaliar: Avaliador<C, { n: number }> = (d, c) => {
  const ok = d.n <= c.max;
  return {
    aprovado: ok,
    decisao: ok ? 'aprovado na hora' : 'vai a técnico',
    taxa_cent: d.n * c.preco,
    regras: [{ id: 'n', ok, texto: `n = ${d.n} (máx. ${c.max})` }],
  };
};
const pedido = (
  id: string,
  n: number,
  dia = '2025-01-10',
): PedidoAntigo<{ n: number }> => ({
  id,
  referencia: `X ${id}`,
  pedido_em: dia,
  dados: { n },
  demonstracao: id.startsWith('d'),
});

describe('simular', () => {
  const pedidos = [
    pedido('1', 2),
    pedido('2', 5, '2024-03-01'),
    pedido('3', 8),
    pedido('d4', 12, '2026-01-01'),
  ];

  it('regras iguais: nada muda', () => {
    const r = simular(
      { max: 6, preco: 100 },
      { max: 6, preco: 100 },
      pedidos,
      avaliar,
    );
    expect(r).toMatchObject({
      total: 4,
      mudam: 0,
      exemplos: [],
      receita: { diferenca_cent: 0 },
    });
    expect(r.aprovados).toEqual({ antes: 2, depois: 2 });
    expect(r.periodo).toEqual({ de: '2024-03-01', ate: '2026-01-01' });
    expect(r.pedidos_de_demonstracao).toBe(1);
  });

  it('apertar a regra: quem deixa de ser aprovado, a receita perdida e o porquê', () => {
    const r = simular(
      { max: 6, preco: 100 },
      { max: 3, preco: 100 },
      pedidos,
      avaliar,
    );
    expect(r.deixam_de_ser_aprovados).toBe(1);
    expect(r.passam_a_ser_aprovados).toBe(0);
    expect(r.receita).toEqual({
      antes_cent: 700,
      depois_cent: 200,
      diferenca_cent: -500,
    });
    expect(r.exemplos[0]).toMatchObject({
      id: '2',
      antes: { aprovado: true, taxa_cent: 500 },
      depois: { aprovado: false, taxa_cent: 0 },
    });
    expect(r.exemplos[0].porque[0]).toMatch(/^Passa a falhar: n = 5/);
    expect(r.por_regra).toEqual([
      { id: 'n', passam_a_falhar: 1, deixam_de_falhar: 0 },
    ]);
  });

  it('alargar a regra e subir a taxa: passam a ser aprovados e os outros pagam mais', () => {
    const r = simular(
      { max: 6, preco: 100 },
      { max: 10, preco: 150 },
      pedidos,
      avaliar,
    );
    expect(r.passam_a_ser_aprovados).toBe(1);
    expect(r.mudam_de_taxa).toBe(2);
    expect(r.mudam).toBe(3);
    expect(r.receita.diferenca_cent).toBe(2 * 150 + 5 * 150 + 8 * 150 - 700);
    // Primeiro os exemplos que mudam de decisão.
    expect(r.exemplos[0].id).toBe('3');
    expect(r.exemplos[1].porque.join(' ')).toContain('Taxa cobrada');
  });

  it('limita os exemplos', () => {
    const muitos = Array.from({ length: 30 }, (_, i) => pedido(String(i), 5));
    const r = simular(
      { max: 6, preco: 1 },
      { max: 1, preco: 1 },
      muitos,
      avaliar,
      { exemplos: 3 },
    );
    expect(r.deixam_de_ser_aprovados).toBe(30);
    expect(r.exemplos).toHaveLength(3);
  });

  it('com as regras de verdade: ruído, menos horas ao sábado → festas antigas passam a técnico', () => {
    const def = DEFS.ruido;
    const hist = gerarHistoricoDemonstracao('ruido', '2026-10-21').map(
      (h, i) => ({
        id: String(i),
        ...h,
        demonstracao: true,
      }),
    );
    const r = simular(
      CONFIG_RUIDO_OMISSAO,
      { ...CONFIG_RUIDO_OMISSAO, hora_fim_max_fds: '00:00' },
      hist,
      (d, c, dia) => {
        const a = def.avaliar(d, c, dia, new Set());
        return {
          aprovado: a.proposta === 'aprovar',
          decisao: a.proposta,
          taxa_cent: a.taxa.total_cent,
          regras: a.regras,
        };
      },
    );
    expect(r.total).toBe(120);
    expect(r.deixam_de_ser_aprovados).toBeGreaterThan(0);
    expect(r.passam_a_ser_aprovados).toBe(0);
    expect(r.receita.diferenca_cent).toBe(
      -r.deixam_de_ser_aprovados * CONFIG_RUIDO_OMISSAO.taxa_cent,
    );
    expect(r.por_regra[0].id).toBe('hora_fim');
  });

  it('ocupação: passeio de 1 m em vez de 1,2 m → mais pedidos aprovados e mais receita', () => {
    const def = DEFS.ocupacao_via;
    const hist = gerarHistoricoDemonstracao('ocupacao_via', '2026-10-21').map(
      (h, i) => ({
        id: String(i),
        ...h,
        demonstracao: true,
      }),
    );
    const r = simular(
      CONFIG_OCUPACAO_OMISSAO,
      { ...CONFIG_OCUPACAO_OMISSAO, passeio_livre_min_m: 1 },
      hist,
      (d, c, dia) => {
        const a = def.avaliar(d, c, dia, new Set());
        return {
          aprovado: a.proposta === 'aprovar',
          decisao: a.proposta,
          taxa_cent: a.taxa.total_cent,
          regras: a.regras,
        };
      },
    );
    expect(r.passam_a_ser_aprovados).toBeGreaterThan(0);
    expect(r.deixam_de_ser_aprovados).toBe(0);
    expect(r.receita.diferenca_cent).toBeGreaterThan(0);
  });
});

describe('histórico de demonstração', () => {
  it.each(TIPOS)(
    '%s: sempre igual, válido para a entrada da ferramenta e avaliável',
    (tipo) => {
      const a = gerarHistoricoDemonstracao(tipo, '2026-10-21');
      const b = gerarHistoricoDemonstracao(tipo, '2026-10-21');
      expect(a).toEqual(b);
      expect(a).toHaveLength(120);
      expect(new Set(a.map((x) => x.referencia)).size).toBe(120);
      expect(
        a.every(
          (x) => x.pedido_em < '2026-10-21' && x.pedido_em >= '2023-10-21',
        ),
      ).toBe(true);
      const def = DEFS[tipo];
      let aprovados = 0;
      for (const h of a) {
        if (tipo !== 'ruido') {
          expect(ENTRADAS[tipo].safeParse(h.dados).success).toBe(true);
        }
        const av = def.avaliar(h.dados, def.omissao, h.pedido_em, new Set());
        if (av.proposta === 'aprovar') aprovados++;
        expect(
          def.resumo(h.dados, def.omissao, null).assunto.length,
        ).toBeGreaterThan(3);
      }
      // Uma mistura: a maioria dentro das regras, mas não todos.
      expect(aprovados).toBeGreaterThan(30);
      expect(aprovados).toBeLessThan(120);
    },
  );
});
