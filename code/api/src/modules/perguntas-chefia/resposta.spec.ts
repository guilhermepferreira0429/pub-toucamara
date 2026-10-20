import {
  ConsultaGuardada,
  EntradaResponder,
  esquemaResponder,
  formatar,
  paraModelo,
  resolverResposta,
} from './resposta.js';

const c1: ConsultaGuardada = {
  id: 'c1',
  ferramenta: 'contar_processos',
  parametros: { tipo: 'obras', atrasados: true, de: null, ate: null },
  resultado: {
    valores: { total: 7, atrasados: 7 },
    unidades: { total: 'processos', atrasados: 'processos' },
    filtros: { tipos: ['CP · Comunicação prévia'] },
    fonte: 'Processos',
  },
  erro: null,
  ms: 3,
};

const c2: ConsultaGuardada = {
  id: 'c2',
  ferramenta: 'listar_processos',
  parametros: { atrasados: true, de: '2026-10-01', ate: '2026-10-19' },
  resultado: {
    valores: { total: 60 },
    unidades: { total: 'processos', dias_uteis_restantes: 'dias úteis' },
    linhas: Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`,
      numero: `CP ${i + 100}/2026`,
      assunto: 'Obra',
      dias_uteis_restantes: -i,
    })),
    colunas: [
      { chave: 'numero', rotulo: 'Processo' },
      { chave: 'assunto', rotulo: 'Assunto' },
      { chave: 'dias_uteis_restantes', rotulo: 'Dias úteis restantes' },
    ],
    objeto: 'processo',
    total_linhas: 60,
    fonte: 'Processos',
  },
  erro: null,
  ms: 4,
};

const comErro: ConsultaGuardada = {
  id: 'c3',
  ferramenta: 'contar_processos',
  parametros: { tipo: 'piscinas' },
  resultado: null,
  erro: { codigo: 'tipo_desconhecido', mensagem: 'Nenhum tipo.' },
  ms: 1,
};

const ctx = {
  pergunta: 'Quantos processos de obras estão atrasados?',
  hoje: '2026-10-19',
  consultas: [c1, c2, comErro],
};

function entrada(e: Partial<EntradaResponder>): EntradaResponder {
  return {
    resposta: 'Há {1} processos de obras atrasados.',
    numeros_chave: [
      { rotulo: 'Atrasados', consulta: 'c1', campo: 'total', linha: null },
    ],
    tabela: null,
    sugestoes: ['Quais são?'],
    sem_dados: false,
    ...e,
  };
}

describe('resolverResposta', () => {
  it('os números vêm do resultado guardado, não do modelo', () => {
    const r = resolverResposta(entrada({}), ctx);
    expect(r).toMatchObject({
      ok: true,
      resposta: {
        resposta: 'Há 7 processos de obras atrasados.',
        numeros_chave: [
          {
            rotulo: 'Atrasados',
            valor: 7,
            unidade: 'processos',
            consulta: 'c1',
          },
        ],
        tabela: null,
        sugestoes: ['Quais são?'],
        sem_dados: false,
        texto_verificado: true,
      },
    });
  });

  it('"como foi calculado" lista todas as consultas, com erros', () => {
    const r = resolverResposta(entrada({}), ctx);
    if (!r.ok) throw new Error('devia resolver');
    expect(r.resposta.consultas).toEqual([
      expect.objectContaining({
        id: 'c1',
        ferramenta: 'contar_processos',
        linhas_devolvidas: 1,
        fonte: 'Processos',
        erro: null,
      }),
      expect.objectContaining({ id: 'c2', linhas_devolvidas: 60 }),
      expect.objectContaining({ id: 'c3', erro: 'Nenhum tipo.' }),
    ]);
  });

  it('número tirado de uma linha e tabela com ids, colunas escolhidas e no máximo 50', () => {
    const r = resolverResposta(
      entrada({
        resposta: 'O mais atrasado tem {1} dias úteis.',
        numeros_chave: [
          {
            rotulo: 'Mais atrasado',
            consulta: 'c2',
            campo: 'dias_uteis_restantes',
            linha: 3,
          },
        ],
        tabela: { consulta: 'c2', colunas: ['numero', 'dias_uteis_restantes'] },
      }),
      ctx,
    );
    if (!r.ok) throw new Error(r.erros.join());
    expect(r.resposta.resposta).toBe('O mais atrasado tem -3 dias úteis.');
    expect(r.resposta.numeros_chave[0].unidade).toBe('dias úteis');
    const t = r.resposta.tabela!;
    expect(t.linhas).toHaveLength(50);
    expect(t.total_linhas).toBe(60);
    expect(t.objeto).toBe('processo');
    expect(t.colunas.map((c) => c.chave)).toEqual([
      'numero',
      'dias_uteis_restantes',
    ]);
    expect(t.linhas[0]).toEqual({
      id: 'p0',
      numero: 'CP 100/2026',
      dias_uteis_restantes: -0,
    });
  });

  it('referências erradas voltam ao modelo para corrigir', () => {
    const r = resolverResposta(
      entrada({
        resposta: 'Há {1} e {3}.',
        numeros_chave: [
          { rotulo: 'X', consulta: 'c9', campo: 'total', linha: null },
          { rotulo: 'Y', consulta: 'c1', campo: 'inventado', linha: null },
          { rotulo: 'Z', consulta: 'c2', campo: 'numero', linha: 99 },
          { rotulo: 'W', consulta: 'c3', campo: 'total', linha: null },
        ],
        tabela: { consulta: 'c1', colunas: null },
      }),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros).toEqual([
      'A consulta "c9" não existe.',
      'A consulta "c1" não tem o campo "inventado". Campos: total, atrasados.',
      'A consulta "c2" não tem a linha 99.',
      'A consulta "c3" deu erro; não tem dados.',
      'A consulta "c1" não tem linhas.',
    ]);
  });

  it('colunas que não existem e marcadores a mais são erros', () => {
    const r = resolverResposta(
      entrada({
        resposta: 'Há {2}.',
        tabela: { consulta: 'c2', colunas: ['numero', 'nif'] },
      }),
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erros[0]).toMatch(/Colunas que não existem em "c2": nif/);
    expect(r.erros[1]).toMatch(/\{2\} mas numeros_chave só tem 1/);
  });

  it('um número inventado no texto troca-o por um texto neutro feito dos números', () => {
    const r = resolverResposta(
      entrada({ resposta: 'Há 12 processos atrasados, mais {1} em risco.' }),
      ctx,
    );
    if (!r.ok) throw new Error('devia resolver');
    expect(r.resposta.texto_verificado).toBe(false);
    expect(r.resposta.resposta).toBe('Atrasados: 7 processos');
    expect(r.resposta.resposta).not.toContain('12');
  });

  it('números da pergunta, das datas, dos parâmetros e dos resultados são aceites', () => {
    const r = resolverResposta(
      entrada({
        resposta:
          'Entre 1 de outubro e 19/10/2026 (19 dias), {1} processos; 60 na lista, o CP 103/2026 incluído.',
      }),
      ctx,
    );
    if (!r.ok) throw new Error('devia resolver');
    expect(r.resposta.texto_verificado).toBe(true);
  });

  it('sem dados: sem números nem tabela', () => {
    const r = resolverResposta(
      entrada({
        resposta: 'Não tenho dados sobre o orçamento.',
        numeros_chave: [],
        sem_dados: true,
      }),
      { ...ctx, consultas: [] },
    );
    expect(r).toMatchObject({
      ok: true,
      resposta: { sem_dados: true, numeros_chave: [], consultas: [] },
    });
  });
});

describe('formatar e paraModelo', () => {
  it('números à portuguesa', () => {
    expect(formatar(1234.5)).toBe('1234,5');
    expect(formatar(25)).toBe('25');
    expect(formatar(null)).toBe('sem dados');
    expect(formatar(12345).replace(/\s/g, ' ')).toBe('12 345');
  });

  it('o modelo não recebe os ids internos das linhas', () => {
    const m = paraModelo(c2) as { linhas: Record<string, unknown>[] };
    expect(m.linhas).toHaveLength(50);
    expect(m.linhas[0]).not.toHaveProperty('id');
    expect(paraModelo(comErro)).toEqual({
      consulta: 'c3',
      erro: { codigo: 'tipo_desconhecido', mensagem: 'Nenhum tipo.' },
    });
  });

  it('o esquema do responder recusa chaves a mais e mais de 4 números', () => {
    const base = entrada({});
    expect(esquemaResponder.safeParse(base).success).toBe(true);
    expect(
      esquemaResponder.safeParse({ ...base, municipio_id: 'x' }).success,
    ).toBe(false);
    expect(
      esquemaResponder.safeParse({
        ...base,
        numeros_chave: Array(5).fill(base.numeros_chave[0]),
      }).success,
    ).toBe(false);
  });
});
