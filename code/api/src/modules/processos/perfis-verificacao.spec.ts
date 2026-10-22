/* eslint-disable @typescript-eslint/no-unsafe-assignment -- os expect.objectContaining/stringContaining são `any`. */
import { ZONAS_DEMONSTRACAO } from '../ordenamento/regras.js';
import {
  compararValor,
  lerNumero,
  medicaoPlausivel,
  valorDito,
} from './medidas.js';
import {
  declaradosDoRequerimento,
  DEFINICOES,
  escolherPerfil,
  infoPerfil,
  medidasParaPdm,
  parametrosDaZona,
  PARAMETROS_DEMONSTRACAO,
  Perfil,
  perfilDaOperacao,
  PERFIS,
  permitidoPara,
  prontoParaDecisao,
  verificacoesDoPerfil,
  verificarClasseEspaco,
  verificarDocumentosPerfil,
  verificarElementos,
  verificarMedidas,
  ZonaComParametros,
} from './perfis-verificacao.js';
import {
  ficheiroProjetoPerfil,
  leituraDemo,
  PROCESSOS_PERFIS,
} from './projetos-perfis-pdf.js';
import {
  conteudoLeitura,
  DocumentoLido,
  interpretarLeitura,
  juntarVerificacoes,
  Verificacao,
  verificarPdm,
  ZonaParaVerificar,
} from './verificacoes.js';

const ZONAS: (ZonaComParametros & ZonaParaVerificar)[] = ZONAS_DEMONSTRACAO.map(
  (z) => ({
    ...z,
    demonstracao: true,
    parametros: null,
  }),
);
const ERC = ZONAS.find((z) => z.codigo === 'ERC')!;
const CH = ZONAS.find((z) => z.codigo === 'CH')!;
const EM_ERC: [number, number] = [41.437, -8.305];
const EM_CH: [number, number] = [41.443, -8.295];
const CP = { codigo: 'CP', nome: 'Comunicação prévia · obras de alteração' };

const decl = (dados: Record<string, unknown>) =>
  declaradosDoRequerimento(dados);
const porCodigo = (vs: Verificacao[]) =>
  Object.fromEntries(vs.map((x) => [x.codigo, x]));

describe('valores lidos × declarados × permitidos', () => {
  it('lê números do requerimento em português', () => {
    expect(lerNumero(1.5)).toBe(1.5);
    expect(lerNumero('1,5')).toBe(1.5);
    expect(lerNumero('1,5 m')).toBe(1.5);
    expect(lerNumero('165 m²')).toBe(165);
    expect(lerNumero('2 pisos')).toBe(2);
    expect(lerNumero('muito')).toBeNull();
    expect(lerNumero(Number.NaN)).toBeNull();
    expect(valorDito('area_implantacao_m2', 150)).toBe('150 m²');
    expect(valorDito('pisos', 1)).toBe('1 piso');
  });

  it('plausibilidade do que a IA lê: unidade, intervalo e inteiros', () => {
    expect(medicaoPlausivel('afastamento_extremas_m', 150, 'cm')).toEqual({
      ok: true,
      valor: 1.5,
    });
    expect(medicaoPlausivel('area_implantacao_m2', 165, 'm')).toMatchObject({
      ok: false,
    });
    expect(medicaoPlausivel('altura_muro_m', 15, 'm')).toMatchObject({
      ok: false,
      motivo: expect.stringContaining('não é plausível'),
    });
    expect(medicaoPlausivel('pisos', 2.5, 'pisos')).toMatchObject({
      ok: false,
      motivo: expect.stringContaining('inteiro'),
    });
    expect(medicaoPlausivel('pisos', 2, 'pisos')).toEqual({
      ok: true,
      valor: 2,
    });
  });

  const max150 = { valor: 150, sentido: 'max' as const, origem: 'Índice.' };
  const min3 = { valor: 3, sentido: 'min' as const, origem: 'Mínimo.' };

  it('ok: declarado e desenhado cumprem e batem certo', () => {
    const c = compararValor('area_implantacao_m2', {
      lido: 140,
      declarado: 140,
      permitido: max150,
      ia_leu: true,
    });
    expect(c).toMatchObject({
      estado: 'ok',
      origem: 'regra',
      a_confirmar: false,
    });
    expect(c.detalhe).toBe(
      'Declarado 140 m² · desenhado 140 m² · máximo 150 m²',
    );
    expect(c.notas[0]).toMatch(/Confirmado nos desenhos/);
  });

  it('falha pelo declarado (regra) e pelo desenhado (IA, a confirmar)', () => {
    expect(
      compararValor('area_implantacao_m2', {
        lido: 165,
        declarado: 165,
        permitido: max150,
      }),
    ).toMatchObject({ estado: 'falha', origem: 'regra', a_confirmar: false });
    const ia = compararValor('afastamento_extremas_m', {
      lido: 1.5,
      declarado: 3,
      permitido: min3,
    });
    expect(ia).toMatchObject({
      estado: 'falha',
      origem: 'ia',
      a_confirmar: true,
    });
    expect(ia.notas[0]).toMatch(/fica abaixo do mínimo 3 m: a confirmar/);
  });

  it('atenção quando desenhado e declarado diferem (com tolerância)', () => {
    expect(
      compararValor('area_construcao_m2', {
        lido: 236,
        declarado: 230,
        permitido: { valor: 240, sentido: 'max', origem: '' },
      }),
    ).toMatchObject({ estado: 'atencao', origem: 'ia', a_confirmar: true });
    // 2 %: 230 vs 233 ainda bate certo.
    expect(
      compararValor('area_construcao_m2', {
        lido: 233,
        declarado: 230,
        permitido: { valor: 240, sentido: 'max', origem: '' },
      }).estado,
    ).toBe('ok');
    expect(
      compararValor('altura_muro_m', {
        lido: 1.6,
        declarado: 1.5,
        permitido: null,
      }).estado,
    ).toBe('atencao');
  });

  it('sem nada para comparar: não verificável', () => {
    expect(
      compararValor('pisos', { lido: null, declarado: null, permitido: null })
        .estado,
    ).toBe('nao_verificavel');
    const so = compararValor('pisos', {
      lido: null,
      declarado: 2,
      permitido: null,
    });
    expect(so.estado).toBe('nao_verificavel');
    expect(so.detalhe).toMatch(/sem limite a comparar/);
    // Sem limite, desenhado e declarado iguais: ok (da IA).
    expect(
      compararValor('area_obra_m2', {
        lido: 45,
        declarado: 45,
        permitido: null,
      }),
    ).toMatchObject({ estado: 'ok', origem: 'ia', a_confirmar: true });
    // Só o desenhado, dentro do limite: ok a confirmar.
    expect(
      compararValor('pisos', {
        lido: 2,
        declarado: null,
        permitido: { valor: 2, sentido: 'max', origem: '' },
      }),
    ).toMatchObject({ estado: 'ok', origem: 'ia', a_confirmar: true });
  });
});

describe('escolha do perfil', () => {
  it('o técnico manda; depois o requerimento; depois o tipo; depois o texto', () => {
    const base = { tipo: CP, assunto: 'Piscina', descricao: '' };
    expect(escolherPerfil({ ...base, escolhido: 'muro' })).toMatchObject({
      perfil: 'muro',
      escolhido_por: 'tecnico',
      ambiguo: false,
    });
    expect(
      escolherPerfil({ ...base, operacao_declarada: 'Muro de vedação' }),
    ).toMatchObject({ perfil: 'muro', escolhido_por: 'requerimento' });
    expect(
      escolherPerfil({
        tipo: { codigo: 'LP', nome: 'Licença · piscina' },
        assunto: 'Obra no quintal',
        descricao: '',
      }),
    ).toMatchObject({ perfil: 'piscina', escolhido_por: 'tipo' });
    expect(escolherPerfil(base)).toMatchObject({
      perfil: 'piscina',
      escolhido_por: 'texto',
      ambiguo: false,
    });
  });

  it('a porta na cozinha é alteração interior (o tipo genérico não conta)', () => {
    expect(
      escolherPerfil({
        tipo: CP,
        assunto: 'Porta na cozinha',
        descricao:
          'Abertura de um vão de porta em parede interior, entre a cozinha e a sala, e remodelação da cozinha, numa moradia unifamiliar.',
      }),
    ).toMatchObject({ perfil: 'interior', ambiguo: false });
  });

  it('ambíguo: fica a operação maior e o técnico confirma; sem pistas, nenhum', () => {
    const r = escolherPerfil({
      tipo: CP,
      assunto: 'Anexo e muro',
      descricao: 'Construir um anexo de arrumos e um muro de vedação.',
    });
    expect(r).toMatchObject({ perfil: 'muro', ambiguo: true });
    expect(r.candidatos).toEqual(['muro', 'ampliacao']);
    expect(
      escolherPerfil({ tipo: CP, assunto: 'Obras', descricao: '' }),
    ).toMatchObject({ perfil: null, ambiguo: true, candidatos: [] });
  });

  it('operação declarada: códigos, sinónimos e texto', () => {
    expect(perfilDaOperacao('ampliacao')).toBe('ampliacao');
    expect(perfilDaOperacao('Mudança de uso')).toBe('mudanca_uso');
    expect(perfilDaOperacao('alojamento local')).toBe('mudanca_uso');
    expect(perfilDaOperacao('anexo')).toBe('ampliacao');
    expect(perfilDaOperacao('Demolição total do armazém')).toBe('demolicao');
    expect(perfilDaOperacao('qualquer coisa')).toBeNull();
    expect(perfilDaOperacao(null)).toBeNull();
  });

  it('infoPerfil diz o que fica sempre para o técnico e as opções', () => {
    const i = infoPerfil(
      escolherPerfil({ tipo: CP, assunto: 'Piscina', descricao: '' }),
    );
    expect(i.nome).toBe('Piscina');
    expect(i.opcoes).toHaveLength(PERFIS.length);
    expect(i.sempre_tecnico.length).toBeGreaterThan(1);
  });
});

describe('requerimento: valores declarados', () => {
  it('lê os campos com o código da grandeza; o implausível fica de fora', () => {
    const d = decl({
      operacao: 'piscina',
      area_obra_m2: '32',
      afastamento_extremas_m: '3,0 m',
      pisos: 'dois',
      altura_muro_m: 40,
      uso_atual: 'Habitação',
      uso_proposto: 'Alojamento local',
      confronta_via: 'sim',
    });
    expect(d.valores).toEqual({ area_obra_m2: 32, afastamento_extremas_m: 3 });
    expect(d).toMatchObject({
      operacao: 'piscina',
      uso_atual: 'habitacao',
      uso_proposto: 'alojamento_local',
      confronta_via: true,
    });
    expect(decl(null as unknown as Record<string, unknown>).valores).toEqual(
      {},
    );
  });

  it('medidas para os degraus do PDM: área da obra e altura do muro', () => {
    expect(medidasParaPdm('muro', decl({ altura_muro_m: 1.5 }))).toEqual({
      altura_m: 1.5,
    });
    expect(medidasParaPdm('piscina', decl({ area_obra_m2: 32 }))).toEqual({
      area_m2: 32,
    });
    expect(medidasParaPdm(null, decl({ area_obra_m2: 32 }))).toEqual({});
  });
});

describe('parâmetros das zonas', () => {
  it('os carregados pela câmara ganham aos de demonstração', () => {
    expect(parametrosDaZona(ERC)).toEqual({
      p: PARAMETROS_DEMONSTRACAO.ERC,
      demonstracao: true,
    });
    expect(
      parametrosDaZona({
        codigo: 'ERC',
        demonstracao: false,
        parametros: { pisos_max: 3 },
      }),
    ).toEqual({ p: { pisos_max: 3 }, demonstracao: false });
    expect(
      parametrosDaZona({ codigo: 'X', demonstracao: false, parametros: null }),
    ).toBeNull();
  });

  const p = PARAMETROS_DEMONSTRACAO.ERC;
  const base = {
    p,
    regras: ERC.regras,
    area_lote: 300,
    confronta_via: null,
    uso_proposto: null,
  };

  it('índices × lote, pisos, cércea, afastamentos, muros, estacionamento', () => {
    expect(
      permitidoPara('area_implantacao_m2', { ...base, perfil: 'ampliacao' }),
    ).toMatchObject({ valor: 150, sentido: 'max' });
    expect(
      permitidoPara('area_construcao_m2', { ...base, perfil: 'ampliacao' }),
    ).toMatchObject({ valor: 240 });
    expect(
      permitidoPara('area_implantacao_m2', {
        ...base,
        perfil: 'ampliacao',
        area_lote: null,
      }),
    ).toBeNull();
    expect(
      permitidoPara('pisos', { ...base, perfil: 'ampliacao' }),
    ).toMatchObject({ valor: 2 });
    expect(
      permitidoPara('afastamento_extremas_m', { ...base, perfil: 'piscina' }),
    ).toMatchObject({ valor: 3, sentido: 'min' });
    expect(
      permitidoPara('altura_muro_m', {
        ...base,
        perfil: 'muro',
        confronta_via: false,
      }),
    ).toMatchObject({ valor: 2 });
    expect(
      permitidoPara('altura_muro_m', {
        ...base,
        perfil: 'muro',
        confronta_via: true,
      }),
    ).toMatchObject({ valor: 1.5 });
    expect(
      permitidoPara('lugares_estacionamento', {
        ...base,
        perfil: 'mudanca_uso',
        uso_proposto: 'restauracao',
      }),
    ).toMatchObject({ valor: 2, sentido: 'min' });
    // Anexo em espaço agrícola: acima de 20 m² não é permitido → área máxima.
    const ea = ZONAS.find((z) => z.codigo === 'EA')!;
    expect(
      permitidoPara('area_obra_m2', {
        ...base,
        p: PARAMETROS_DEMONSTRACAO.EA,
        regras: ea.regras,
        perfil: 'ampliacao',
      }),
    ).toBeNull(); // a ampliação em EA é "licença", sem máximo
  });
});

describe('perfis: documentos, PDM, desenhos', () => {
  it('cada perfil tem documentos, o que procurar e o que é sempre do técnico', () => {
    for (const p of PERFIS) {
      const d = DEFINICOES[p];
      expect(d.codigo).toBe(p);
      expect(d.documentos.some((x) => x.obrigatorio)).toBe(true);
      expect(d.procurar.length).toBeGreaterThan(0);
      expect(d.sempre_tecnico.length).toBeGreaterThan(1);
    }
  });

  it('documentos esperados: ok, falta o recomendado (atenção), falta obrigatório (falha)', () => {
    const tudo = [
      'Certidão do registo predial',
      'Termo de responsabilidade',
      'Projeto de arquitetura',
      'Planta de localização',
      'Projeto de estabilidade',
    ].map((nome, i) => ({ id: `d${i}`, nome }));
    const ok = verificarDocumentosPerfil('piscina', tudo);
    expect(ok).toMatchObject({
      estado: 'ok',
      grupo: 'documentos',
      demonstracao: true,
    });
    expect(ok.evidencias.filter((e) => e.tipo === 'documento')).toHaveLength(5);
    const semEst = verificarDocumentosPerfil(
      'piscina',
      tudo.filter((x) => !/estabilidade/.test(x.nome)),
    );
    expect(semEst).toMatchObject({ estado: 'atencao' });
    expect(semEst.detalhe).toBe('Projeto de estabilidade.');
    const demol = verificarDocumentosPerfil('demolicao', tudo);
    expect(demol.estado).toBe('falha');
    expect(demol.detalhe).toContain('Plano de demolição');
    expect(demol.detalhe).toContain('resíduos');
  });

  it('classe de espaço: uso admitido, não admitido, por saber', () => {
    const erc = { zona: ERC, parametros: parametrosDaZona(ERC) };
    expect(
      verificarClasseEspaco({
        perfil: 'mudanca_uso',
        ...erc,
        declarados: decl({
          uso_atual: 'habitacao',
          uso_proposto: 'alojamento local',
        }),
      }),
    ).toMatchObject({
      estado: 'ok',
      detalhe:
        'Habitação → alojamento local: admitido em Espaço residencial consolidado.',
    });
    const ea = ZONAS.find((z) => z.codigo === 'EA')!;
    expect(
      verificarClasseEspaco({
        perfil: 'mudanca_uso',
        zona: ea,
        parametros: parametrosDaZona(ea),
        declarados: decl({ uso_proposto: 'comercio' }),
      })?.estado,
    ).toBe('falha');
    expect(
      verificarClasseEspaco({
        perfil: 'mudanca_uso',
        ...erc,
        declarados: decl({}),
      })?.estado,
    ).toBe('nao_verificavel');
    // Moradia nova: habitação por omissão.
    expect(
      verificarClasseEspaco({
        perfil: 'construcao_nova',
        ...erc,
        declarados: decl({}),
      })?.estado,
    ).toBe('ok');
    expect(
      verificarClasseEspaco({
        perfil: 'piscina',
        ...erc,
        declarados: decl({}),
      }),
    ).toBeNull();
  });

  it('elementos da IA: casa das máquinas, amianto, cores no centro histórico', () => {
    const el = (
      elemento: 'casa_maquinas' | 'amianto' | 'materiais_cores',
      resposta: 'sim' | 'nao' | 'incerto',
    ) => ({
      elemento,
      resposta,
      descricao: 'x',
      evidencias: [],
    });
    expect(
      verificarElementos({
        perfil: 'piscina',
        elementos: [el('casa_maquinas', 'sim')],
        ia_leu: true,
        centro_historico: false,
      })[0],
    ).toMatchObject({
      codigo: 'ia_casa_maquinas',
      estado: 'ok',
      a_confirmar: true,
    });
    expect(
      verificarElementos({
        perfil: 'piscina',
        elementos: [el('casa_maquinas', 'nao')],
        ia_leu: true,
        centro_historico: false,
      })[0].estado,
    ).toBe('atencao');
    const demol = verificarElementos({
      perfil: 'demolicao',
      elementos: [el('amianto', 'sim')],
      ia_leu: true,
      centro_historico: false,
    });
    expect(demol.map((x) => [x.codigo, x.estado])).toEqual([
      ['ia_plano_demolicao', 'atencao'], // não respondeu
      ['ia_amianto', 'atencao'],
    ]);
    expect(demol[1].titulo).toMatch(/amianto: remoção por empresa habilitada/);
    expect(
      verificarElementos({
        perfil: 'fachada',
        elementos: [el('materiais_cores', 'sim')],
        ia_leu: true,
        centro_historico: true,
      })[0].titulo,
    ).toMatch(/carta de cores/);
    expect(
      verificarElementos({
        perfil: 'piscina',
        elementos: [],
        ia_leu: false,
        centro_historico: false,
      }),
    ).toEqual([]);
  });

  /** Para cada perfil com números: um caso que cumpre e um que falha, em ERC. */
  const casos: [Perfil, Record<string, unknown>, Record<string, unknown>][] = [
    [
      'ampliacao',
      { area_lote_m2: 300, area_implantacao_m2: 140, pisos: 2 },
      { area_lote_m2: 300, area_implantacao_m2: 165, pisos: 3 },
    ],
    [
      'construcao_nova',
      {
        area_lote_m2: 500,
        area_implantacao_m2: 200,
        area_construcao_m2: 380,
        afastamento_frente_m: 6,
        lugares_estacionamento: 2,
      },
      {
        area_lote_m2: 500,
        area_implantacao_m2: 200,
        area_construcao_m2: 420,
        afastamento_frente_m: 4,
        lugares_estacionamento: 0,
      },
    ],
    ['piscina', { afastamento_extremas_m: 3.5 }, { afastamento_extremas_m: 2 }],
    [
      'muro',
      { altura_muro_m: 1.5, confronta_via: true },
      { altura_muro_m: 1.8, confronta_via: true },
    ],
    ['fachada', { cercea_m: 6.4 }, { cercea_m: 9 }],
    [
      'mudanca_uso',
      { uso_proposto: 'restauracao', lugares_estacionamento: 2 },
      { uso_proposto: 'restauracao', lugares_estacionamento: 1 },
    ],
  ];

  it.each(casos)('%s: cumpre → ok; excede → falha', (perfil, bom, mau) => {
    const correr = (dados: Record<string, unknown>) =>
      verificarMedidas({
        perfil,
        zona: ERC,
        parametros: parametrosDaZona(ERC),
        declarados: decl(dados),
        lidas: [],
        ia_leu: false,
      }).filter((x) => x.grupo === 'pdm' && x.valor?.declarado != null);
    const ok = correr(bom);
    expect(ok.length).toBeGreaterThan(0);
    expect(ok.every((x) => x.estado === 'ok')).toBe(true);
    expect(ok.every((x) => x.demonstracao && x.valor?.permitido)).toBe(true);
    expect(correr(mau).some((x) => x.estado === 'falha')).toBe(true);
  });

  it('interior e demolição não têm números', () => {
    expect(DEFINICOES.interior.grandezas).toEqual([]);
    expect(DEFINICOES.demolicao.grandezas).toEqual([]);
  });

  it('sem zona (fora do PDM) os números ficam sem permitido', () => {
    const r = verificarMedidas({
      perfil: 'muro',
      zona: null,
      parametros: null,
      declarados: decl({ altura_muro_m: 1.5 }),
      lidas: [{ grandeza: 'altura_muro_m', valor: 1.5, evidencia: null }],
      ia_leu: true,
    });
    expect(r[0]).toMatchObject({ grupo: 'desenhos', estado: 'ok' });
  });

  it('no centro histórico a classe vem dos parâmetros e o muro tem o seu máximo', () => {
    const r = verificacoesDoPerfil({
      perfil: 'muro',
      ponto: EM_CH,
      zonas: ZONAS,
      documentos: [],
      declarados: decl({ altura_muro_m: 1.4 }),
      leitura: {},
    });
    expect(r.pdm[0]).toMatchObject({
      codigo: 'pdm_altura_muro_m',
      estado: 'ok',
    });
    expect(parametrosDaZona(CH)?.p.centro_historico).toBe(true);
  });
});

describe('leitura da IA com números e elementos', () => {
  const docs: DocumentoLido[] = [
    { id: 'p1', nome: 'Projeto de arquitetura' },
    { id: 't1', nome: 'Termo de responsabilidade' },
  ];

  it('valida os números: unidade, plausibilidade e repetidos', () => {
    const l = {
      ...leituraDemo('muro'),
      medicoes: [
        {
          grandeza: 'altura_muro_m',
          valor: 150,
          unidade: 'cm',
          referencia: { documento: 1, pagina: 2, folha: '2' },
        },
        {
          grandeza: 'altura_muro_m',
          valor: 1.8,
          unidade: 'm',
          referencia: null,
        },
        { grandeza: 'pisos', valor: 2.5, unidade: 'pisos', referencia: null },
        { grandeza: 'cercea_m', valor: 7, unidade: 'm2', referencia: null },
      ],
    };
    const r = interpretarLeitura(l, docs, { paredes: false });
    expect(r.medicoes).toEqual([
      {
        grandeza: 'altura_muro_m',
        valor: 1.5,
        evidencia: expect.objectContaining({
          documento_id: 'p1',
          pagina: 2,
          rotulo: 'Projeto de arquitetura, folha 2',
        }),
      },
    ]);
    expect(r.descartadas).toHaveLength(3);
    expect(r.lida).toBe(true);
  });

  it('número fora do esquema: a resposta inteira não serve', () => {
    const l = {
      ...leituraDemo('muro'),
      medicoes: [{ grandeza: 'altura', valor: 1 }],
    };
    const r = interpretarLeitura(l, docs);
    expect(r.depois[0].codigo).toBe('ia_leitura');
    expect(r.lida).toBe(false);
  });

  it('uma leitura guardada antes (sem medições nem elementos) ainda serve', () => {
    const { medicoes: _m, elementos: _e, ...antiga } = leituraDemo('muro');
    void _m;
    void _e;
    const r = interpretarLeitura(antiga, docs);
    expect(r.lida).toBe(true);
    expect(r.medicoes).toEqual([]);
  });

  it('a alteração da fachada é esperada na ampliação; paredes não contam no muro', () => {
    const a = interpretarLeitura(
      leituraDemo('ampliacao'),
      docs,
      DEFINICOES.ampliacao.leitura,
    );
    expect(a.antes[0]).toMatchObject({
      estado: 'ok',
      titulo: 'Alterações no exterior próprias da operação',
    });
    expect(a.depois.some((x) => x.codigo === 'ia_areas')).toBe(false);
    const sem = interpretarLeitura(leituraDemo('ampliacao'), docs);
    expect(sem.antes[0].estado).toBe('atencao');
  });

  it('o pedido à IA leva a operação, as medidas e os elementos (o sistema não muda)', () => {
    const t = conteudoLeitura({
      tipo: 'CP',
      assunto: 'Piscina',
      descricao: '',
      documentos: [{ nome: 'Projeto', mime: 'application/pdf' }],
      perfil: {
        nome: 'Piscina',
        procurar: ['A distância às extremas.'],
        grandezas: ['afastamento_extremas_m'],
        elementos: ['casa_maquinas'],
      },
    });
    expect(t).toContain('Operação a analisar: Piscina.');
    expect(t).toContain(
      'afastamento_extremas_m (afastamento às extremas (o menor))',
    );
    expect(t).toContain('casa_maquinas (');
  });
});

describe('os 3 processos de demonstração dão o resultado esperado', () => {
  const correr = (chave: 'ampliacao' | 'piscina' | 'muro') => {
    const p = PROCESSOS_PERFIS.find((x) => x.chave === chave)!;
    const perfil = escolherPerfil({
      tipo: CP,
      assunto: p.assunto,
      descricao: p.descricao,
      operacao_declarada: String(p.dados.operacao),
    }).perfil!;
    const lidos: DocumentoLido[] = [
      'Projeto de arquitetura',
      'Planta de localização',
      'Projeto de estabilidade',
      'Termo de responsabilidade',
    ].map((nome, i) => ({ id: `d${i}`, nome }));
    const leitura = interpretarLeitura(
      leituraDemo(chave),
      lidos,
      DEFINICOES[perfil].leitura,
    );
    const declarados = decl(p.dados);
    const docs = p.documentos.map((d, i) => ({ id: `x${i}`, nome: d.nome }));
    const extra = verificacoesDoPerfil({
      perfil,
      ponto: [p.lat, p.lng],
      zonas: ZONAS,
      documentos: docs,
      declarados,
      leitura,
    });
    const pdm = verificarPdm({
      ponto: [p.lat, p.lng],
      zonas: ZONAS,
      obra: DEFINICOES[perfil].obra,
      tipo: CP,
      medidas: medidasParaPdm(perfil, declarados),
    });
    const ok = (codigo: string) => ({
      codigo,
      estado: 'ok' as const,
      titulo: '',
      detalhe: '',
      evidencias: [],
      origem: 'regra' as const,
      a_confirmar: false,
      demonstracao: false,
      notas: [],
    });
    const todas = juntarVerificacoes({
      leitura,
      instrucao: ok('instrucao'),
      termo: ok('termo'),
      ordem: ok('ordem'),
      pdm,
      documentos_perfil: extra.documentos,
      pdm_perfil: extra.pdm,
      desenhos_perfil: extra.desenhos,
    });
    return { perfil, todas, v: porCodigo(todas) };
  };

  it('ampliação: a implantação excede o índice (falha); construção não bate certo (atenção)', () => {
    const { perfil, v, todas } = correr('ampliacao');
    expect(perfil).toBe('ampliacao');
    expect(v.pdm.estado).toBe('ok');
    expect(v.perfil_documentos.estado).toBe('ok');
    expect(v.pdm_area_implantacao_m2).toMatchObject({
      estado: 'falha',
      origem: 'regra',
      grupo: 'pdm',
      demonstracao: true,
      detalhe: 'Declarado 165 m² · desenhado 165 m² · máximo 150 m²',
    });
    expect(v.pdm_area_implantacao_m2.valor).toMatchObject({
      declarado: 165,
      lido: { valor: 165 },
      permitido: { valor: 150, sentido: 'max' },
    });
    expect(v.pdm_area_construcao_m2).toMatchObject({
      estado: 'atencao',
      a_confirmar: true,
    });
    expect(v.pdm_pisos.estado).toBe('ok');
    expect(v.pdm_cercea_m.estado).toBe('ok');
    expect(v.pdm_afastamento_extremas_m.estado).toBe('ok');
    expect(v.pdm_area_obra_m2).toMatchObject({
      grupo: 'desenhos',
      estado: 'ok',
    });
    expect(v.ia_contradicao_1.estado).toBe('atencao');
    expect(prontoParaDecisao(todas)).toBe(false);
  });

  it('piscina: desenhada a 1,5 m da extrema, a regra pede 3 m (falha a confirmar)', () => {
    const { v } = correr('piscina');
    expect(v.pdm.estado).toBe('ok');
    expect(v.pdm_afastamento_extremas_m).toMatchObject({
      estado: 'falha',
      origem: 'ia',
      a_confirmar: true,
      detalhe: 'Declarado 3 m · desenhado 1,5 m · mínimo 3 m',
    });
    expect(v.pdm_afastamento_extremas_m.evidencias[0]).toMatchObject({
      documento_id: 'd0',
      pagina: 2,
      folha: '2',
    });
    expect(v.ia_casa_maquinas.estado).toBe('ok');
    expect(v.ia_paredes).toBeUndefined();
  });

  it('muro: altura certa, tudo ok, pronto para decisão', () => {
    const { v, todas } = correr('muro');
    expect(v.pdm_altura_muro_m).toMatchObject({
      estado: 'ok',
      detalhe: 'Declarado 1,5 m · desenhado 1,5 m · máximo 1,5 m',
    });
    expect(v.ia_confronta_via.estado).toBe('ok');
    expect(todas.filter((x) => x.estado !== 'ok')).toEqual([]);
    expect(prontoParaDecisao(todas)).toBe(true);
    expect(new Set(todas.map((x) => x.grupo))).toEqual(
      new Set(['documentos', 'pdm', 'desenhos']),
    );
  });

  it('os PDF saem sempre iguais, com as folhas certas', async () => {
    const paginas = (b: Buffer) =>
      (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    for (const p of PROCESSOS_PERFIS) {
      for (const d of p.documentos) {
        const a = await ficheiroProjetoPerfil(d.ficheiro);
        expect(a?.subarray(0, 5).toString()).toBe('%PDF-');
        const b = await ficheiroProjetoPerfil(d.ficheiro);
        expect(a!.equals(b!)).toBe(true);
        if (d.nome === 'Projeto de arquitetura') {
          expect(paginas(a!)).toBe(p.chave === 'muro' ? 2 : 3);
        }
      }
    }
    expect(await ficheiroProjetoPerfil('demonstracao/outro.pdf')).toBeNull();
  });
});

void EM_ERC;
