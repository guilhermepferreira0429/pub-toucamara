import {
  avaliarDistico,
  CONFIG_DISTICO_OMISSAO,
  entradaDistico,
  normalizarMatricula,
  PedidoDistico,
} from './regras-distico';

const C = CONFIG_DISTICO_OMISSAO;

const distico = (p: Partial<PedidoDistico> = {}): PedidoDistico => ({
  morada: 'Rua da Rainha 20, 1.º Esq., Guimarães',
  matricula: 'AA-12-BB',
  disticos_ja_tem: 0,
  morada_comprovada: true,
  viatura_em_nome: true,
  ...p,
});

describe('avaliarDistico', () => {
  it('primeiro dístico, com morada e carro em nome: aprova e paga a taxa do 1.º', () => {
    const a = avaliarDistico(distico(), C);
    expect(a.proposta).toBe('aprovar');
    expect(a.taxa.total_cent).toBe(1200);
    expect(a.condicoes[0]).toContain('AA-12-BB');
  });

  it('segundo dístico paga mais; o terceiro vai a técnico', () => {
    expect(avaliarDistico(distico({ disticos_ja_tem: 1 }), C)).toMatchObject({
      proposta: 'aprovar',
      taxa: { total_cent: 3000 },
    });
    const a = avaliarDistico(distico({ disticos_ja_tem: 2 }), C);
    expect(a.proposta).toBe('tecnico');
    expect(a.regras.find((r) => r.id === 'por_fogo')?.texto).toContain('3.º');
    // A tabela repete o último valor.
    expect(a.taxa.total_cent).toBe(3000);
  });

  it('morada por comprovar e carro de outra pessoa → técnico (a não ser que a câmara não exija)', () => {
    const p = distico({ morada_comprovada: false, viatura_em_nome: false });
    expect(avaliarDistico(p, C).regras.filter((r) => !r.ok)).toHaveLength(2);
    expect(
      avaliarDistico(p, {
        ...C,
        exige_morada_comprovada: false,
        exige_viatura_em_nome: false,
      }).proposta,
    ).toBe('aprovar');
  });

  it('matrícula estranha vai a técnico; a entrada normaliza o formato', () => {
    expect(avaliarDistico(distico({ matricula: 'XPTO' }), C).proposta).toBe(
      'tecnico',
    );
    expect(normalizarMatricula('aa12bb')).toBe('AA-12-BB');
    expect(
      entradaDistico.parse({
        ...distico(),
        matricula: '12 ab 34',
        disticos_ja_tem: undefined,
      }),
    ).toMatchObject({
      matricula: '12-AB-34',
      disticos_ja_tem: 0,
    });
  });
});
