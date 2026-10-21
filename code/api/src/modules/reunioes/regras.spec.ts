import { gerarPdfAta } from './ata-pdf.js';
import {
  completarResultados,
  contarVotos,
  DadosReuniao,
  deliberacoesDaAta,
  dividirPorPontos,
  falanteDaLinha,
  fraseVotacao,
  juntarAtaIa,
  limparConsulta,
  lerFalas,
  marcaDePonto,
  montarAtaSemIa,
  resultadoDosVotos,
  verificarAta,
  verificarVotacao,
} from './regras.js';
import { esquemaConteudoAta, Membro } from './tipos.js';

const membro = (
  nome: string,
  cargo: string,
  forca_politica: string | null,
  presente = true,
): Membro => ({
  nome,
  cargo,
  forca_politica,
  presente,
  falta_justificada: !presente,
});

const REUNIAO: DadosReuniao = {
  orgao: 'camara',
  tipo: 'ordinaria',
  numero: '5/2026',
  data: '2026-03-12',
  hora: '10:00',
  local: 'Salão Nobre dos Paços do Concelho',
  ordem_do_dia: [
    {
      numero: 1,
      titulo: 'Aprovação da ata da reunião anterior',
      descricao: '',
    },
    {
      numero: 2,
      titulo: 'Parque de estacionamento do Largo do Toural',
      descricao: 'Proposta de abertura do concurso para a concessão.',
    },
    { numero: 3, titulo: 'Apoio às associações desportivas', descricao: '' },
  ],
  presencas: [
    membro('Ana Costa', 'Presidente', 'PS'),
    membro('Bruno Dias', 'Vereador', 'PS'),
    membro('Carla Faria', 'Vereadora', 'PSD'),
    membro('Duarte Gomes', 'Vereador', 'PSD'),
    membro('Eva Henriques', 'Vereadora', 'CDU', false),
  ],
};

const TRANSCRICAO = [
  'Ana Costa: Bom dia a todos. Declaro aberta a reunião.',
  'Carla Faria: Queria deixar uma nota sobre as obras na Rua de Santo António.',
  'Ana Costa: Ponto 1. Aprovação da ata da reunião anterior.',
  'Ana Costa: Quem vota a favor? Aprovada.',
  'Ana Costa: Passamos ao ponto dois, o parque de estacionamento.',
  'Bruno Dias: A proposta é abrir o concurso para a concessão do parque',
  'por um período de vinte anos.',
  'Carla Faria: Somos contra o prazo da concessão.',
  'PONTO N.º 3 – Apoio às associações desportivas',
  '[Duarte Gomes] Concordamos com os apoios.',
].join('\n');

describe('marcaDePonto', () => {
  it.each([
    ['Ponto 1. Aprovação da ata', 1],
    ['PONTO N.º 3 – Apoio', 3],
    ['Ana Costa: Ponto dois.', 2],
    ['Passamos ao ponto três da ordem do dia', 3],
    ['vamos agora para o ponto 12', 12],
    ['[Presidente] Ponto décimo', 10],
  ])('%s → %s', (linha, n) => {
    expect(marcaDePonto(linha)).toBe(n);
  });

  it.each([
    'Isto é um ponto de situação.',
    'Ponto de ordem, senhora presidente!',
    'Falamos disso no ponto seguinte.',
    'O ponto dezassete mil não existe',
  ])('não marca: %s', (linha) => {
    expect(marcaDePonto(linha)).toBeNull();
  });
});

describe('dividirPorPontos', () => {
  it('divide pelos marcadores; o que vem antes fica no período antes da ordem do dia', () => {
    const d = dividirPorPontos(TRANSCRICAO, [1, 2, 3]);
    expect(d.com_marcadores).toBe(true);
    expect(d.antes).toContain('Declaro aberta');
    expect(d.antes).toContain('Rua de Santo António');
    expect(d.pontos.get(1)).toContain('Quem vota a favor');
    expect(d.pontos.get(2)).toContain('vinte anos');
    expect(d.pontos.get(2)).not.toContain('associações');
    expect(d.pontos.get(3)).toContain('Concordamos');
    expect(d.fora_da_ordem).toEqual([]);
  });

  it('sem marcadores fica tudo antes; pontos fora da ordem do dia ficam à parte', () => {
    expect(dividirPorPontos('Só conversa.\nMais conversa.', [1]).antes).toBe(
      'Só conversa.\nMais conversa.',
    );
    const d = dividirPorPontos('Ponto 1\nA\nPonto 9\nB\nPonto 1\nC', [1]);
    expect(d.pontos.get(1)).toBe('Ponto 1\nA\nPonto 1\nC');
    expect(d.fora_da_ordem).toEqual([{ numero: 9, texto: 'Ponto 9\nB' }]);
  });
});

describe('quem fala', () => {
  it('lê "Nome: texto" e "[Nome] texto"; continua a fala nas linhas sem nome', () => {
    expect(falanteDaLinha('Ana Costa: Bom dia')).toEqual({
      falante: 'Ana Costa',
      texto: 'Bom dia',
    });
    expect(falanteDaLinha('[Duarte Gomes] Concordo')).toEqual({
      falante: 'Duarte Gomes',
      texto: 'Concordo',
    });
    expect(falanteDaLinha('Ponto 2: parque')).toBeNull();
    expect(falanteDaLinha('às 10:30 começou')).toBeNull();
    const f = lerFalas(
      'Bruno Dias: A proposta é abrir\npor vinte anos.\nCarla Faria: Contra.',
    );
    expect(f).toEqual([
      { falante: 'Bruno Dias', texto: 'A proposta é abrir por vinte anos.' },
      { falante: 'Carla Faria', texto: 'Contra.' },
    ]);
  });
});

describe('votos', () => {
  const v = (forca: string, a: number, c: number, ab: number) => ({
    forca_politica: forca,
    a_favor: a,
    contra: c,
    abstencoes: ab,
  });

  it('conta e decide o resultado', () => {
    expect(contarVotos([v('PS', 2, 0, 0), v('PSD', 0, 1, 1)])).toEqual({
      a_favor: 2,
      contra: 1,
      abstencoes: 1,
      votantes: 4,
    });
    expect(resultadoDosVotos([])).toBe('por_preencher');
    expect(resultadoDosVotos([v('PS', 0, 0, 0)])).toBe('por_preencher');
    expect(resultadoDosVotos([v('PS', 2, 0, 0), v('PSD', 2, 0, 0)])).toBe(
      'aprovada_unanimidade',
    );
    expect(resultadoDosVotos([v('PS', 2, 0, 0), v('PSD', 0, 0, 2)])).toBe(
      'aprovada_maioria',
    );
    expect(resultadoDosVotos([v('PS', 1, 0, 0), v('PSD', 0, 2, 0)])).toBe(
      'rejeitada',
    );
    expect(resultadoDosVotos([v('PS', 2, 0, 0), v('PSD', 0, 2, 0)])).toBe(
      'empate',
    );
  });

  it('escreve a frase da votação por força política', () => {
    expect(
      fraseVotacao(
        [
          v('PS', 5, 0, 0),
          v('CDS-PP', 1, 0, 0),
          v('PSD', 0, 3, 0),
          v('CDU', 0, 0, 2),
        ],
        'aprovada_maioria',
      ),
    ).toBe(
      'Aprovada por maioria, com 6 votos a favor (PS 5, CDS-PP 1), 3 votos contra (PSD 3) e 2 abstenções (CDU 2).',
    );
    expect(fraseVotacao([v('PS', 1, 0, 0)], 'aprovada_unanimidade')).toBe(
      'Aprovada por unanimidade, com 1 voto a favor (PS 1).',
    );
    expect(fraseVotacao([], 'retirada')).toBe(
      'Ponto retirado da ordem do dia.',
    );
  });

  it('avisa quando há mais votos do que membros presentes', () => {
    expect(
      verificarVotacao(
        [v('PS', 3, 0, 0), v('CDU', 1, 0, 0), v('PSD', 2, 0, 0)],
        REUNIAO.presencas.filter((m) => m.presente),
      ),
    ).toEqual([
      'PS: 3 votos para 2 membros presentes.',
      'CDU: votos de uma força sem membros presentes.',
    ]);
  });
});

describe('montarAtaSemIa', () => {
  const ata = montarAtaSemIa(REUNIAO, TRANSCRICAO);

  it('um ponto por ponto da ordem do dia, com o excerto, quem falou e a votação a zeros', () => {
    expect(esquemaConteudoAta.safeParse(ata).success).toBe(true);
    expect(ata.cabecalho).toMatchObject({
      orgao: 'camara',
      numero: '5/2026',
      presidente: 'Ana Costa',
    });
    expect(ata.cabecalho.presentes).toHaveLength(4);
    expect(ata.cabecalho.ausentes).toEqual([
      expect.objectContaining({
        nome: 'Eva Henriques',
        falta_justificada: true,
      }),
    ]);
    expect(ata.antes_da_ordem_do_dia).toContain('Rua de Santo António');
    expect(ata.pontos.map((p) => p.numero)).toEqual([1, 2, 3]);
    const p2 = ata.pontos[1];
    expect(p2.proposta).toBe(
      'Proposta de abertura do concurso para a concessão.',
    );
    expect(p2.transcricao).toContain('vinte anos');
    expect(p2.intervencoes).toEqual([
      expect.objectContaining({ membro: 'Ana Costa', forca_politica: 'PS' }),
      expect.objectContaining({
        membro: 'Bruno Dias',
        forca_politica: 'PS',
        resumo: expect.stringContaining('vinte anos') as unknown,
      }),
      expect.objectContaining({ membro: 'Carla Faria', forca_politica: 'PSD' }),
    ]);
    expect(p2.votacao).toEqual([
      { forca_politica: 'PS', a_favor: 0, contra: 0, abstencoes: 0 },
      { forca_politica: 'PSD', a_favor: 0, contra: 0, abstencoes: 0 },
    ]);
    expect(p2.resultado).toBe('por_preencher');
    expect(ata.pontos[2].intervencoes[0].membro).toBe('Duarte Gomes');
  });

  it('sem transcrição monta só a ordem do dia', () => {
    const vazia = montarAtaSemIa(REUNIAO, null);
    expect(vazia.pontos.every((p) => p.transcricao === null)).toBe(true);
    expect(vazia.notas.join(' ')).toContain('sem transcrição');
  });

  it('não se aprova sem resultados e deliberações; com votos preenchidos passa', () => {
    expect(verificarAta(ata).pendentes).toHaveLength(3);
    const preenchida = completarResultados({
      ...ata,
      pontos: ata.pontos.map((p) => ({
        ...p,
        votacao:
          p.numero === 2
            ? [
                { forca_politica: 'PS', a_favor: 2, contra: 0, abstencoes: 0 },
                { forca_politica: 'PSD', a_favor: 0, contra: 2, abstencoes: 0 },
              ]
            : [{ forca_politica: 'PS', a_favor: 2, contra: 0, abstencoes: 0 }],
        deliberacao: p.numero === 2 ? '' : `Deliberado o ponto ${p.numero}.`,
      })),
    });
    expect(preenchida.pontos.map((p) => p.resultado)).toEqual([
      'aprovada_unanimidade',
      'empate',
      'aprovada_unanimidade',
    ]);
    const v = verificarAta(preenchida);
    expect(v.pendentes).toEqual([
      'Ponto 2: empate na votação; indicar o resultado com o voto de qualidade do presidente.',
    ]);
    const decidida = {
      ...preenchida,
      pontos: preenchida.pontos.map((p) =>
        p.numero === 2
          ? {
              ...p,
              resultado: 'aprovada_maioria' as const,
              deliberacao: 'Aprovado com o voto de qualidade da presidente.',
            }
          : p,
      ),
    };
    expect(verificarAta(decidida)).toEqual({ pendentes: [], avisos: [] });
    const indice = deliberacoesDaAta(decidida);
    expect(indice).toHaveLength(3);
    expect(indice[1].texto_pesquisa).toContain('Toural');
    expect(indice[1].votacao_texto).toContain('2 votos contra (PSD 2)');
  });

  it('o PDF sai com a marca do rascunho', async () => {
    const pdf = await gerarPdfAta({
      municipio: 'Guimarães',
      conteudo: ata,
      estado: 'rascunho',
      versao: 1,
      aprovacao: null,
      url: null,
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1500);
  });
});

describe('juntarAtaIa', () => {
  it('a ordem do dia manda e o resultado conta-se pelos votos', () => {
    const ata = juntarAtaIa(
      REUNIAO,
      {
        antes_da_ordem_do_dia: 'Nota sobre obras.',
        pontos: [
          {
            numero: 2,
            resumo_discussao: 'Discutiu-se o prazo da concessão.',
            intervencoes: [
              {
                membro: 'Carla Faria',
                forca_politica: null,
                resumo: 'Contra o prazo.',
              },
            ],
            proposta: '',
            votacao: [
              { forca_politica: 'PS', a_favor: 2, contra: 0, abstencoes: 0 },
              { forca_politica: 'PSD', a_favor: 0, contra: 0, abstencoes: -1 },
            ],
            resultado: 'aprovada_unanimidade',
            deliberacao: 'A Câmara deliberou abrir o concurso.',
            declaracoes_voto: [],
          },
          {
            numero: 7,
            resumo_discussao: 'Inventado',
            intervencoes: [],
            proposta: '',
            votacao: [],
            resultado: 'sem_votacao',
            deliberacao: '',
            declaracoes_voto: [],
          },
        ],
      },
      TRANSCRICAO,
    );
    expect(ata.pontos.map((p) => p.numero)).toEqual([1, 2, 3]);
    const p2 = ata.pontos[1];
    expect(p2.titulo).toBe('Parque de estacionamento do Largo do Toural');
    expect(p2.proposta).toBe(
      'Proposta de abertura do concurso para a concessão.',
    );
    expect(p2.intervencoes[0].forca_politica).toBe('PSD');
    expect(p2.votacao[1].abstencoes).toBe(0);
    expect(p2.resultado).toBe('aprovada_unanimidade');
    expect(ata.pontos[0].resultado).toBe('por_preencher');
    expect(ata.notas.join(' ')).toContain('não encontrou o ponto 1');
  });
});

describe('limparConsulta', () => {
  it('tira as palavras que estão em todas as deliberações', () => {
    expect(
      limparConsulta(
        'A Câmara Municipal já decidiu alguma coisa sobre o parque?',
      ),
    ).toBe('A o parque');
    expect(limparConsulta('deliberações da assembleia')).toBe('da');
    expect(limparConsulta('câmara municipal')).toBe('');
  });
});
