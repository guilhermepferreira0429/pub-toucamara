import { somarDias } from '../licencas/comum.js';
import { DEFS, TIPOS } from '../licencas/tipos.js';
import type { Taxa } from '../pagamentos/taxas.js';
import {
  calendario,
  type ContextoTaxas,
  definicaoPerguntas,
  diasUteisAntes,
  esquemaRequisito,
  estimarTaxa,
  flagsDe,
  juntarCatalogo,
  juntarPerfis,
  listaPara,
  perguntasEmFalta,
  principais,
  type Perfil,
  type Requisito,
} from './balcao-empresas.regras.js';
import { CATALOGO_OMISSAO } from './catalogo.js';

const CP = 'tp-cp';
const TABELA: Taxa[] = [
  {
    codigo: 'CP1',
    descricao: 'Apreciação do pedido',
    unidade: 'fixo',
    valor_cent: 4500,
    tipo_processo_id: CP,
  },
  {
    codigo: 'CP2',
    descricao: 'Obra, por m²',
    unidade: 'm2',
    valor_cent: 120,
    tipo_processo_id: CP,
  },
];

/** As regras por omissão de todos os tipos e a tabela de teste. */
const CTX: ContextoTaxas = {
  configs: Object.fromEntries(TIPOS.map((t) => [t, DEFS[t].ler(undefined)])),
  tabela: { taxas: TABELA, ano: 2026, fonte: 'Tabela de taxas 2026' },
  tiposProcesso: { CP },
};

const req = (chave: string): Requisito =>
  CATALOGO_OMISSAO.find((r) => r.chave === chave)!;
const chaves = (l: { itens: { chave: string }[] }) =>
  l.itens.map((i) => i.chave);

describe('catálogo por omissão', () => {
  it('é válido, sem chaves repetidas e todo de demonstração', () => {
    for (const r of CATALOGO_OMISSAO) {
      expect(esquemaRequisito.safeParse(r).success).toBe(true);
    }
    const c = CATALOGO_OMISSAO.map((r) => r.chave);
    expect(new Set(c).size).toBe(c.length);
    expect(CATALOGO_OMISSAO.every((r) => r.demonstracao)).toBe(true);
  });
});

describe('perguntasEmFalta', () => {
  it('sem atividade só pergunta a atividade', () => {
    const p = perguntasEmFalta({});
    expect(p.map((x) => x.campo)).toEqual(['atividade']);
  });

  it('restaurante: esplanada, música, horário; não pergunta se vende alimentos', () => {
    const campos = perguntasEmFalta({ atividade: 'restauracao' }).map(
      (x) => x.campo,
    );
    expect(campos).toEqual([
      'fase',
      'esplanada',
      'publicidade',
      'obras',
      'musica',
      'eventos_rua',
      'horario_alargado',
    ]);
  });

  it('centro histórico só quando há esplanada, publicidade ou obras; a rua quando há obras', () => {
    const base = {
      atividade: 'cabeleireiro_estetica',
      fase: 'aberta',
    } as const;
    expect(
      perguntasEmFalta({ ...base, publicidade: false, obras: false }),
    ).toEqual([]);
    const campos = perguntasEmFalta({
      ...base,
      publicidade: false,
      obras: true,
    }).map((x) => x.campo);
    expect(campos).toEqual(['ocupacao_via', 'centro_historico']);
  });

  it('a abrir: pergunta quando (para as datas)', () => {
    const campos = perguntasEmFalta({
      atividade: 'servicos',
      fase: 'abrir',
      atendimento_publico: true,
      publicidade: false,
      obras: false,
    }).map((x) => x.campo);
    expect(campos).toEqual(['abertura']);
  });
});

describe('definicaoPerguntas (o formulário)', () => {
  /** O que o formulário mostra, com a mesma lógica da página. */
  function mostradas(p: Perfil): string[] {
    return definicaoPerguntas()
      .filter((q) => p[q.campo] === undefined)
      .filter((q) =>
        q.so_se.length
          ? q.so_se.some((f) => p[f] === true)
          : q.atividades === null ||
            q.atividades.includes(p.atividade!) ||
            q.tambem_se.some((f) => p[f] === true),
      )
      .map((q) => q.campo);
  }

  it('mostra as mesmas perguntas que o agente faria', () => {
    const perfis: Perfil[] = [
      { atividade: 'restauracao', fase: 'aberta' },
      { atividade: 'cabeleireiro_estetica', fase: 'aberta', obras: true },
      { atividade: 'servicos', fase: 'aberta', publicidade: true },
      { atividade: 'eventos', fase: 'aberta' },
    ];
    for (const p of perfis) {
      expect(mostradas(p)).toEqual(perguntasEmFalta(p).map((x) => x.campo));
    }
  });
});

describe('juntarPerfis e flagsDe', () => {
  it('o que vem definido por cima; o resto fica', () => {
    expect(
      juntarPerfis(
        { atividade: 'comercio', esplanada: true },
        { esplanada: undefined, publicidade: true },
      ),
    ).toEqual({ atividade: 'comercio', esplanada: true, publicidade: true });
  });

  it('restaurante vende alimentos; só o escritório pode não receber clientes', () => {
    expect(flagsDe({ atividade: 'restauracao' }).vende_alimentos).toBe(true);
    expect(flagsDe({ atividade: 'comercio' }).atendimento_publico).toBe(true);
    expect(flagsDe({ atividade: 'servicos' }).atendimento_publico).toBe(false);
    expect(
      flagsDe({ atividade: 'servicos', atendimento_publico: true })
        .atendimento_publico,
    ).toBe(true);
  });
});

describe('listaPara', () => {
  it('café com esplanada e música: o da câmara pelo agente e o de fora com o link', () => {
    const l = listaPara(
      {
        atividade: 'restauracao',
        fase: 'abrir',
        esplanada: true,
        musica: true,
        publicidade: false,
        obras: false,
      },
      CATALOGO_OMISSAO,
      CTX,
    );
    expect(chaves(l)).toEqual([
      'registo_atividade',
      'inicio_atividade_financas',
      'esplanada',
      'ruido',
      'livro_reclamacoes',
      'seguranca_alimentar',
      'seguranca_incendio',
    ]);
    const esplanada = l.itens.find((i) => i.chave === 'esplanada')!;
    expect(esplanada.como).toEqual({
      tipo: 'agente',
      ferramenta: 'pedir_licenca_esplanada',
      frase: 'Quero pedir a licença de esplanada',
    });
    expect(esplanada.porque).toEqual(['Vai ter esplanada.']);
    // A antecedência vem das regras do tipo de licença (dias úteis).
    expect(esplanada.antecedencia).toEqual({ dias: 5, uteis: true });
    expect(esplanada.taxa?.texto).toContain('por m² e por mês');
    const registo = l.itens.find((i) => i.chave === 'registo_atividade')!;
    expect(registo.como).toEqual({
      tipo: 'link',
      url: 'https://eportugal.gov.pt',
    });
    expect(registo.porque[0]).toBe(
      'A atividade é um restaurante, café ou bar.',
    );
    expect(l.demonstracao).toBe(true);
    expect(l.na_camara + l.fora_da_camara).toBe(l.itens.length);
  });

  it('já aberta: o que é de uma vez fica "confirmar"', () => {
    const l = listaPara(
      { atividade: 'comercio', fase: 'aberta', publicidade: true },
      CATALOGO_OMISSAO,
    );
    const estado = Object.fromEntries(l.itens.map((i) => [i.chave, i.estado]));
    expect(estado.registo_atividade).toBe('confirmar');
    expect(estado.publicidade).toBe('por_tratar');
  });

  it('escritório sem clientes não precisa do livro de reclamações', () => {
    const sem = listaPara({ atividade: 'servicos' }, CATALOGO_OMISSAO);
    expect(chaves(sem)).toEqual(['inicio_atividade_financas']);
    const com = listaPara(
      { atividade: 'servicos', atendimento_publico: true },
      CATALOGO_OMISSAO,
    );
    expect(chaves(com)).toContain('livro_reclamacoes');
  });

  it('sem atividade não há lista; requisito desligado não aparece', () => {
    expect(listaPara({}, CATALOGO_OMISSAO).itens).toEqual([]);
    const desligado = CATALOGO_OMISSAO.map((r) =>
      r.chave === 'inicio_atividade_financas' ? { ...r, ativo: false } : r,
    );
    expect(chaves(listaPara({ atividade: 'servicos' }, desligado))).toEqual([]);
  });

  it('principais: por tratar primeiro, os pedidos do agente à frente', () => {
    const l = listaPara(
      {
        atividade: 'restauracao',
        fase: 'aberta',
        esplanada: true,
        musica: true,
      },
      CATALOGO_OMISSAO,
    );
    const p = principais(l.itens, 4).map((i) => i.chave);
    expect(p.slice(0, 2)).toEqual(['esplanada', 'ruido']);
    expect(p).not.toContain('registo_atividade');
  });
});

describe('estimarTaxa', () => {
  it('esplanada com a área: 12 meses pelas regras da câmara', () => {
    const t = estimarTaxa(req('esplanada'), { area_esplanada_m2: 20 }, CTX)!;
    // 20 m² × 12 meses × 3,00 €.
    expect(t.total_cent).toBe(72_000);
    expect(t.texto).toBe('Cerca de 720,00 € por ano (20 m² × 12 meses).');
    expect(t.demonstracao).toBe(true);
  });

  it('publicidade pequena no próprio estabelecimento: sem taxa', () => {
    const t = estimarTaxa(
      req('publicidade'),
      { area_publicidade_m2: 0.5 },
      CTX,
    )!;
    expect(t.total_cent).toBe(0);
    expect(t.texto).toContain('Sem taxa');
    const grande = estimarTaxa(
      req('publicidade'),
      { area_publicidade_m2: 2, publicidade_iluminada: true },
      CTX,
    )!;
    // 2 m² × 12 × 2,50 €.
    expect(grande.total_cent).toBe(6000);
  });

  it('ruído: a taxa fixa por licença; via pública: o preço unitário', () => {
    expect(estimarTaxa(req('ruido'), {}, CTX)).toMatchObject({
      total_cent: 2500,
    });
    expect(estimarTaxa(req('ocupacao_via'), {}, CTX)).toMatchObject({
      total_cent: null,
      texto: '10,00 € de apreciação e 0,50 € por m² e por dia.',
    });
  });

  it('obras: pela tabela de taxas (simulador), com ou sem a área', () => {
    const sem = estimarTaxa(req('obras'), {}, CTX)!;
    expect(sem.total_cent).toBeNull();
    expect(sem.texto).toBe(
      '45,00 € (apreciação do pedido) + 1,20 € por m² (obra, por m²).',
    );
    expect(sem.demonstracao).toBe(false);
    const com = estimarTaxa(req('obras'), { area_obra_m2: 50 }, CTX)!;
    expect(com.total_cent).toBe(10_500);
    expect(estimarTaxa(req('obras'), {}, { ...CTX, tabela: null })).toBeNull();
  });

  it('sem taxa: o que se trata fora da câmara', () => {
    expect(estimarTaxa(req('inicio_atividade_financas'), {}, CTX)).toBeNull();
  });
});

describe('juntarCatalogo', () => {
  it('a alteração substitui a do código; a chave nova acrescenta', () => {
    const alterada = { ...req('esplanada'), titulo: 'Esplanada (Guimarães)' };
    const nova: Requisito = {
      ...req('horario_alargado'),
      chave: 'mercado_municipal',
      titulo: 'Lugar no mercado municipal',
      ordem: 5,
    };
    const c = juntarCatalogo(CATALOGO_OMISSAO, [alterada, nova]);
    expect(c).toHaveLength(CATALOGO_OMISSAO.length + 1);
    expect(c[0]).toMatchObject({ chave: 'mercado_municipal', novo: true });
    expect(c.find((r) => r.chave === 'esplanada')).toMatchObject({
      titulo: 'Esplanada (Guimarães)',
      alterado: true,
      novo: false,
    });
    expect(c.find((r) => r.chave === 'publicidade')?.alterado).toBe(false);
  });
});

describe('calendário de obrigações', () => {
  const HOJE = '2026-10-22'; // quinta-feira

  it('dias úteis antes: salta o fim de semana e os feriados', () => {
    expect(diasUteisAntes('2026-10-26', 1, new Set())).toBe('2026-10-23');
    expect(diasUteisAntes('2026-10-26', 1, new Set(['2026-10-23']))).toBe(
      '2026-10-22',
    );
  });

  it('licenças que já tem: renovar no dia do aviso e o último dia (validade real)', () => {
    const c = calendario({
      hoje: HOJE,
      lista: [],
      licencas: [
        {
          numero: 'ESP 3/2026',
          tipo: 'esplanada',
          estado: 'emitida',
          valida_ate: somarDias(HOJE, 40),
          taxa_cent: 7200,
          aviso_dias: 30,
        },
        {
          numero: 'PUB 1/2025',
          tipo: 'publicidade',
          estado: 'emitida',
          valida_ate: '2025-01-31',
          taxa_cent: 1000,
          aviso_dias: 30,
        },
        {
          numero: 'LER 9/2026',
          tipo: 'ruido',
          estado: 'emitida',
          valida_ate: somarDias(HOJE, 5),
          taxa_cent: 2500,
          aviso_dias: null,
        },
        {
          numero: 'OVP 2/2026',
          tipo: 'ocupacao_via',
          estado: 'a_pagar',
          valida_ate: null,
          taxa_cent: 1500,
          aviso_dias: 5,
        },
      ],
    });
    expect(c.eventos.map((e) => [e.tipo, e.data, e.licenca])).toEqual([
      ['evento', somarDias(HOJE, 5), 'LER 9/2026'],
      ['renovar', somarDias(HOJE, 10), 'ESP 3/2026'],
      ['expira', somarDias(HOJE, 40), 'ESP 3/2026'],
    ]);
    const renovar = c.eventos.find((e) => e.tipo === 'renovar')!;
    expect(renovar.descricao).toContain('72,00 €');
    expect(renovar.demonstracao).toBe(false);
    // A publicidade expirou há muito: não aparece. A via pública está por pagar.
    expect(c.lembretes).toEqual([
      expect.objectContaining({
        periodicidade: 'pagar',
        titulo: 'Pagar a taxa da licença de ocupação da via pública OVP 2/2026',
      }),
    ]);
  });

  it('a abrir com data: o que tratar antes (com a antecedência) e a primeira renovação', () => {
    const perfil = {
      atividade: 'restauracao',
      fase: 'abrir',
      abertura: '2026-12-01',
      esplanada: true,
      musica: true,
    } as const;
    const l = listaPara(perfil, CATALOGO_OMISSAO, CTX);
    const c = calendario({
      hoje: HOJE,
      lista: l.itens,
      licencas: [],
      abertura: perfil.abertura,
    });
    const porId = Object.fromEntries(c.eventos.map((e) => [e.id, e]));
    expect(porId['abertura:2026-12-01'].data).toBe('2026-12-01');
    // Esplanada: 5 dias úteis antes de 1 de dezembro (terça) → 24 de novembro.
    expect(porId['tratar:esplanada:2026-12-01'].data).toBe('2026-11-24');
    expect(porId['tratar:registo_atividade:2026-12-01'].data).toBe(
      '2026-12-01',
    );
    // A primeira renovação anual: 30 dias antes do fim dos 12 meses.
    expect(porId['renovar:esplanada:2027-11-30'].data).toBe('2027-10-31');
    expect(porId['renovar:esplanada:2027-11-30'].demonstracao).toBe(true);
    // O ruído é por evento e o HACCP é sempre: lembretes, sem data.
    expect(c.lembretes.map((x) => x.titulo)).toEqual(
      expect.arrayContaining([
        'Cada vez: Licença especial de ruído',
        'Sempre: Segurança alimentar (HACCP)',
      ]),
    );
    expect(c.eventos.map((e) => e.data)).toEqual(
      [...c.eventos.map((e) => e.data)].sort(),
    );
  });

  it('já tem a licença daquele tipo: não repete o pedido do perfil', () => {
    const l = listaPara(
      { atividade: 'restauracao', fase: 'aberta', esplanada: true },
      CATALOGO_OMISSAO,
      CTX,
    );
    const sem = calendario({ hoje: HOJE, lista: l.itens, licencas: [] });
    expect(sem.lembretes.map((x) => x.titulo)).toContain(
      'Todos os anos: Licença de esplanada',
    );
    const com = calendario({
      hoje: HOJE,
      lista: l.itens,
      licencas: [
        {
          numero: 'ESP 3/2026',
          tipo: 'esplanada',
          estado: 'emitida',
          valida_ate: somarDias(HOJE, 100),
          taxa_cent: 0,
          aviso_dias: 30,
        },
      ],
    });
    expect(com.lembretes.map((x) => x.titulo)).not.toContain(
      'Todos os anos: Licença de esplanada',
    );
    expect(com.eventos.map((e) => e.tipo)).toEqual(['renovar', 'expira']);
  });
});
