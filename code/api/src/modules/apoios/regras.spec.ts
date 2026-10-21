import {
  APOIOS_DEMONSTRACAO,
  avaliarApoio,
  avaliarApoios,
  escalaoRendimento,
  esquemaApoio,
  esquemaCriterios,
  juntarPerfis,
  listaDita,
  Perfil,
  perfilGuardado,
} from './regras';

const apoio = (codigo: string) => {
  const a = APOIOS_DEMONSTRACAO.find((x) => x.codigo === codigo);
  if (!a) throw new Error(codigo);
  return a;
};

const codigos = (l: { codigo: string }[]) => l.map((x) => x.codigo).sort();

describe('avaliarApoios', () => {
  it('sem saber nada: tudo "talvez" e pergunta primeiro se mora no concelho', () => {
    const a = avaliarApoios({}, APOIOS_DEMONSTRACAO);
    expect(a.tem_direito).toEqual([]);
    expect(a.nao).toEqual([]);
    expect(a.talvez).toHaveLength(APOIOS_DEMONSTRACAO.length);
    // Todos os apoios de demonstração pedem morada no concelho.
    expect(a.falta_saber[0]).toMatchObject({
      campo: 'residente_concelho',
      apoios: APOIOS_DEMONSTRACAO.length,
    });
    expect(a.falta_saber.map((f) => f.campo)).toEqual(
      expect.arrayContaining([
        'idade',
        'filhos_idades',
        'inquilino',
        'pessoas_agregado',
        'rendimento_mensal_agregado',
      ]),
    );
  });

  it('idosa sozinha, inquilina, 600 € por mês: renda, água e cartão; não cheque bebé', () => {
    const p: Perfil = {
      idade: 72,
      pessoas_agregado: 1,
      rendimento_mensal_agregado: 450,
      filhos_idades: [],
      inquilino: true,
      residente_concelho: true,
    };
    const a = avaliarApoios(p, APOIOS_DEMONSTRACAO);
    expect(codigos(a.tem_direito)).toEqual([
      'apoio_renda',
      'cartao_idoso',
      'tarifa_social_agua',
    ]);
    expect(codigos(a.nao)).toEqual(['cheque_bebe', 'material_escolar']);
    expect(a.talvez).toEqual([]);
    expect(a.falta_saber).toEqual([]);
    const renda = a.tem_direito.find((x) => x.codigo === 'apoio_renda')!;
    // O porquê não diz o rendimento (fica guardado): só o limite.
    expect(renda.porque.join(' ')).toContain('abaixo do limite de 700 €');
    expect(renda.porque.join(' ')).not.toContain('450');
    expect(renda.porque).toContain('Vive em casa arrendada.');
  });

  it('rendimento por pessoa = rendimento da casa a dividir pelas pessoas', () => {
    const base: Perfil = {
      residente_concelho: true,
      inquilino: true,
      idade: 35,
    };
    // 2000 € / 4 pessoas = 500 € por pessoa: dentro do limite da renda (700 €).
    expect(
      avaliarApoio(apoio('apoio_renda'), {
        ...base,
        rendimento_mensal_agregado: 2000,
        pessoas_agregado: 4,
      }).resultado,
    ).toBe('tem_direito');
    // 2000 € / 2 = 1000 €: passa o limite, e diz porquê.
    const nao = avaliarApoio(apoio('apoio_renda'), {
      ...base,
      rendimento_mensal_agregado: 2000,
      pessoas_agregado: 2,
    });
    expect(nao.resultado).toBe('nao');
    expect(nao.porque.join(' ')).toMatch(/passa o limite de 700/);
  });

  it('sabe o rendimento mas não quantas pessoas: "talvez", falta saber o agregado', () => {
    const a = avaliarApoio(apoio('tarifa_social_agua'), {
      residente_concelho: true,
      rendimento_mensal_agregado: 800,
    });
    expect(a).toMatchObject({
      resultado: 'talvez',
      falta: ['pessoas_agregado'],
    });
  });

  it('um "não" decide logo, mesmo com outras coisas por saber', () => {
    const a = avaliarApoio(apoio('apoio_renda'), {
      inquilino: false,
    });
    expect(a.resultado).toBe('nao');
    expect(a.porque).toEqual(['É só para quem vive em casa arrendada.']);
    expect(a.falta).toEqual([]);
  });

  it('cheque bebé: bebé com menos de 1 ano (idade 0)', () => {
    const c = apoio('cheque_bebe');
    expect(
      avaliarApoio(c, { residente_concelho: true, filhos_idades: [4, 0] })
        .resultado,
    ).toBe('tem_direito');
    const nao = avaliarApoio(c, {
      residente_concelho: true,
      filhos_idades: [3],
    });
    expect(nao.resultado).toBe('nao');
    expect(nao.porque[0]).toContain('menos de 1 ano');
    expect(
      avaliarApoio(c, { residente_concelho: true, filhos_idades: [] })
        .porque[0],
    ).toContain('não tem filhos a cargo');
  });

  it('material escolar: filho entre os 6 e os 10 e rendimento baixo', () => {
    const m = apoio('material_escolar');
    const p: Perfil = {
      residente_concelho: true,
      filhos_idades: [8],
      pessoas_agregado: 3,
      rendimento_mensal_agregado: 1500,
    };
    expect(avaliarApoio(m, p).resultado).toBe('tem_direito');
    expect(avaliarApoio(m, { ...p, filhos_idades: [12] }).resultado).toBe(
      'nao',
    );
  });

  it('quem não mora no concelho não tem direito a nenhum', () => {
    const a = avaliarApoios({ residente_concelho: false }, APOIOS_DEMONSTRACAO);
    expect(a.nao).toHaveLength(APOIOS_DEMONSTRACAO.length);
    expect(a.nao[0].porque).toEqual(['É só para quem mora no concelho.']);
    expect(a.falta_saber).toEqual([]);
  });

  it('só pergunta o que ainda decide algum apoio', () => {
    // Já se sabe que tem 30 anos e não tem filhos: o cartão do idoso, o
    // cheque bebé e o material escolar estão decididos (não).
    const a = avaliarApoios(
      { residente_concelho: true, idade: 30, filhos_idades: [] },
      APOIOS_DEMONSTRACAO,
    );
    expect(codigos(a.nao)).toEqual([
      'cartao_idoso',
      'cheque_bebe',
      'material_escolar',
    ]);
    expect(a.falta_saber.map((f) => f.campo)).toEqual([
      'pessoas_agregado',
      'rendimento_mensal_agregado',
      'inquilino',
    ]);
    expect(a.falta_saber[0].pergunta).toMatch(/Quantas pessoas/);
  });

  it('apoio sem critérios: tem direito, com uma frase a explicar', () => {
    const a = avaliarApoio(
      {
        codigo: 'x',
        nome: 'X',
        criterios: esquemaCriterios.parse({ residente_concelho: false }),
      },
      {},
    );
    expect(a.resultado).toBe('tem_direito');
    expect(a.porque).toHaveLength(1);
  });

  it('idade máxima e intervalos', () => {
    const jovem = {
      codigo: 'jovem',
      nome: 'Apoio jovem',
      criterios: esquemaCriterios.parse({
        idade_min: 18,
        idade_max: 35,
        residente_concelho: false,
      }),
    };
    expect(avaliarApoio(jovem, { idade: 40 })).toMatchObject({
      resultado: 'nao',
      porque: ['É entre os 18 e os 35 anos e tem 40.'],
    });
    expect(avaliarApoio(jovem, { idade: 20 }).resultado).toBe('tem_direito');
  });
});

describe('o que se guarda', () => {
  it('guarda o escalão do rendimento por pessoa, não o valor', () => {
    expect(escalaoRendimento(1200, 3)).toBe('300_500');
    expect(escalaoRendimento(300, 1)).toBe('ate_300');
    expect(escalaoRendimento(5000, 2)).toBe('mais_1000');
    expect(escalaoRendimento(900, null)).toBeNull();
    const g = perfilGuardado({
      idade: 50,
      pessoas_agregado: 2,
      rendimento_mensal_agregado: 1234,
    });
    expect(g).toMatchObject({
      rendimento_escalao: '500_700',
      rendimento_dito: true,
    });
    expect(JSON.stringify(g)).not.toContain('1234');
  });

  it('junta o que disse antes ao que diz agora', () => {
    expect(
      juntarPerfis(
        { idade: 70, inquilino: false },
        { inquilino: true, pessoas_agregado: undefined },
      ),
    ).toEqual({ idade: 70, inquilino: true });
  });

  it('listaDita', () => {
    expect(listaDita(['a'])).toBe('a');
    expect(listaDita(['a', 'b', 'c'])).toBe('a, b e c');
  });
});

describe('catálogo de demonstração', () => {
  it('todos válidos e marcados como demonstração, com a fonte', () => {
    for (const a of APOIOS_DEMONSTRACAO) {
      expect(esquemaApoio.parse(a)).toEqual(a);
      expect(a.demonstracao).toBe(true);
      expect(a.fonte.titulo.length).toBeGreaterThan(5);
      expect(a.documentos.length).toBeGreaterThan(0);
    }
    expect(
      APOIOS_DEMONSTRACAO.find((a) => a.codigo === 'tarifa_social_agua')!.fonte,
    ).toMatchObject({ ambito: 'nacional' });
  });
});
