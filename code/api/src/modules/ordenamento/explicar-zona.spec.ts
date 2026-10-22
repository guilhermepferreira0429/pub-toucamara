import { alteracoesZona, explicarZona, frasesObra } from './explicar-zona';
import { ZONAS_DEMONSTRACAO } from './regras';

describe('regras de uma zona em linguagem simples', () => {
  it('degraus → "até X m²" e o que acontece acima', () => {
    expect(
      frasesObra({
        degraus: [
          { controlo: 'isento', area_max_m2: 10 },
          { controlo: 'comunicacao_previa', area_max_m2: 30, altura_max_m: 3 },
        ],
        acima: 'licenca',
        notas: [],
      }),
    ).toEqual([
      'Não precisa de pedir nada à câmara até 10 m².',
      'Precisa de uma comunicação prévia até 30 m² e 3 m de altura.',
      'Acima disso, precisa de licença.',
    ]);
  });

  it('sem limites: uma frase só', () => {
    expect(
      frasesObra({ degraus: [], acima: 'nao_permitido', notas: [] }),
    ).toEqual(['Não é permitido nesta zona.']);
  });

  it('as zonas de demonstração explicam-se e dizem que medidas contam', () => {
    for (const z of ZONAS_DEMONSTRACAO) {
      const obras = explicarZona(z.regras);
      expect(obras.length).toBeGreaterThan(0);
      for (const o of obras) expect(o.frases.length).toBeGreaterThan(0);
    }
  });

  it('o que mudou numa zona', () => {
    const z = ZONAS_DEMONSTRACAO[0];
    const antes = {
      nome: z.nome,
      descricao: z.descricao,
      regras: z.regras,
      fonte: z.fonte,
      demonstracao: true,
    };
    const depois = {
      ...antes,
      regras: {
        ...z.regras,
        muro: { degraus: [], acima: 'licenca' as const, notas: [] },
      },
      demonstracao: false,
    };
    const a = alteracoesZona(antes, depois);
    expect(a.map((x) => x.campo)).toEqual(['muro', 'demonstracao']);
    expect(a[0].depois).toBe('Precisa de licença.');
  });
});
