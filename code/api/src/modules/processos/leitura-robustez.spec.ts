/*
 * Robustez da leitura de projetos (V4 #2): valores em falta, unidades,
 * digitalizados, projetos grandes e "a IA nunca aprova sozinha".
 */
import type { AnalisePdf } from './analise-pdf';
import { lerMedida, lerNumero, medicaoPlausivel } from './medidas';
import {
  declaradosDoRequerimento,
  PERFIS,
  verificacoesDoPerfil,
  ZonaComParametros,
} from './perfis-verificacao';
import { leituraDemo } from './projetos-perfis-pdf';
import { ZONAS_DEMONSTRACAO } from '../ordenamento/regras';
import {
  aConfirmar,
  conteudoLeitura,
  DocumentoLido,
  iaSemConfirmacao,
  interpretarLeitura,
  juntarVerificacoes,
  LeituraProjeto,
  leituraNaoVerificavel,
  novaVerificacao,
  pedidoLeituraProjeto,
  problemaReferencia,
  selecionarParaLeitura,
} from './verificacoes';

const pdfOk = (
  paginas: number,
  extra: Partial<AnalisePdf> = {},
): AnalisePdf => ({
  pdf: true,
  paginas,
  tem_texto: true,
  tem_imagens: false,
  encriptado: false,
  ...extra,
});

describe('unidades e números do requerimento', () => {
  it('lerNumero: à portuguesa, com milhares, sem adivinhar o ambíguo', () => {
    expect(lerNumero('1,5')).toBe(1.5);
    expect(lerNumero('1.5')).toBe(1.5);
    expect(lerNumero('165 m²')).toBe(165);
    expect(lerNumero('1 234,5 m2')).toBe(1234.5);
    expect(lerNumero('1.234,56')).toBe(1234.56);
    expect(lerNumero('1,234.56')).toBe(1234.56);
    expect(lerNumero('1.234.567')).toBe(1234567);
    expect(lerNumero('1.500')).toBeNull(); // mil e quinhentos ou um e meio?
    expect(lerNumero('55%')).toBeNull();
    expect(lerNumero('cerca de 3')).toBeNull();
    expect(lerNumero(7)).toBe(7);
    expect(lerNumero(Number.NaN)).toBeNull();
  });

  it('lerMedida converte para a unidade da grandeza e rejeita a errada', () => {
    expect(lerMedida('altura_muro_m', '150 cm')).toBe(1.5);
    expect(lerMedida('altura_muro_m', '1250 mm')).toBe(1.25);
    expect(lerMedida('altura_muro_m', '1,5 metros')).toBe(1.5);
    expect(lerMedida('area_lote_m2', '0,05 ha')).toBe(500);
    expect(lerMedida('afastamento_extremas_m', '3 m²')).toBeNull();
    expect(lerMedida('area_implantacao_m2', '165 m')).toBeNull();
    expect(lerMedida('pisos', '2,5')).toBeNull(); // pisos são inteiros
    expect(lerMedida('cercea_m', '50%')).toBeNull();
    expect(lerMedida('altura_muro_m', '15 m')).toBeNull(); // fora do plausível
  });

  it('o requerimento com unidades: o que não se percebe fica de fora (por verificar)', () => {
    const d = declaradosDoRequerimento({
      altura_muro_m: '150 cm',
      area_lote_m2: '0,03 ha',
      afastamento_extremas_m: '3 m²',
      pisos: '2',
      cercea_m: 'igual à existente',
    });
    expect(d.valores).toEqual({
      altura_muro_m: 1.5,
      area_lote_m2: 300,
      pisos: 2,
    });
  });

  it('a IA pode ler em cm, mm ou ha; percentagens não são medidas', () => {
    expect(medicaoPlausivel('cercea_m', 680, 'cm')).toEqual({
      ok: true,
      valor: 6.8,
    });
    expect(medicaoPlausivel('afastamento_extremas_m', 3500, 'mm')).toEqual({
      ok: true,
      valor: 3.5,
    });
    expect(medicaoPlausivel('area_lote_m2', 0.045, 'ha')).toEqual({
      ok: true,
      valor: 450,
    });
    expect(medicaoPlausivel('area_obra_m2', 45, 'm')).toMatchObject({
      ok: false,
    });
  });
});

describe('referências e valores em falta', () => {
  const docs: DocumentoLido[] = [
    { id: 'p', nome: 'Projeto de arquitetura', paginas: 3 },
    { id: 't', nome: 'Termo de responsabilidade', paginas: 1 },
  ];

  it('problemaReferencia: sem folha, documento ou página que não existe', () => {
    expect(problemaReferencia(null, docs)).toMatch(/sem indicação/);
    expect(
      problemaReferencia({ documento: 3, pagina: 1, folha: null }, docs),
    ).toMatch(/documento 3/);
    expect(
      problemaReferencia({ documento: 1, pagina: 7, folha: '7' }, docs),
    ).toMatch(/página 7 .* só tem 3/);
    expect(
      problemaReferencia({ documento: 1, pagina: 2, folha: '2' }, docs),
    ).toBeNull();
    // Sem contagem de páginas não se rejeita.
    expect(
      problemaReferencia({ documento: 1, pagina: 9, folha: null }, [
        { id: 'x', nome: 'X' },
      ]),
    ).toBeNull();
  });

  it('um número com uma página que não existe é posto de parte (nunca entra na comparação)', () => {
    const l: LeituraProjeto = {
      ...leituraDemo('muro'),
      medicoes: [
        {
          grandeza: 'altura_muro_m',
          valor: 1.5,
          unidade: 'm',
          referencia: { documento: 1, pagina: 9, folha: '9' },
        },
      ],
    };
    const r = interpretarLeitura(l, docs, {
      paredes: false,
      com_medidas: true,
    });
    expect(r.medicoes).toEqual([]);
    expect(r.descartadas?.[0]).toMatch(
      /Altura do muro: a IA leu 1,5, mas indica a página 9/,
    );
    // Evidências com página inexistente ficam sem página (não abrem no sítio errado).
    const f = interpretarLeitura(
      {
        ...l,
        medicoes: [],
        fachada_cobertura: {
          ...l.fachada_cobertura,
          referencia: { documento: 1, pagina: 8, folha: null },
        },
      },
      docs,
    );
    expect(f.antes[0].evidencias[0]).toMatchObject({
      documento_id: 'p',
      pagina: null,
    });
  });

  it('a IA não leu um valor: fica "por verificar" ou compara-se só o declarado; nunca se inventa', () => {
    const l: LeituraProjeto = { ...leituraDemo('muro'), medicoes: [] };
    const leitura = interpretarLeitura(l, docs, {
      paredes: false,
      com_medidas: true,
    });
    const v = verificacoesDoPerfil({
      perfil: 'muro',
      ponto: [41.434, -8.285],
      zonas: ZONAS_DEMONSTRACAO.map((z) => ({ ...z, demonstracao: true })),
      documentos: [],
      declarados: declaradosDoRequerimento({
        altura_muro_m: '1,5 m',
        confronta_via: 'sim',
      }),
      leitura,
    });
    const altura = v.pdm.find((x) => x.codigo === 'pdm_altura_muro_m')!;
    expect(altura.valor?.lido).toBeNull();
    expect(altura.notas).toContain(
      'A IA não encontrou este valor nos desenhos.',
    );
    const semNada = verificacoesDoPerfil({
      perfil: 'muro',
      ponto: [41.434, -8.285],
      zonas: ZONAS_DEMONSTRACAO.map((z) => ({ ...z, demonstracao: true })),
      documentos: [],
      declarados: declaradosDoRequerimento({}),
      leitura,
    });
    expect(
      semNada.pdm.find((x) => x.codigo === 'pdm_altura_muro_m')?.estado,
    ).toBe('nao_verificavel');
  });
});

describe('digitalizados e projetos grandes', () => {
  it('um documento digitalizado acrescenta um aviso "a confirmar"', () => {
    const docs: DocumentoLido[] = [
      {
        id: 'p',
        nome: 'Projeto de arquitetura',
        paginas: 2,
        digitalizado: true,
      },
      { id: 't', nome: 'Termo de responsabilidade', paginas: 1 },
    ];
    const r = interpretarLeitura(leituraDemo('muro'), docs, { paredes: false });
    const d = r.depois.find((x) => x.codigo === 'ia_digitalizado')!;
    expect(d).toMatchObject({
      estado: 'atencao',
      origem: 'ia',
      a_confirmar: true,
      detalhe:
        'Projeto de arquitetura não tem texto: a IA leu a imagem das folhas.',
    });
    // Sem leitura (ilegível) não há aviso: fica tudo por fazer.
    const ilegivel = interpretarLeitura(
      {
        ...leituraDemo('muro'),
        legivel: false,
        motivo_ilegivel: 'Folhas em branco.',
      },
      docs,
    );
    expect(ilegivel.depois.map((x) => x.codigo)).toEqual(['ia_leitura']);
    expect(ilegivel.depois[0].estado).toBe('nao_verificavel');
  });

  it('selecionarParaLeitura: limite de páginas, cifrados, não-PDF e bytes', () => {
    const c = (
      nome: string,
      analise: AnalisePdf | null,
      tamanho = 1000,
      mime = 'application/pdf',
    ) => ({
      item: nome,
      nome,
      mime,
      tamanho,
      analise,
    });
    const s = selecionarParaLeitura(
      [
        c('Projeto de arquitetura', pdfOk(60)),
        c('Projeto de estabilidade', pdfOk(70)),
        c('Memória', pdfOk(30, { tem_texto: false, tem_imagens: true })),
        c('Planta cifrada', pdfOk(2, { encriptado: true })),
        c('Planta estragada', { ...pdfOk(1), pdf: false }),
        c('Fotografia', null, 500, 'image/jpeg'),
        c('Peças enormes', pdfOk(5), 50_000_000),
        c('Termo de responsabilidade', pdfOk(1)),
      ],
      { bytes: 20 * 1024 * 1024, paginas: 100 },
    );
    expect(s.usados).toEqual([
      { item: 'Projeto de arquitetura', paginas: 60, digitalizado: false },
      { item: 'Memória', paginas: 30, digitalizado: true },
      { item: 'Fotografia', paginas: 1, digitalizado: true },
      { item: 'Termo de responsabilidade', paginas: 1, digitalizado: false },
    ]);
    expect(s.por_ler).toEqual([
      'Projeto de estabilidade (70 páginas: passa o limite de 100 páginas por leitura)',
      'Planta cifrada (protegido por palavra-passe)',
      'Planta estragada (não é um PDF que se abra)',
      'Peças enormes (grande demais)',
    ]);
  });

  it('um PDF sem contagem de páginas conta pelo tamanho', () => {
    const s = selecionarParaLeitura(
      [
        {
          item: 'x',
          nome: 'X',
          mime: 'application/pdf',
          tamanho: 15_000_000,
          analise: pdfOk(0, { paginas: null }),
        },
      ],
      { bytes: 20 * 1024 * 1024, paginas: 100 },
    );
    expect(s.por_ler[0]).toMatch(/150 páginas/);
  });

  it('o pedido diz as páginas, os digitalizados e o que ficou de fora', () => {
    const c = conteudoLeitura({
      tipo: 'Comunicação prévia',
      assunto: 'Piscina',
      descricao: '',
      documentos: [
        {
          nome: 'Projeto de arquitetura',
          mime: 'application/pdf',
          paginas: 3,
          digitalizado: true,
        },
        {
          nome: 'Termo de responsabilidade',
          mime: 'application/pdf',
          paginas: 1,
        },
        { nome: 'Fotografia', mime: 'image/jpeg' },
      ],
      por_ler: [
        'Projeto de estabilidade (140 páginas: passa o limite de 100 páginas por leitura)',
      ],
    });
    expect(c).toContain(
      '1. Projeto de arquitetura (PDF, 3 páginas, digitalizado, sem texto: só os números que se leem com certeza)',
    );
    expect(c).toContain('2. Termo de responsabilidade (PDF, 1 página)');
    expect(c).toContain('3. Fotografia (imagem)');
    expect(c).toContain(
      'Ficaram de fora (não os tens): Projeto de estabilidade (140 páginas',
    );
    const p = pedidoLeituraProjeto({
      tipo: 't',
      assunto: 'a',
      descricao: '',
      ficheiros: [
        {
          nome: 'P',
          ficheiro: Buffer.from('x'),
          mime: 'application/pdf',
          paginas: 2,
        },
      ],
      perfil: null,
    });
    expect(p.maxTokens).toBe(16000);
    expect(p.ficheiros).toEqual([
      { nome: 'P', ficheiro: Buffer.from('x'), mime: 'application/pdf' },
    ]);
    expect(p.sistema).toContain(
      'Um número só entra em "medicoes" com a referência',
    );
  });
});

describe('a IA nunca aprova sozinha', () => {
  const zonas: ZonaComParametros[] = ZONAS_DEMONSTRACAO.map((z) => ({
    ...z,
    demonstracao: true,
  }));
  const docs: DocumentoLido[] = [
    {
      id: 'p',
      nome: 'Projeto de arquitetura',
      paginas: 3,
      digitalizado: false,
    },
    { id: 'e', nome: 'Projeto de estabilidade', paginas: 1 },
    { id: 't', nome: 'Termo de responsabilidade', paginas: 1 },
  ];
  const base = leituraDemo('ampliacao');
  const regra = (codigo: string) =>
    novaVerificacao({
      codigo,
      origem: 'regra',
      estado: 'ok',
      titulo: codigo,
      detalhe: '',
    });

  it('todas as combinações de respostas da IA ficam "a confirmar"', () => {
    let vistas = 0;
    for (const perfil of PERFIS) {
      for (const fachada of ['nao', 'sim', 'incerto'] as const) {
        for (const paredes of ['nao', 'sim', 'incerto'] as const) {
          for (const estruturas of [true, false]) {
            for (const resposta of ['sim', 'nao', 'incerto'] as const) {
              for (const declarar of [false, true]) {
                const l: LeituraProjeto = {
                  ...base,
                  fachada_cobertura: {
                    ...base.fachada_cobertura,
                    alteracoes: fachada,
                  },
                  paredes: { ...base.paredes, abertura_ou_demolicao: paredes },
                  planta_estruturas: {
                    ...base.planta_estruturas,
                    existe: estruturas,
                  },
                  areas_cerceas: {
                    ...base.areas_cerceas,
                    coerentes: resposta === 'sim' ? 'sim' : 'nao',
                  },
                  elementos: (
                    [
                      'casa_maquinas',
                      'confronta_via',
                      'materiais_cores',
                      'plano_demolicao',
                      'amianto',
                      'acessibilidades',
                    ] as const
                  ).map((elemento) => ({
                    elemento,
                    resposta,
                    descricao: 'x',
                    referencia: null,
                  })),
                };
                const leitura = interpretarLeitura(l, docs, {});
                const extra = verificacoesDoPerfil({
                  perfil,
                  ponto: [41.436, -8.308],
                  zonas,
                  documentos: [],
                  declarados: declaradosDoRequerimento(
                    declarar
                      ? {
                          area_lote_m2: 300,
                          area_implantacao_m2: 140,
                          pisos: 2,
                          altura_muro_m: 1.4,
                          lugares_estacionamento: 2,
                        }
                      : {},
                  ),
                  leitura,
                });
                const todas = juntarVerificacoes({
                  leitura,
                  instrucao: regra('instrucao'),
                  termo: regra('termo'),
                  ordem: regra('ordem'),
                  pdm: regra('pdm'),
                  documentos_perfil: extra.documentos,
                  pdm_perfil: extra.pdm,
                  desenhos_perfil: extra.desenhos,
                });
                expect(iaSemConfirmacao(todas)).toEqual([]);
                // Há sempre alguma coisa da IA para o técnico confirmar.
                expect(aConfirmar(todas)).toBeGreaterThan(0);
                vistas += todas.length;
              }
            }
          }
        }
      }
    }
    expect(vistas).toBeGreaterThan(1000);
  });

  it('iaSemConfirmacao apanha uma verificação da IA sem "a confirmar"', () => {
    const ma = novaVerificacao({
      codigo: 'x',
      origem: 'ia',
      estado: 'ok',
      titulo: '',
      detalhe: '',
      a_confirmar: false,
    });
    expect(iaSemConfirmacao([ma])).toHaveLength(1);
    // Uma linha "por fazer" da IA não tem nada para confirmar.
    expect(iaSemConfirmacao([leituraNaoVerificavel('Sem IA.')])).toEqual([]);
  });
});
