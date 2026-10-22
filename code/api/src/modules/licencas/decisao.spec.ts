import { decidir, podeEmitirSozinha, ROTULOS_REGRAS } from './decisao';
import { frasesRegras } from './explicar';
import { DEFS, ENTRADAS, TipoLicenca, TIPOS } from './tipos';

const SEM_FERIADOS = new Set<string>();
const HOJE = '2026-10-21'; // quarta-feira

/** Um pedido que cumpre todas as regras por omissão, por tipo. */
const CUMPRE: Record<TipoLicenca, Record<string, unknown>> = {
  ruido: {
    atividade: 'festa_privada',
    descricao: 'Festa de anos no quintal',
    morada: 'Rua de Santo António 10',
    data: '2026-10-31', // sábado
    hora_inicio: '20:00',
    hora_fim: '01:00',
    pessoas: 50,
    musica_amplificada: true,
  },
  ocupacao_via: {
    equipamento: 'andaime',
    descricao: 'Pintar a fachada',
    morada: 'Rua de Santo António 10',
    data_inicio: '2026-11-09',
    dias: 10,
    area_m2: 12,
    passeio_livre_m: 1.5,
    ocupa_estrada: false,
  },
  esplanada: {
    estabelecimento: 'Café Central',
    morada: 'Largo do Toural 1',
    data_inicio: '2026-11-09',
    meses: 6,
    area_m2: 20,
    mesas: 6,
    passeio_livre_m: 2,
    estrado: false,
    centro_historico: false,
  },
  distico_residente: {
    morada: 'Rua Nova 5, 2.º esq.',
    matricula: 'AA-12-BB',
    disticos_ja_tem: 0,
    morada_comprovada: true,
    viatura_em_nome: true,
  },
  publicidade: {
    suporte: 'placa',
    estabelecimento: 'Sapataria Silva',
    mensagem: 'Sapataria Silva',
    morada: 'Rua de Santa Maria 3',
    largura_m: 2,
    altura_m: 1,
    iluminado: false,
    no_proprio_estabelecimento: true,
    centro_historico: false,
    data_inicio: '2026-11-09',
    meses: 6,
  },
  recinto_improvisado: {
    descricao: 'Arraial de São João',
    morada: 'Largo da Oliveira',
    data_inicio: '2026-12-01',
    dias: 2,
    lotacao: 100,
    estruturas: ['palco'],
    musica: false,
  },
};

/** Para cada regra: uma mudança ao pedido que a faz falhar (com as regras por omissão). */
const VIOLA: Record<TipoLicenca, Record<string, Record<string, unknown>>> = {
  ruido: {
    data: { data: '2026-10-01' },
    antecedencia: { data: '2026-10-22', hora_fim: '23:00' },
    hora_inicio: { hora_inicio: '08:00', hora_fim: '12:00' },
    hora_fim: { hora_inicio: '22:00', hora_fim: '03:00' },
    duracao: { hora_inicio: '13:00', hora_fim: '01:00' },
    pessoas: { pessoas: 500 },
    atividade: { atividade: 'obra' },
  },
  ocupacao_via: {
    data: { data_inicio: '2026-10-01' },
    antecedencia: { data_inicio: '2026-10-23' },
    equipamento: { equipamento: 'plataforma' },
    area: { area_m2: 100 },
    dias: { dias: 60 },
    passeio: { passeio_livre_m: 0.5 },
    estrada: { ocupa_estrada: true },
  },
  esplanada: {
    data: { data_inicio: '2026-10-01' },
    antecedencia: { data_inicio: '2026-10-23' },
    area: { area_m2: 80 },
    mesas: { mesas: 40 },
    passeio: { passeio_livre_m: 0.5 },
    meses: { meses: 20 },
    estrado: { estrado: true },
    centro_historico: { centro_historico: true },
  },
  distico_residente: {
    matricula: { matricula: 'XYZ1234567' },
    morada: { morada_comprovada: false },
    viatura: { viatura_em_nome: false },
    por_fogo: { disticos_ja_tem: 5 },
  },
  publicidade: {
    data: { data_inicio: '2026-10-01' },
    antecedencia: { data_inicio: '2026-10-22' },
    suporte: { suporte: 'cavalete' },
    proprio: { no_proprio_estabelecimento: false },
    area: { largura_m: 4, altura_m: 3 },
    meses: { meses: 30 },
    centro_historico: { centro_historico: true },
  },
  recinto_improvisado: {
    data: { data_inicio: '2026-10-01' },
    antecedencia: { data_inicio: '2026-10-26' },
    lotacao: { lotacao: 1000 },
    dias: { dias: 10 },
    estruturas: { estruturas: ['bancadas'] },
  },
};

/** O pedido sem estes campos (dados em falta). */
function sem_(o: Record<string, unknown>, ...chaves: string[]) {
  return Object.fromEntries(
    Object.entries(o).filter(([k]) => !chaves.includes(k)),
  );
}

function correr(
  tipo: TipoLicenca,
  dados: Record<string, unknown>,
  config: Record<string, unknown> = DEFS[tipo].omissao as Record<
    string,
    unknown
  >,
) {
  const entrada =
    tipo === 'ruido'
      ? dados
      : (ENTRADAS[tipo].parse(dados) as Record<string, unknown>);
  const avaliacao = DEFS[tipo].avaliar(entrada, config, HOJE, SEM_FERIADOS);
  return {
    avaliacao,
    decisao: decidir(
      tipo,
      entrada,
      config as { aprovacao: 'automatica' | 'funcionario' },
      avaliacao,
    ),
  };
}

describe('decidir: os humanos só tratam das exceções', () => {
  it.each(TIPOS)('%s: por omissão, a câmara deixa decidir sozinho', (t) => {
    expect((DEFS[t].omissao as { aprovacao: string }).aprovacao).toBe(
      'automatica',
    );
  });

  describe.each(TIPOS)('%s', (tipo) => {
    it('cumpre todas as regras → decidido automaticamente, sem motivos', () => {
      const { avaliacao, decisao } = correr(tipo, CUMPRE[tipo]);
      expect(avaliacao.regras.every((r) => r.ok)).toBe(true);
      expect(decisao).toEqual({ via: 'automatica', motivos: [] });
    });

    it('com a câmara a pedir funcionário → funcionário confirma', () => {
      const config = {
        ...(DEFS[tipo].omissao as Record<string, unknown>),
        aprovacao: 'funcionario',
      };
      expect(correr(tipo, CUMPRE[tipo], config).decisao.via).toBe(
        'funcionario',
      );
    });

    it.each(Object.entries(VIOLA[tipo]))(
      'viola "%s" → exceção, com esse motivo e a frase concreta',
      (id, mudanca) => {
        const { avaliacao, decisao } = correr(tipo, {
          ...CUMPRE[tipo],
          ...mudanca,
        });
        expect(avaliacao.proposta).toBe('tecnico');
        expect(decisao.via).toBe('excecao');
        const m = decisao.motivos.find(
          (x) => x.tipo === 'regra' && x.id === id,
        );
        expect(m).toBeDefined();
        expect(m!.rotulo).toBe(ROTULOS_REGRAS[tipo][id]);
        expect(m!.texto.length).toBeGreaterThan(5);
        // Mesmo com a câmara a pedir funcionário, é uma exceção (vai a técnico).
        const config = {
          ...(DEFS[tipo].omissao as Record<string, unknown>),
          aprovacao: 'funcionario',
        };
        expect(
          correr(tipo, { ...CUMPRE[tipo], ...mudanca }, config).decisao.via,
        ).toBe('excecao');
      },
    );

    it('todas as regras que o motor verifica têm nome curto e frase pública', () => {
      const ids = new Set<string>();
      for (const mudanca of [{}, ...Object.values(VIOLA[tipo])]) {
        for (const r of correr(tipo, { ...CUMPRE[tipo], ...mudanca }).avaliacao
          .regras) {
          ids.add(r.id);
        }
      }
      const frases = new Set(
        frasesRegras(tipo, DEFS[tipo].omissao).map((f) => f.id),
      );
      for (const id of ids) {
        expect(ROTULOS_REGRAS[tipo][id]).toBeDefined();
        expect(frases.has(id)).toBe(true);
      }
    });
  });

  it('publicidade: anúncio iluminado com a regra ligada → exceção "iluminado"', () => {
    const config = {
      ...(DEFS.publicidade.omissao as Record<string, unknown>),
      iluminado_vai_a_tecnico: true,
    };
    const { decisao } = correr(
      'publicidade',
      { ...CUMPRE.publicidade, iluminado: true },
      config,
    );
    expect(decisao.via).toBe('excecao');
    expect(decisao.motivos.map((m) => m.id)).toContain('iluminado');
  });

  describe('dados em falta', () => {
    it('ruído sem dizer quantas pessoas → exceção "falta saber"', () => {
      const sem = sem_(CUMPRE.ruido, 'pessoas');
      const { avaliacao, decisao } = correr('ruido', sem);
      expect(avaliacao.proposta).toBe('aprovar');
      expect(decisao.via).toBe('excecao');
      expect(decisao.motivos).toEqual([
        expect.objectContaining({ tipo: 'dado_em_falta', id: 'pessoas' }),
      ]);
    });

    it('ocupação sem dizer se ocupa a estrada → exceção; sem a regra, não interessa', () => {
      const sem = sem_(CUMPRE.ocupacao_via, 'ocupa_estrada');
      expect(correr('ocupacao_via', sem).decisao.motivos[0]).toMatchObject({
        tipo: 'dado_em_falta',
        id: 'ocupa_estrada',
      });
      const semRegra = {
        ...(DEFS.ocupacao_via.omissao as Record<string, unknown>),
        estrada_vai_a_tecnico: false,
      };
      expect(correr('ocupacao_via', sem, semRegra).decisao.via).toBe(
        'automatica',
      );
    });

    it('esplanada sem estrado nem centro histórico → dois dados em falta', () => {
      const sem = sem_(CUMPRE.esplanada, 'estrado', 'centro_historico');
      expect(correr('esplanada', sem).decisao.motivos.map((m) => m.id)).toEqual(
        ['estrado', 'centro_historico'],
      );
    });

    it('com funcionário, quem confirma vê o que falta', () => {
      const sem = sem_(CUMPRE.ruido, 'pessoas');
      const config = {
        ...(DEFS.ruido.omissao as Record<string, unknown>),
        aprovacao: 'funcionario',
      };
      const d = correr('ruido', sem, config).decisao;
      expect(d.via).toBe('funcionario');
      expect(d.motivos[0].id).toBe('pessoas');
    });
  });
});

describe('podeEmitirSozinha', () => {
  const ok = { id: 'a', ok: true, texto: 'ok' };
  const falha = { id: 'b', ok: false, texto: 'falha' };

  it('só com decisão automática, proposta aprovar e todas as regras a passar', () => {
    expect(
      podeEmitirSozinha({
        decisao: 'automatica',
        proposta: 'aprovar',
        avaliacao: { regras: [ok] },
      }),
    ).toBe(true);
  });

  it.each([
    ['decisão de funcionário', { decisao: 'funcionario' as const }],
    ['exceção', { decisao: 'excecao' as const }],
    ['sem decisão (licença antiga)', { decisao: null }],
    ['proposta técnico', { proposta: 'tecnico' as const }],
    ['uma regra falhada', { avaliacao: { regras: [ok, falha] } }],
    ['sem regras', { avaliacao: { regras: [] } }],
    [
      'com motivos de exceção',
      {
        excecao: [
          { tipo: 'dado_em_falta' as const, id: 'x', rotulo: 'x', texto: 'x' },
        ],
      },
    ],
  ])('não emite sozinha com %s', (_n, mudanca) => {
    expect(
      podeEmitirSozinha({
        decisao: 'automatica',
        proposta: 'aprovar',
        avaliacao: { regras: [ok] },
        ...mudanca,
      }),
    ).toBe(false);
  });
});
