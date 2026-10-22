import {
  esquemaResposta,
  indicadoresSatisfacao,
  limparComentario,
  MAX_COMENTARIO,
} from './satisfacao.regras';

describe('esquemaResposta', () => {
  it('nota de 1 a 5, inteira; comentário opcional', () => {
    expect(esquemaResposta.parse({ nota: 4 })).toEqual({
      nota: 4,
      comentario: null,
    });
    expect(esquemaResposta.parse({ nota: '5', comentario: '  ' })).toEqual({
      nota: 5,
      comentario: null,
    });
    for (const nota of [0, 6, 2.5, 'x', null]) {
      expect(esquemaResposta.safeParse({ nota }).success).toBe(false);
    }
    expect(esquemaResposta.safeParse({}).success).toBe(false);
  });

  it('comentário limpo: espaços, controlo, linhas em branco, máximo', () => {
    expect(
      limparComentario('  Demorou\u0000 muito   a atender \n\n\n\nObrigado '),
    ).toBe('Demorou muito a atender \n\nObrigado');
    expect(limparComentario(null)).toBeNull();
    expect(limparComentario('a'.repeat(1500))).toHaveLength(MAX_COMENTARIO);
    expect(
      esquemaResposta.safeParse({ nota: 3, comentario: 'a'.repeat(5000) })
        .success,
    ).toBe(false);
  });
});

describe('indicadoresSatisfacao', () => {
  it('média com uma casa, taxa de resposta e satisfeitos (4 e 5)', () => {
    const r = indicadoresSatisfacao({
      respostas: 3,
      soma: 13,
      elegiveis: 8,
      por_nota: [0, 0, 1, 0, 2],
    });
    expect(r).toEqual({
      media: 4.3,
      respostas: 3,
      elegiveis: 8,
      taxa_resposta_pct: 37.5,
      satisfeitos_pct: 66.7,
      distribuicao: [
        { nota: 1, respostas: 0 },
        { nota: 2, respostas: 0 },
        { nota: 3, respostas: 1 },
        { nota: 4, respostas: 0 },
        { nota: 5, respostas: 2 },
      ],
    });
  });

  it('sem respostas nem links: nulls, não zeros enganadores', () => {
    const r = indicadoresSatisfacao({
      respostas: 0,
      soma: 0,
      elegiveis: 0,
      por_nota: [],
    });
    expect(r.media).toBeNull();
    expect(r.taxa_resposta_pct).toBeNull();
    expect(r.satisfeitos_pct).toBeNull();
    expect(r.distribuicao.map((d) => d.respostas)).toEqual([0, 0, 0, 0, 0]);
  });

  it('a taxa não passa dos 100%', () => {
    expect(
      indicadoresSatisfacao({
        respostas: 3,
        soma: 15,
        elegiveis: 2,
        por_nota: [0, 0, 0, 0, 3],
      }).taxa_resposta_pct,
    ).toBe(100);
  });
});
