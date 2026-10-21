import {
  CONFIG_DEMONSTRACAO,
  ConfigContratacao,
  configDe,
  esquemaConfigContratacao,
  TipoContrato,
} from './config';
import {
  avaliarProcedimento,
  ContratoAnterior,
  PedidoAvaliacao,
  pecasDe,
  prefixoCpv,
  procedimentoPorValor,
  semelhanca,
} from './motor';

const NIF = '501234560'; // válido (dígito de controlo)
const OUTRO_NIF = '503456780';
const HOJE = '2026-10-21';

function pedido(o: Partial<PedidoAvaliacao> = {}): PedidoAvaliacao {
  return {
    tipo: 'servicos',
    valor_estimado_cent: 1_000_000,
    entidade_adjudicataria: NIF,
    objeto: 'Manutenção dos jardins municipais',
    cpv: null,
    prazo_meses: 12,
    contratos_anteriores: [],
    hoje: HOJE,
    ...o,
  };
}

function contrato(o: Partial<ContratoAnterior> = {}): ContratoAnterior {
  return {
    adjudicatario_nif: NIF,
    objeto: 'Limpeza de edifícios escolares',
    tipo: 'servicos',
    preco_contratual_cent: 1_000_000,
    data_contrato: '2026-03-01',
    procedimento: 'ajuste_direto',
    cpv: null,
    ...o,
  };
}

function cfg(f: (c: ConfigContratacao) => void = () => undefined) {
  const c = structuredClone(CONFIG_DEMONSTRACAO);
  f(c);
  return c;
}

const admissiveis = (p: PedidoAvaliacao, c = CONFIG_DEMONSTRACAO) =>
  avaliarProcedimento(p, c)
    .procedimentos.filter((x) => x.admissivel)
    .map((x) => x.procedimento);

describe('configuração de demonstração', () => {
  it('é válida, marcada como demonstração e com a fonte pedida', () => {
    expect(
      esquemaConfigContratacao.safeParse(CONFIG_DEMONSTRACAO).success,
    ).toBe(true);
    expect(CONFIG_DEMONSTRACAO.demonstracao).toBe(true);
    expect(CONFIG_DEMONSTRACAO.fonte).toContain('DL 18/2008');
    expect(CONFIG_DEMONSTRACAO.fonte).toContain('a confirmar pelo jurista');
    expect(CONFIG_DEMONSTRACAO.fonte).toContain('PRD');
    for (const t of ['bens', 'servicos', 'empreitada'] as const) {
      expect(CONFIG_DEMONSTRACAO.tipos[t].demonstracao).toBe(true);
    }
  });

  it('serviços: ajuste direto até 75 000 € (citado do PRD)', () => {
    expect(CONFIG_DEMONSTRACAO.tipos.servicos.ajuste_direto_cent).toBe(
      7_500_000,
    );
    expect(CONFIG_DEMONSTRACAO.tipos.servicos.fonte).toContain('PRD');
    expect(CONFIG_DEMONSTRACAO.acumulado.a_confirmar).toBe(true);
    expect(CONFIG_DEMONSTRACAO.acumulado.fonte).toContain('113.º');
  });

  it('configDe: sem config ou inválida → demonstração', () => {
    expect(configDe(null)).toBe(CONFIG_DEMONSTRACAO);
    expect(configDe({ demonstracao: false })).toBe(CONFIG_DEMONSTRACAO);
    const c = cfg((x) => (x.demonstracao = false));
    expect(configDe(c)).toEqual(c);
  });

  it('recusa limiares fora de ordem', () => {
    const c = cfg((x) => (x.tipos.bens.ajuste_direto_cent = 10_000_000));
    expect(esquemaConfigContratacao.safeParse(c).success).toBe(false);
    const e = cfg((x) => (x.tipos.bens.europeu_cent = 100));
    expect(esquemaConfigContratacao.safeParse(e).success).toBe(false);
  });
});

describe('fronteiras dos limiares', () => {
  const casos: [TipoContrato, number, number, number][] = [
    // tipo, simplificado (até), ajuste direto (abaixo), consulta prévia (abaixo)
    ['servicos', 500_000, 7_500_000, 15_000_000],
    ['bens', 500_000, 2_000_000, 7_500_000],
    ['empreitada', 1_000_000, 3_000_000, 15_000_000],
  ];

  describe.each(casos)('%s', (tipo, simpl, ad, cp) => {
    const p = (valor: number) =>
      pedido({
        tipo,
        valor_estimado_cent: valor,
        entidade_adjudicataria: null,
      });

    it('no limite do simplificado ainda cabe no simplificado (inclusive)', () => {
      expect(admissiveis(p(simpl))).toEqual([
        'ajuste_direto_simplificado',
        'ajuste_direto',
        'consulta_previa',
        'concurso_publico',
      ]);
      expect(
        avaliarProcedimento(p(simpl), CONFIG_DEMONSTRACAO).recomendado,
      ).toBe('ajuste_direto_simplificado');
    });

    it('um cêntimo acima do simplificado já é ajuste direto', () => {
      expect(admissiveis(p(simpl + 1))).toEqual([
        'ajuste_direto',
        'consulta_previa',
        'concurso_publico',
      ]);
    });

    it('um cêntimo abaixo do limite do ajuste direto cabe', () => {
      const r = avaliarProcedimento(p(ad - 1), CONFIG_DEMONSTRACAO);
      expect(r.recomendado).toBe('ajuste_direto');
      expect(r.cabe_ajuste_direto).toBe(true);
    });

    it('no limite do ajuste direto já não cabe (exclusive)', () => {
      const r = avaliarProcedimento(p(ad), CONFIG_DEMONSTRACAO);
      expect(r.cabe_ajuste_direto).toBe(false);
      expect(r.recomendado).toBe('consulta_previa');
      expect(r.resumo).toMatch(/^Não cabe no ajuste direto/);
    });

    it('um cêntimo abaixo da consulta prévia cabe; no limite é concurso', () => {
      expect(
        avaliarProcedimento(p(cp - 1), CONFIG_DEMONSTRACAO).recomendado,
      ).toBe('consulta_previa');
      expect(admissiveis(p(cp))).toEqual(['concurso_publico']);
    });

    it('procedimentoPorValor segue as mesmas fronteiras', () => {
      const l = CONFIG_DEMONSTRACAO.tipos[tipo];
      expect(procedimentoPorValor(l, 0)).toBe('ajuste_direto_simplificado');
      expect(procedimentoPorValor(l, simpl)).toBe('ajuste_direto_simplificado');
      expect(procedimentoPorValor(l, simpl + 1)).toBe('ajuste_direto');
      expect(procedimentoPorValor(l, ad)).toBe('consulta_previa');
      expect(procedimentoPorValor(l, cp)).toBe('concurso_publico');
    });
  });

  it('o concurso público é sempre admissível e diz porquê', () => {
    const r = avaliarProcedimento(
      pedido({ valor_estimado_cent: 1 }),
      CONFIG_DEMONSTRACAO,
    );
    const c = r.procedimentos.find(
      (x) => x.procedimento === 'concurso_publico',
    )!;
    expect(c.admissivel).toBe(true);
    expect(c.porque[0]).toMatch(/qualquer valor/);
    expect(c.limite_cent).toBeNull();
  });

  it('o porquê traz os valores em euros', () => {
    const r = avaliarProcedimento(
      pedido({ valor_estimado_cent: 7_500_000, entidade_adjudicataria: null }),
      CONFIG_DEMONSTRACAO,
    );
    const ad = r.procedimentos.find((x) => x.procedimento === 'ajuste_direto')!;
    expect(ad.porque[0]).toBe(
      '75 000,00 € chega ou passa de 75 000,00 € (limite do ajuste direto).',
    );
  });

  it('acima do limiar europeu avisa da publicação no JOUE (30 dias de demonstração)', () => {
    const r = avaliarProcedimento(
      pedido({ valor_estimado_cent: 22_100_000 }),
      CONFIG_DEMONSTRACAO,
    );
    const c = r.procedimentos.find(
      (x) => x.procedimento === 'concurso_publico',
    )!;
    expect(c.alertas.join(' ')).toMatch(/Jornal Oficial da União Europeia/);
    expect(c.pecas.map((x) => x.codigo)).toContain('anuncio_joue');
    expect(c.pecas.find((x) => x.codigo === 'convite')!.prazo_dias).toBe(30);
    const abaixo = avaliarProcedimento(
      pedido({ valor_estimado_cent: 22_099_999 }),
      CONFIG_DEMONSTRACAO,
    ).procedimentos.find((x) => x.procedimento === 'concurso_publico')!;
    expect(abaixo.pecas.map((x) => x.codigo)).not.toContain('anuncio_joue');
  });

  it('marca o resultado como demonstração, com a fonte', () => {
    const r = avaliarProcedimento(pedido(), CONFIG_DEMONSTRACAO);
    expect(r.demonstracao).toBe(true);
    expect(r.fonte).toContain('a confirmar pelo jurista');
    const real = cfg((c) => {
      c.demonstracao = false;
      c.tipos.servicos.demonstracao = false;
    });
    expect(avaliarProcedimento(pedido(), real).demonstracao).toBe(false);
  });
});

describe('prazo do contrato', () => {
  it('o simplificado só serve até 12 meses', () => {
    const p = pedido({ valor_estimado_cent: 100_000, prazo_meses: 12 });
    expect(avaliarProcedimento(p, CONFIG_DEMONSTRACAO).recomendado).toBe(
      'ajuste_direto_simplificado',
    );
    const r = avaliarProcedimento(
      { ...p, prazo_meses: 13 },
      CONFIG_DEMONSTRACAO,
    );
    expect(r.recomendado).toBe('ajuste_direto');
    const s = r.procedimentos.find(
      (x) => x.procedimento === 'ajuste_direto_simplificado',
    )!;
    expect(s.admissivel).toBe(false);
    expect(s.porque.join(' ')).toMatch(/13 meses/);
  });

  it('mais de 36 meses: alerta de fundamentação, sem tirar a admissibilidade', () => {
    const r = avaliarProcedimento(
      pedido({ prazo_meses: 48 }),
      CONFIG_DEMONSTRACAO,
    );
    const ad = r.procedimentos.find((x) => x.procedimento === 'ajuste_direto')!;
    expect(ad.admissivel).toBe(true);
    expect(ad.alertas.join(' ')).toMatch(/fundamentado/);
    const ok = avaliarProcedimento(
      pedido({ prazo_meses: 36 }),
      CONFIG_DEMONSTRACAO,
    );
    expect(
      ok.procedimentos.find((x) => x.procedimento === 'ajuste_direto')!.alertas,
    ).toEqual([]);
  });
});

describe('limite acumulado com a mesma entidade', () => {
  it('sem NIF não se verifica e fica um alerta', () => {
    const r = avaliarProcedimento(
      pedido({
        entidade_adjudicataria: null,
        contratos_anteriores: [contrato()],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.acumulado.verificado).toBe(false);
    expect(r.alertas.join(' ')).toMatch(/NIF/);
    expect(r.cabe_ajuste_direto).toBe(true);
  });

  it('soma os contratos deste ano e dos dois anteriores, com o atual', () => {
    const r = avaliarProcedimento(
      pedido({
        valor_estimado_cent: 1_000_000,
        contratos_anteriores: [
          contrato({
            preco_contratual_cent: 3_000_000,
            data_contrato: '2024-01-02',
          }),
          contrato({
            preco_contratual_cent: 2_000_000,
            data_contrato: '2025-06-30',
          }),
          contrato({
            preco_contratual_cent: 9_000_000,
            data_contrato: '2023-12-31',
          }), // fora
        ],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.acumulado.anos).toEqual([2024, 2025, 2026]);
    expect(r.acumulado.contratos).toHaveLength(2);
    expect(r.acumulado.anteriores_cent).toBe(5_000_000);
    expect(r.acumulado.total_cent).toBe(6_000_000);
    expect(r.cabe_ajuste_direto).toBe(true);
  });

  it('chegar ao limite (75 000 €) com este contrato impede o ajuste direto com essa entidade', () => {
    const r = avaliarProcedimento(
      pedido({
        valor_estimado_cent: 1_000_000,
        contratos_anteriores: [contrato({ preco_contratual_cent: 6_500_000 })],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.acumulado.total_cent).toBe(7_500_000);
    const ad = r.procedimentos.find((x) => x.procedimento === 'ajuste_direto')!;
    expect(ad.admissivel).toBe(false);
    expect(ad.porque.join(' ')).toMatch(/limite acumulado de 75 000,00 €/);
    expect(r.cabe_ajuste_direto).toBe(false);
    expect(r.recomendado).toBe('consulta_previa');
    expect(r.alertas.join(' ')).toMatch(/já chegou ao limite acumulado/);
  });

  it('um cêntimo abaixo do limite ainda cabe', () => {
    const r = avaliarProcedimento(
      pedido({
        valor_estimado_cent: 1_000_000,
        contratos_anteriores: [contrato({ preco_contratual_cent: 6_499_999 })],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.cabe_ajuste_direto).toBe(true);
    expect(
      r.procedimentos
        .find((x) => x.procedimento === 'ajuste_direto')!
        .porque.join(' '),
    ).toMatch(/abaixo do limite acumulado/);
  });

  it('sem somar o atual (configurável): só os anteriores contam', () => {
    const c = cfg((x) => (x.acumulado.incluir_contrato_atual = false));
    const p = pedido({
      valor_estimado_cent: 1_000_000,
      contratos_anteriores: [contrato({ preco_contratual_cent: 6_500_000 })],
    });
    expect(avaliarProcedimento(p, c).cabe_ajuste_direto).toBe(true);
    const cheio = {
      ...p,
      contratos_anteriores: [contrato({ preco_contratual_cent: 7_500_000 })],
    };
    expect(avaliarProcedimento(cheio, c).cabe_ajuste_direto).toBe(false);
  });

  it('o número de anos é configurável', () => {
    const c = cfg((x) => (x.acumulado.anos = 1));
    const r = avaliarProcedimento(
      pedido({
        contratos_anteriores: [
          contrato({
            preco_contratual_cent: 7_000_000,
            data_contrato: '2025-12-31',
          }),
        ],
      }),
      c,
    );
    expect(r.acumulado.anos).toEqual([2026]);
    expect(r.acumulado.contratos).toHaveLength(0);
    expect(r.cabe_ajuste_direto).toBe(true);
  });

  it('um limite fixo substitui o limiar do procedimento', () => {
    const c = cfg((x) => (x.acumulado.limite_cent = 2_000_000));
    const r = avaliarProcedimento(
      pedido({
        contratos_anteriores: [contrato({ preco_contratual_cent: 1_000_000 })],
      }),
      c,
    );
    expect(r.acumulado.limites.every((x) => x.limite_cent === 2_000_000)).toBe(
      true,
    );
    expect(r.cabe_ajuste_direto).toBe(false);
    // A consulta prévia também tem a regra: com limite fixo fica só o concurso.
    expect(r.recomendado).toBe('concurso_publico');
  });

  it('outras entidades, outros tipos, procedimentos que não contam e datas futuras ficam de fora', () => {
    const r = avaliarProcedimento(
      pedido({
        contratos_anteriores: [
          contrato({
            adjudicatario_nif: OUTRO_NIF,
            preco_contratual_cent: 9_000_000,
          }),
          contrato({ tipo: 'bens', preco_contratual_cent: 9_000_000 }),
          contrato({
            procedimento: 'concurso_publico',
            preco_contratual_cent: 9_000_000,
          }),
          contrato({
            procedimento: 'ajuste_direto_simplificado',
            preco_contratual_cent: 9_000_000,
          }),
          contrato({
            data_contrato: '2026-12-01',
            preco_contratual_cent: 9_000_000,
          }),
        ],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.acumulado.contratos).toHaveLength(0);
    expect(r.cabe_ajuste_direto).toBe(true);
  });

  it('com CPV dos dois lados conta só o mesmo grupo (3 dígitos)', () => {
    const p = pedido({
      cpv: '77310000-6',
      contratos_anteriores: [
        contrato({ cpv: '90910000-9', preco_contratual_cent: 7_000_000 }),
        contrato({ cpv: '77311000-3', preco_contratual_cent: 1_000_000 }),
        contrato({ cpv: null, preco_contratual_cent: 500_000 }),
      ],
    });
    const r = avaliarProcedimento(p, CONFIG_DEMONSTRACAO);
    expect(r.acumulado.anteriores_cent).toBe(1_500_000);
    expect(r.cabe_ajuste_direto).toBe(true);
  });

  it('a consulta prévia também tem limite acumulado (150 000 € em serviços)', () => {
    const r = avaliarProcedimento(
      pedido({
        valor_estimado_cent: 8_000_000,
        contratos_anteriores: [
          contrato({
            procedimento: 'consulta_previa',
            preco_contratual_cent: 7_000_000,
          }),
        ],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.recomendado).toBe('concurso_publico');
    expect(
      r.procedimentos
        .find((x) => x.procedimento === 'consulta_previa')!
        .porque.join(' '),
    ).toMatch(/150 000,00 €/);
  });

  it('o simplificado não tem a regra por defeito (aplica_a configurável)', () => {
    const p = pedido({
      valor_estimado_cent: 400_000,
      contratos_anteriores: [contrato({ preco_contratual_cent: 7_400_000 })],
    });
    expect(avaliarProcedimento(p, CONFIG_DEMONSTRACAO).recomendado).toBe(
      'ajuste_direto_simplificado',
    );
    const c = cfg(
      (x) =>
        (x.acumulado.aplica_a = [
          'ajuste_direto_simplificado',
          'ajuste_direto',
        ]),
    );
    const r = avaliarProcedimento(p, c);
    expect(r.cabe_ajuste_direto).toBe(false);
    expect(r.recomendado).toBe('consulta_previa');
  });
});

describe('fracionamento (objetos semelhantes no mesmo ano)', () => {
  const jardins = (o: Partial<ContratoAnterior> = {}) =>
    contrato({
      adjudicatario_nif: OUTRO_NIF,
      objeto: 'Manutenção de jardins municipais da zona norte',
      ...o,
    });

  it('semelhanca: palavras com significado, sem acentos', () => {
    expect(semelhanca('Manutenção dos jardins', 'manutencao de jardins')).toBe(
      1,
    );
    expect(semelhanca('Limpeza de escolas', 'Aquisição de computadores')).toBe(
      0,
    );
    expect(semelhanca('', 'x')).toBe(0);
  });

  it('prefixoCpv', () => {
    expect(prefixoCpv('77310000-6', 3)).toBe('773');
    expect(prefixoCpv(null, 3)).toBeNull();
    expect(prefixoCpv('12', 3)).toBeNull();
  });

  it('a soma passa o limite do ajuste direto: alerta', () => {
    const r = avaliarProcedimento(
      pedido({
        valor_estimado_cent: 4_000_000,
        contratos_anteriores: [jardins({ preco_contratual_cent: 4_000_000 })],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.fracionamento.alerta).toBe(true);
    expect(r.fracionamento.semelhantes).toHaveLength(1);
    expect(r.fracionamento.semelhantes[0].por).toBe('objeto');
    expect(r.fracionamento.total_cent).toBe(8_000_000);
    expect(r.fracionamento.procedimento_pelo_total).toBe('consulta_previa');
    expect(r.alertas.join(' ')).toMatch(/fracionamento/);
    const ad = r.procedimentos.find((x) => x.procedimento === 'ajuste_direto')!;
    expect(ad.admissivel).toBe(true); // é um alerta, a decisão é humana
    expect(ad.alertas.join(' ')).toMatch(/Possível fracionamento/);
    // A consulta prévia já cobre o total: sem alerta.
    expect(
      r.procedimentos.find((x) => x.procedimento === 'consulta_previa')!
        .alertas,
    ).toEqual([]);
  });

  it('semelhantes mas a soma continua no mesmo procedimento: só informação', () => {
    const r = avaliarProcedimento(
      pedido({
        valor_estimado_cent: 1_000_000,
        contratos_anteriores: [jardins({ preco_contratual_cent: 1_000_000 })],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.fracionamento.alerta).toBe(false);
    expect(r.fracionamento.porque).toMatch(/continua a caber/);
    expect(r.alertas).toEqual([]);
  });

  it('outro ano, outro tipo ou objeto diferente não contam', () => {
    const r = avaliarProcedimento(
      pedido({
        valor_estimado_cent: 4_000_000,
        contratos_anteriores: [
          jardins({
            data_contrato: '2025-11-01',
            preco_contratual_cent: 9_000_000,
          }),
          jardins({ tipo: 'bens', preco_contratual_cent: 9_000_000 }),
          contrato({
            adjudicatario_nif: OUTRO_NIF,
            objeto: 'Seguros da frota automóvel',
            preco_contratual_cent: 9_000_000,
          }),
        ],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.fracionamento.semelhantes).toHaveLength(0);
    expect(r.fracionamento.alerta).toBe(false);
  });

  it('o mesmo grupo CPV conta mesmo com palavras diferentes', () => {
    const r = avaliarProcedimento(
      pedido({
        cpv: '77310000-6',
        valor_estimado_cent: 4_000_000,
        contratos_anteriores: [
          contrato({
            adjudicatario_nif: OUTRO_NIF,
            objeto: 'Poda de árvores',
            cpv: '77341000-2',
            preco_contratual_cent: 4_000_000,
          }),
        ],
      }),
      CONFIG_DEMONSTRACAO,
    );
    expect(r.fracionamento.semelhantes[0].por).toBe('cpv');
    expect(r.fracionamento.alerta).toBe(true);
  });

  it('a semelhança mínima é configurável', () => {
    const p = pedido({
      valor_estimado_cent: 4_000_000,
      contratos_anteriores: [
        jardins({
          objeto: 'Manutenção de espaços verdes e jardins',
          preco_contratual_cent: 4_000_000,
        }),
      ],
    });
    const exigente = cfg((x) => (x.fracionamento.semelhanca_minima = 0.9));
    expect(
      avaliarProcedimento(p, exigente).fracionamento.semelhantes,
    ).toHaveLength(0);
    const brando = cfg((x) => (x.fracionamento.semelhanca_minima = 0.2));
    expect(avaliarProcedimento(p, brando).fracionamento.alerta).toBe(true);
  });
});

describe('peças e documentos', () => {
  const codigos = (
    proc: Parameters<typeof pecasDe>[0],
    tipo: TipoContrato = 'servicos',
    v = 0,
  ) => pecasDe(proc, tipo, v, CONFIG_DEMONSTRACAO).map((x) => x.codigo);

  it('todos pedem cabimento e publicação no BASE (prazo de demonstração)', () => {
    for (const p of [
      'ajuste_direto_simplificado',
      'ajuste_direto',
      'consulta_previa',
      'concurso_publico',
    ] as const) {
      const pecas = pecasDe(p, 'servicos', 0, CONFIG_DEMONSTRACAO);
      expect(pecas.map((x) => x.codigo)).toEqual(
        expect.arrayContaining([
          'informacao_cabimento',
          'publicacao_base',
          'caderno_encargos',
          'convite',
        ]),
      );
      const base = pecas.find((x) => x.codigo === 'publicacao_base')!;
      expect(base.prazo_dias).toBe(20);
      expect(base.prazo_demonstracao).toBe(true);
    }
  });

  it('ajuste direto: convite e caderno gerados aqui, obrigatórios', () => {
    const pecas = pecasDe('ajuste_direto', 'servicos', 0, CONFIG_DEMONSTRACAO);
    const convite = pecas.find((x) => x.codigo === 'convite')!;
    expect(convite).toMatchObject({
      nome: 'Convite',
      gerada_aqui: true,
      obrigatoria: true,
      prazo_dias: 5,
    });
    expect(codigos('ajuste_direto')).not.toContain('juri');
  });

  it('simplificado: convite e caderno opcionais, sobre a fatura', () => {
    const pecas = pecasDe(
      'ajuste_direto_simplificado',
      'bens',
      0,
      CONFIG_DEMONSTRACAO,
    );
    expect(pecas.find((x) => x.codigo === 'convite')!.obrigatoria).toBe(false);
    expect(
      pecas.find((x) => x.codigo === 'caderno_encargos')!.obrigatoria,
    ).toBe(false);
    expect(pecas.map((x) => x.codigo)).toContain('proposta_ou_fatura');
  });

  it('consulta prévia: júri, relatórios e audiência prévia', () => {
    expect(codigos('consulta_previa')).toEqual(
      expect.arrayContaining([
        'juri',
        'relatorio_preliminar',
        'audiencia_previa',
        'relatorio_final',
      ]),
    );
  });

  it('concurso: anúncio no DR e prazos por tipo', () => {
    expect(codigos('concurso_publico')).toContain('anuncio_dr');
    const prazo = (t: TipoContrato) =>
      pecasDe('concurso_publico', t, 0, CONFIG_DEMONSTRACAO).find(
        (x) => x.codigo === 'convite',
      )!;
    expect(prazo('servicos')).toMatchObject({
      nome: 'Programa do procedimento',
      prazo_dias: 9,
    });
    expect(prazo('empreitada').prazo_dias).toBe(14);
  });
});
