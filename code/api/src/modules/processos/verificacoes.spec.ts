import { ZONAS_DEMONSTRACAO } from '../ordenamento/regras.js';
import { conteudoRascunho } from './apoio.js';
import {
  contagem,
  controloDoTipo,
  DocumentoLido,
  interpretarLeitura,
  juntarVerificacoes,
  LeituraProjeto,
  leituraNaoVerificavel,
  obraDoProcesso,
  OrdemSimulada,
  somarMeses,
  verificacoesEmTexto,
  verificarInstrucao,
  verificarOrdem,
  verificarPdm,
  verificarTermo,
  ZonaParaVerificar,
} from './verificacoes.js';
import { gerarProjetoDemonstracao } from './projeto-demonstracao-pdf.js';

const ZONAS: ZonaParaVerificar[] = ZONAS_DEMONSTRACAO.map((z) => ({
  ...z,
  demonstracao: true,
}));
const CP = { codigo: 'CP', nome: 'Comunicação prévia · obras de alteração' };

describe('operação do processo', () => {
  it('tipo → controlo', () => {
    expect(controloDoTipo(CP)).toBe('comunicacao_previa');
    expect(controloDoTipo({ codigo: 'LO', nome: 'Licença de obras' })).toBe(
      'licenca',
    );
    expect(
      controloDoTipo({ codigo: 'LER', nome: 'Licença especial de ruído' }),
    ).toBeNull();
  });

  it('texto → obra do PDM', () => {
    expect(
      obraDoProcesso('Porta na cozinha. Abertura de um vão em parede interior'),
    ).toBe('interior');
    expect(obraDoProcesso('Abrir uma janela na fachada')).toBe('fachada');
    expect(obraDoProcesso('Piscina no quintal')).toBe('piscina');
    expect(obraDoProcesso('Licença especial de ruído')).toBeNull();
  });
});

describe('PDM no local', () => {
  const base = { zonas: ZONAS, obra: 'interior' as const, tipo: CP };

  it('espaço residencial, fora do centro histórico: ok (demonstração)', () => {
    const v = verificarPdm({ ...base, ponto: [41.437, -8.305] });
    expect(v).toMatchObject({
      codigo: 'pdm',
      estado: 'ok',
      origem: 'regra',
      a_confirmar: false,
      demonstracao: true,
      titulo: 'Sem condicionantes do PDM no local',
      detalhe: 'Espaço residencial consolidado, fora do centro histórico',
    });
    expect(v.evidencias[0]).toMatchObject({ tipo: 'regra' });
    expect(v.evidencias[0].rotulo).toContain('(ERC)');
  });

  it('centro histórico: atenção com as condicionantes do património', () => {
    const v = verificarPdm({ ...base, ponto: [41.443, -8.295] });
    expect(v.estado).toBe('atencao');
    expect(v.titulo).toBe('Condicionantes no local: Centro Histórico');
    expect(v.detalhe).toMatch(/Património Mundial/);
  });

  it('obra que o PDM não admite: falha; que pede licença: atenção', () => {
    expect(
      verificarPdm({ ...base, obra: 'piscina', ponto: [41.44, -8.27] }).estado,
    ).toBe('falha');
    const v = verificarPdm({
      ...base,
      obra: 'ampliacao',
      ponto: [41.42, -8.3],
    });
    expect(v.estado).toBe('atencao');
    expect(v.titulo).toBe('O PDM pede licença no local');
  });

  it('sem coordenadas, sem zonas ou fora das zonas: não verificável, com o porquê', () => {
    expect(
      verificarPdm({
        ...base,
        ponto: null,
        sem_ponto: 'O processo não tem morada nem coordenadas.',
      }),
    ).toMatchObject({
      estado: 'nao_verificavel',
      detalhe: 'O processo não tem morada nem coordenadas.',
    });
    expect(
      verificarPdm({ ...base, zonas: [], ponto: [41.437, -8.305] }).detalhe,
    ).toMatch(/não está carregado/);
    expect(verificarPdm({ ...base, ponto: [40, -8] }).detalhe).toMatch(
      /fora das zonas/,
    );
  });
});

describe('instrução do processo', () => {
  it('completa', () => {
    expect(
      verificarInstrucao({
        tipo_nome: CP.nome,
        exigidos: 2,
        tem: ['Certidão do registo predial', 'Termo de responsabilidade'],
        faltam: [],
      }),
    ).toMatchObject({
      estado: 'ok',
      titulo: 'Processo instruído com todos os elementos',
      detalhe:
        'Entregues: Certidão do registo predial e Termo de responsabilidade.',
    });
  });

  it('em falta', () => {
    expect(
      verificarInstrucao({
        tipo_nome: CP.nome,
        exigidos: 2,
        tem: [],
        faltam: ['Certidão do registo predial', 'Termo de responsabilidade'],
      }),
    ).toMatchObject({ estado: 'falha', titulo: 'Faltam 2 elementos' });
  });

  it('tipo sem documentos configurados: não verificável', () => {
    expect(
      verificarInstrucao({ tipo_nome: 'X', exigidos: 0, tem: [], faltam: [] })
        .estado,
    ).toBe('nao_verificavel');
  });
});

describe('termo de responsabilidade', () => {
  const doc = {
    id: 'd1',
    nome: 'Termo de responsabilidade',
    verificacao_estado: 'valido',
    verificacao: [
      { regra: 'assinatura', ok: true, detalhe: 'Assinatura visível' },
    ],
    emitido_em: '2026-10-05',
    recebido_em: '2026-10-06',
  };

  it('válido, com a assinatura verificada', () => {
    const v = verificarTermo({
      documento: doc,
      validade_meses: 12,
      hoje: '2026-10-22',
    });
    expect(v.estado).toBe('ok');
    expect(v.titulo).toBe('Termo de responsabilidade válido');
    expect(v.detalhe).toContain('assinatura verificada');
    expect(v.detalhe).toContain('válido até 05/10/2027');
    expect(v.evidencias[0]).toMatchObject({ documento_id: 'd1' });
  });

  it('caducado (validade configurada) ou fora de prazo', () => {
    const v = verificarTermo({
      documento: { ...doc, emitido_em: '2025-01-31' },
      validade_meses: 6,
      hoje: '2026-10-22',
    });
    expect(v).toMatchObject({
      estado: 'falha',
      titulo: 'Termo de responsabilidade caducado',
    });
    expect(v.detalhe).toContain('valia até 31/07/2025');
    expect(
      verificarTermo({
        documento: { ...doc, verificacao_estado: 'fora_de_prazo' },
        validade_meses: null,
        hoje: '2026-10-22',
      }).estado,
    ).toBe('falha');
  });

  it('em falta, errado, por verificar', () => {
    expect(
      verificarTermo({
        documento: null,
        validade_meses: null,
        hoje: '2026-10-22',
      }).estado,
    ).toBe('falha');
    expect(
      verificarTermo({
        documento: { ...doc, verificacao_estado: 'documento_errado' },
        validade_meses: null,
        hoje: '2026-10-22',
      }).titulo,
    ).toMatch(/não é o documento certo/);
    expect(
      verificarTermo({
        documento: {
          ...doc,
          verificacao_estado: 'por_verificar',
          verificacao: null,
        },
        validade_meses: null,
        hoje: '2026-10-22',
      }).estado,
    ).toBe('atencao');
  });

  it('somar meses fica no fim do mês', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('Ordem (simulada)', () => {
  const t = {
    nome: 'Joana Lima',
    ordem: 'OA' as const,
    numero_inscricao: '12345',
  };

  it('inscrito, mas sempre marcado como simulado', async () => {
    const r = await new OrdemSimulada().consultar(t);
    expect(r).toMatchObject({ estado: 'inscrito', simulado: true });
    const v = verificarOrdem(t, r);
    expect(v).toMatchObject({
      estado: 'ok',
      origem: 'simulado',
      a_confirmar: true,
      demonstracao: true,
      titulo: 'Técnico inscrito na Ordem',
    });
    expect(v.detalhe).toBe('Joana Lima, Ordem dos Arquitectos n.º 12345');
    expect(v.notas[0]).toMatch(/simulada/i);
  });

  it('número com formato estranho: atenção', async () => {
    const t2 = { ...t, numero_inscricao: 'abc' };
    const v = verificarOrdem(t2, await new OrdemSimulada().consultar(t2));
    expect(v.estado).toBe('atencao');
  });

  it('sem dados do técnico: não verificável', () => {
    expect(verificarOrdem(null, null).estado).toBe('nao_verificavel');
  });
});

describe('leitura do projeto pela IA', () => {
  const docs: DocumentoLido[] = [
    { id: 'p1', nome: 'Projeto de arquitetura' },
    { id: 't1', nome: 'Termo de responsabilidade' },
  ];
  const leitura: LeituraProjeto = {
    legivel: true,
    motivo_ilegivel: null,
    fachada_cobertura: {
      alteracoes: 'nao',
      descricao: 'Os alçados mantêm-se.',
      referencia: { documento: 1, pagina: 3, folha: 'Folha 3' },
    },
    paredes: {
      abertura_ou_demolicao: 'sim',
      declarada_nao_estrutural: true,
      descricao: 'Vão de 0,90 m entre a cozinha e a sala.',
      referencia: { documento: 1, pagina: 2, folha: '2' },
    },
    planta_estruturas: { existe: false, referencia: null },
    areas_cerceas: {
      coerentes: 'sim',
      descricao: '142 m², sem alteração.',
      referencia: { documento: 9, pagina: 1, folha: null },
    },
    contradicoes: [],
    medicoes: [],
    elementos: [],
    tecnico_autor: {
      nome: 'Joana Lima',
      ordem: 'OA',
      numero_inscricao: '12345',
      termo_assinado: true,
      referencia: { documento: 2, pagina: 1, folha: null },
    },
  };

  it('dá o ✓ da fachada (a confirmar) e o ⚠ da parede do design', () => {
    const r = interpretarLeitura(leitura, docs);
    expect(r.antes).toHaveLength(1);
    expect(r.antes[0]).toMatchObject({
      codigo: 'ia_fachada',
      estado: 'ok',
      origem: 'ia',
      a_confirmar: true,
      titulo: 'Fachada e cobertura sem alterações',
      detalhe: 'Projeto de arquitetura, folha 3',
    });
    expect(r.antes[0].evidencias[0]).toMatchObject({
      documento_id: 'p1',
      pagina: 3,
    });
    const parede = r.depois.find((x) => x.codigo === 'ia_paredes');
    expect(parede).toMatchObject({
      estado: 'atencao',
      titulo: 'Parede a abrir: confirmar que não é estrutural',
      detalhe:
        'O projeto diz “não estrutural”, mas não há planta de estruturas',
    });
    // Referência a um documento que não existe: sem evidência.
    expect(r.depois.find((x) => x.codigo === 'ia_areas')?.evidencias).toEqual(
      [],
    );
    expect(r.tecnico).toEqual({
      nome: 'Joana Lima',
      ordem: 'OA',
      numero_inscricao: '12345',
    });
    expect(r.termo_assinado).toBe(true);
    // Nada da IA sai como "ok" sem ser a confirmar.
    expect([...r.antes, ...r.depois].every((x) => x.a_confirmar)).toBe(true);
  });

  it('resposta inválida ou ilegível: não verificável', () => {
    const r = interpretarLeitura({ legivel: 'sim' }, docs);
    expect(r.depois).toEqual([
      expect.objectContaining({
        codigo: 'ia_leitura',
        estado: 'nao_verificavel',
      }),
    ]);
    expect(r.tecnico).toBeNull();
    const i = interpretarLeitura(
      {
        ...leitura,
        legivel: false,
        motivo_ilegivel: 'As páginas estão em branco.',
      },
      docs,
    );
    expect(i.antes).toEqual([]);
    expect(i.depois[0].detalhe).toBe(
      'A IA não conseguiu ler o projeto: as páginas estão em branco.',
    );
  });

  it('sem IA: uma linha a dizer porquê', () => {
    expect(leituraNaoVerificavel('A IA não está configurada.')).toMatchObject({
      estado: 'nao_verificavel',
      origem: 'ia',
      a_confirmar: false,
    });
  });
});

describe('juntar e usar nos rascunhos', () => {
  it('ordem do design e texto para a IA dos rascunhos', () => {
    const r = interpretarLeitura(
      {
        legivel: true,
        motivo_ilegivel: null,
        fachada_cobertura: {
          alteracoes: 'nao',
          descricao: 'x',
          referencia: null,
        },
        paredes: {
          abertura_ou_demolicao: 'sim',
          declarada_nao_estrutural: true,
          descricao: 'x',
          referencia: null,
        },
        planta_estruturas: { existe: false, referencia: null },
        areas_cerceas: {
          coerentes: 'sem_dados',
          descricao: '',
          referencia: null,
        },
        contradicoes: [],
        tecnico_autor: null,
      },
      [],
    );
    const todos = juntarVerificacoes({
      leitura: r,
      instrucao: verificarInstrucao({
        tipo_nome: 'CP',
        exigidos: 1,
        tem: ['A'],
        faltam: [],
      }),
      termo: verificarTermo({
        documento: null,
        validade_meses: null,
        hoje: '2026-10-22',
      }),
      ordem: verificarOrdem(null, null),
      pdm: verificarPdm({
        zonas: ZONAS,
        obra: 'interior',
        tipo: CP,
        ponto: [41.437, -8.305],
      }),
    });
    expect(todos.map((x) => x.codigo)).toEqual([
      'ia_fachada',
      'instrucao',
      'termo',
      'ordem',
      'pdm',
      'ia_paredes',
    ]);
    expect(contagem(todos)).toEqual({
      ok: 3,
      atencao: 1,
      falha: 1,
      nao_verificavel: 1,
    });
    const texto = verificacoesEmTexto(todos);
    expect(texto).toContain(
      '- [ATENÇÃO] Parede a abrir: confirmar que não é estrutural: O projeto diz “não estrutural”, mas não há planta de estruturas (leitura da IA, a confirmar pelo técnico)',
    );
    expect(texto).toContain('valores de demonstração');

    const c = conteudoRascunho({
      tipo: 'parecer',
      municipio: 'X',
      processo: 'P',
      destinatario: null,
      regulamento: [],
      modelo: null,
      documentos_pedidos: [],
      prazo_dias_uteis: null,
      instrucoes: null,
      verificacoes: todos,
    });
    expect(c).toContain('## Verificações automáticas\n- [ok] Fachada');
  });
});

describe('projeto de demonstração', () => {
  it('gera um PDF com 3 folhas, sempre igual', async () => {
    const a = await gerarProjetoDemonstracao();
    const b = await gerarProjetoDemonstracao();
    expect(a.subarray(0, 5).toString()).toBe('%PDF-');
    expect(a.equals(b)).toBe(true);
    expect((a.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBe(
      3,
    );
  });
});
