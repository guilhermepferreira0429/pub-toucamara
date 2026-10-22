/*
 * A checklist para os técnicos da câmara validarem as regras da análise de
 * projetos (V4 #2), gerada a partir do código: os documentos, as medidas,
 * os limites e as perguntas à IA de cada tipo de operação, com o valor atual
 * e a fonte. `npm run checklist-regras` escreve-a em
 * `docs/VALIDAR_REGRAS_PROJETOS.md`; o teste `checklist-regras.spec.ts`
 * falha se o ficheiro ficar desatualizado em relação ao código.
 *
 * Sem datas nem nada que mude entre execuções: o mesmo código dá o mesmo
 * ficheiro.
 */
import {
  CONTROLO_DITO,
  OBRAS,
  ZONAS_DEMONSTRACAO,
} from '../ordenamento/regras.js';
import type { RegraObra } from '../ordenamento/regras.js';
import {
  ELEMENTOS,
  Grandeza,
  GRANDEZAS,
  numeroPt,
  tolerancia,
  unidadeDita,
  valorDito,
} from './medidas.js';
import {
  DEFINICOES,
  EVIDENCIA_DOCUMENTOS,
  ParametrosZona,
  PARAMETROS_DEMONSTRACAO,
  Perfil,
  PERFIS,
  permitidoPara,
  Uso,
  USOS,
} from './perfis-verificacao.js';
import {
  MAX_BYTES_IA,
  MAX_FICHEIROS_IA,
  MAX_PAGINAS_IA,
} from './verificacoes.js';

const MARCAR = '☐ certo ☐ errado';
const ZONAS = ['ERC', 'CH', 'EA', 'EF'] as const;
const NOME_ZONA: Record<string, string> = Object.fromEntries(
  ZONAS_DEMONSTRACAO.map((z) => [z.codigo, z.nome]),
);
/** Área de lote fictícia só para mostrar a conta dos índices (o valor sai a dividir). */
const LOTE_REF = 1000;

const esc = (t: string) => t.replace(/\|/g, '\\|').replace(/\n/g, ' ');

function tabela(cabecalho: string[], linhas: string[][]): string {
  return [
    `| ${cabecalho.join(' | ')} |`,
    `|${cabecalho.map(() => '---').join('|')}|`,
    ...linhas.map((l) => `| ${l.map(esc).join(' | ')} |`),
  ].join('\n');
}

/** A fonte legal que sabemos, por parâmetro; o resto é "a indicar pelo técnico". */
const FONTE_PARAMETRO: Partial<Record<keyof ParametrosZona, string>> = {
  indice_implantacao_max: 'Regulamento do PDM (índices da classe de espaço)',
  indice_construcao_max: 'Regulamento do PDM (índices da classe de espaço)',
  pisos_max: 'Regulamento do PDM',
  cercea_max_m: 'Regulamento do PDM',
  afastamento_extremas_min_m: 'Regulamento do PDM / RGEU (a indicar o artigo)',
  afastamento_frente_min_m: 'Regulamento do PDM (alinhamentos)',
  piscina_afastamento_min_m: 'Regulamento municipal ou PDM (a indicar)',
  muro_altura_via_max_m:
    'Regulamento municipal de urbanização ou PDM (a indicar)',
  muro_altura_extremas_max_m:
    'Regulamento municipal de urbanização ou PDM (a indicar)',
  usos: 'Regulamento do PDM (usos da classe de espaço)',
  estacionamento_min: 'Regulamento do PDM (parâmetros de estacionamento)',
};

/** De que parâmetro da zona sai o limite de cada medida (por perfil). */
function parametroDe(
  g: Grandeza,
  perfil: Perfil,
  viaPublica: boolean,
): keyof ParametrosZona | null {
  switch (g) {
    case 'area_implantacao_m2':
      return 'indice_implantacao_max';
    case 'area_construcao_m2':
      return 'indice_construcao_max';
    case 'pisos':
      return 'pisos_max';
    case 'cercea_m':
      return 'cercea_max_m';
    case 'afastamento_extremas_m':
      return perfil === 'piscina'
        ? 'piscina_afastamento_min_m'
        : 'afastamento_extremas_min_m';
    case 'afastamento_frente_m':
      return 'afastamento_frente_min_m';
    case 'altura_muro_m':
      return viaPublica
        ? 'muro_altura_via_max_m'
        : 'muro_altura_extremas_max_m';
    case 'lugares_estacionamento':
      return 'estacionamento_min';
    default:
      return null;
  }
}

function regrasDaZona(codigo: string) {
  return ZONAS_DEMONSTRACAO.find((z) => z.codigo === codigo)?.regras ?? {};
}

/** O valor atual do limite numa zona, como o motor o calcula (ou "sem limite"). */
function valorNaZona(
  g: Grandeza,
  perfil: Perfil,
  zona: string,
  e: { via: boolean | null; uso: Uso | null },
): { texto: string; sentido: 'max' | 'min' | null; origem: string | null } {
  const p = PARAMETROS_DEMONSTRACAO[zona];
  const r = permitidoPara(g, {
    perfil,
    p,
    regras: regrasDaZona(zona),
    area_lote: LOTE_REF,
    confronta_via: e.via,
    uso_proposto: e.uso,
  });
  if (!r) return { texto: 'sem limite', sentido: null, origem: null };
  const sinal = r.sentido === 'max' ? '≤' : '≥';
  const texto =
    g === 'area_implantacao_m2' || g === 'area_construcao_m2'
      ? `${sinal} ${numeroPt(r.valor / LOTE_REF)} × área do lote`
      : `${sinal} ${valorDito(g, r.valor)}`;
  return {
    texto,
    sentido: r.sentido,
    // 'Índice de implantação 0,5 × lote de 1000 m².' → sem o valor de uma zona.
    origem: r.origem.replace(
      / [\d,]+ × lote de .*$/,
      ' da zona × área do lote.',
    ),
  };
}

function degrausDitos(r: RegraObra | undefined): string {
  if (!r) return 'sem regra carregada';
  const ds = r.degraus.map((d) => {
    const lim = [
      d.area_max_m2 !== undefined ? `até ${numeroPt(d.area_max_m2)} m²` : null,
      d.altura_max_m !== undefined
        ? `até ${numeroPt(d.altura_max_m)} m de altura`
        : null,
    ]
      .filter(Boolean)
      .join(' e ');
    return `${lim || 'sempre'}: ${CONTROLO_DITO[d.controlo]}`;
  });
  ds.push(
    `${r.degraus.length ? 'acima' : 'sempre'}: ${CONTROLO_DITO[r.acima]}`,
  );
  return ds.join('; ');
}

function seccaoComum(): string[] {
  const parametros: [keyof ParametrosZona, string, (v: unknown) => string][] = [
    [
      'indice_implantacao_max',
      'Índice de implantação máximo',
      (v) => numeroPt(v as number),
    ],
    [
      'indice_construcao_max',
      'Índice de construção máximo',
      (v) => numeroPt(v as number),
    ],
    ['pisos_max', 'Pisos acima do solo (máximo)', (v) => String(v)],
    ['cercea_max_m', 'Cércea máxima', (v) => `${numeroPt(v as number)} m`],
    [
      'afastamento_extremas_min_m',
      'Afastamento mínimo às extremas',
      (v) => `${numeroPt(v as number)} m`,
    ],
    [
      'afastamento_frente_min_m',
      'Afastamento mínimo à via',
      (v) => `${numeroPt(v as number)} m`,
    ],
    [
      'piscina_afastamento_min_m',
      'Distância mínima da piscina às extremas',
      (v) => `${numeroPt(v as number)} m`,
    ],
    [
      'muro_altura_via_max_m',
      'Altura máxima de muro à face da via',
      (v) => `${numeroPt(v as number)} m`,
    ],
    [
      'muro_altura_extremas_max_m',
      'Altura máxima de muro entre vizinhos',
      (v) => `${numeroPt(v as number)} m`,
    ],
    [
      'usos',
      'Usos admitidos',
      (v) =>
        (v as Uso[]).length
          ? (v as Uso[]).map((u) => USOS[u].toLowerCase()).join(', ')
          : 'nenhum uso de construção',
    ],
    [
      'estacionamento_min',
      'Estacionamento mínimo (lugares por fogo ou unidade)',
      (v) => {
        const e = Object.entries(v as Record<string, number>);
        return e.length
          ? e.map(([u, n]) => `${USOS[u as Uso].toLowerCase()} ${n}`).join(', ')
          : 'sem mínimo';
      },
    ],
    [
      'centro_historico',
      'Centro histórico (carta de cores)',
      (v) => (v ? 'sim' : 'não'),
    ],
  ];
  const linhasParam = parametros.map(([k, rotulo, dito]) => [
    rotulo,
    ...ZONAS.map((z) => {
      const v = PARAMETROS_DEMONSTRACAO[z][k];
      return v === undefined ? '—' : dito(v);
    }),
    `${FONTE_PARAMETRO[k] ?? 'a indicar'} · **valor de demonstração**`,
    MARCAR,
    '',
  ]);
  const plaus = (Object.keys(GRANDEZAS) as Grandeza[]).map((g) => {
    const d = GRANDEZAS[g];
    const tol = tolerancia(g, 100);
    const tolDita =
      d.unidade === 'm2'
        ? `2% (mínimo 0,5 m²)`
        : tol
          ? `${numeroPt(tol)} ${unidadeDita(g)}`
          : 'tem de ser igual';
    return [
      d.rotulo,
      unidadeDita(g),
      `${numeroPt(d.min)} a ${numeroPt(d.max)}${d.inteiro ? ' (inteiro)' : ''}`,
      tolDita,
      'regra interna · **valor de demonstração**',
      MARCAR,
      '',
    ];
  });
  return [
    '## 0. Regras comuns a todos os tipos de operação',
    '',
    '### 0.1 Parâmetros das zonas do PDM',
    '',
    `Os limites com que se comparam as medidas, por zona de demonstração (${ZONAS.map((z) => `${z} = ${NOME_ZONA[z]}`).join('; ')}). Fonte no código: \`PARAMETROS_DEMONSTRACAO\` (\`perfis-verificacao.ts\`). Quando a câmara carrega os parâmetros do seu PDM (\`zonas_pdm.parametros\`), estes deixam de contar.`,
    '',
    tabela(
      ['Parâmetro', ...ZONAS, 'Fonte', 'Certo?', 'Valor correto / artigo'],
      linhasParam,
    ),
    '',
    '### 0.2 Plausibilidade e tolerância dos números',
    '',
    'Um número que a IA lê fora do intervalo plausível (ou na unidade errada) é posto de parte e fica "por verificar". Entre o desenhado e o declarado, uma diferença maior do que a tolerância dá "não batem certo" (atenção).',
    '',
    tabela(
      [
        'Medida',
        'Unidade',
        'Intervalo plausível',
        'Tolerância desenhado × declarado',
        'Fonte',
        'Certo?',
        'Valor correto',
      ],
      plaus,
    ),
    '',
    '### 0.3 Limites da leitura pela IA',
    '',
    tabela(
      ['Limite', 'Valor atual', 'Certo?', 'Valor correto'],
      [
        ['Documentos por leitura', String(MAX_FICHEIROS_IA), MARCAR, ''],
        [
          'Páginas por leitura (o que passa fica "por ler")',
          String(MAX_PAGINAS_IA),
          MARCAR,
          '',
        ],
        [
          'Tamanho total por leitura',
          `${MAX_BYTES_IA / (1024 * 1024)} MB`,
          MARCAR,
          '',
        ],
      ],
    ),
    '',
  ];
}

function usosDoPerfil(perfil: Perfil): (Uso | null)[] {
  if (perfil === 'mudanca_uso') {
    return [
      'habitacao',
      'comercio',
      'servicos',
      'restauracao',
      'alojamento_local',
    ];
  }
  return [perfil === 'construcao_nova' ? 'habitacao' : null];
}

function seccaoPerfil(perfil: Perfil, n: number): string[] {
  const d = DEFINICOES[perfil];
  const out: string[] = [`## ${n}. ${d.nome} (\`${perfil}\`)`, ''];

  out.push(
    '### Documentos exigidos',
    '',
    tabela(
      [
        'Documento',
        'Exigência',
        'Reconhecido pelo nome (expressão)',
        'Fonte',
        'Certo?',
        'Correção',
      ],
      d.documentos.map((x) => [
        x.nome,
        x.obrigatorio
          ? 'obrigatório (falta → falha)'
          : 'recomendado (falta → atenção)',
        `\`${x.padrao.source}\``,
        `${EVIDENCIA_DOCUMENTOS.rotulo} · **valor de demonstração**`,
        MARCAR,
        '',
      ]),
    ),
    '',
    'Falta algum documento que a câmara exige para esta operação? ______________________',
    '',
  );

  if (d.grandezas.length) {
    const linhas: string[][] = [];
    for (const g of d.grandezas) {
      const variantes: {
        rotulo: string;
        via: boolean | null;
        uso: Uso | null;
      }[] = [];
      if (g === 'altura_muro_m') {
        variantes.push(
          {
            rotulo: `${GRANDEZAS[g].rotulo} (à face da via)`,
            via: true,
            uso: null,
          },
          {
            rotulo: `${GRANDEZAS[g].rotulo} (entre vizinhos)`,
            via: false,
            uso: null,
          },
        );
      } else if (g === 'lugares_estacionamento') {
        for (const u of usosDoPerfil(perfil)) {
          variantes.push({
            rotulo: `${GRANDEZAS[g].rotulo}${u ? ` (${USOS[u].toLowerCase()})` : ''}`,
            via: null,
            uso: u,
          });
        }
      } else {
        variantes.push({ rotulo: GRANDEZAS[g].rotulo, via: null, uso: null });
      }
      for (const v of variantes) {
        const porZona = ZONAS.map((z) => valorNaZona(g, perfil, z, v));
        const origem = porZona.find((x) => x.origem)?.origem;
        const param = parametroDe(g, perfil, v.via !== false);
        const como =
          g === 'area_obra_m2'
            ? 'Área máxima dos degraus do PDM para esta obra, só quando acima deles não é permitido'
            : (origem ?? 'Só se compara desenhado × declarado (sem limite)');
        linhas.push([
          v.rotulo,
          como,
          ZONAS.map((z, i) => `${z}: ${porZona[i].texto}`).join('; '),
          `${param ? (FONTE_PARAMETRO[param] ?? 'a indicar') : g === 'area_obra_m2' ? 'Regulamento do PDM (degraus da obra)' : '—'} · **valor de demonstração**`,
          MARCAR,
          '',
        ]);
      }
    }
    out.push(
      '### Medidas verificadas (lido nos desenhos × declarado × permitido)',
      '',
      tabela(
        [
          'Medida',
          'Como se calcula o permitido',
          'Valor atual por zona',
          'Fonte',
          'Certo?',
          'Valor correto / artigo',
        ],
        linhas,
      ),
      '',
    );
  } else {
    out.push(
      '### Medidas verificadas',
      '',
      'Nenhuma: esta operação não compara números. Devia comparar algum? ______________________',
      '',
    );
  }

  if (d.classe_espaco) {
    out.push(
      '### Classe de espaço (o uso pretendido é admitido na zona?)',
      '',
      tabela(
        ['Zona', 'Usos admitidos (atual)', 'Fonte', 'Certo?', 'Correção'],
        ZONAS.map((z) => {
          const u = PARAMETROS_DEMONSTRACAO[z].usos;
          return [
            `${z} · ${NOME_ZONA[z]}`,
            u === undefined
              ? 'não carregado'
              : u.length
                ? u.map((x) => USOS[x].toLowerCase()).join(', ')
                : 'nenhum uso de construção',
            `${FONTE_PARAMETRO.usos} · **valor de demonstração**`,
            MARCAR,
            '',
          ];
        }),
      ),
      '',
    );
  }

  if (d.obra) {
    out.push(
      `### Controlo prévio no PDM para "${OBRAS[d.obra].toLowerCase()}"`,
      '',
      tabela(
        ['Zona', 'Degraus atuais', 'Fonte', 'Certo?', 'Correção'],
        ZONAS.map((z) => [
          `${z} · ${NOME_ZONA[z]}`,
          degrausDitos(regrasDaZona(z)[d.obra!]),
          'PDM (demonstração) · **valor de exemplo**',
          MARCAR,
          '',
        ]),
      ),
      '',
    );
  } else {
    out.push(
      '### Controlo prévio no PDM',
      '',
      'O motor do PDM não tem esta operação: contam só os parâmetros da zona (acima). Está bem assim? ☐ sim ☐ não',
      '',
    );
  }

  if (d.elementos.length) {
    out.push(
      '### Perguntas de sim/não à IA',
      '',
      tabela(
        ['Elemento', 'Pergunta', 'Resposta esperada', 'Certo?', 'Correção'],
        d.elementos.map((e) => {
          const x = ELEMENTOS[e];
          return [
            x.rotulo,
            x.pergunta,
            x.esperado === null
              ? 'informativo (não falha)'
              : x.esperado === 'sim'
                ? 'sim (não → atenção)'
                : 'não (sim → atenção)',
            MARCAR,
            '',
          ];
        }),
      ),
      '',
    );
  }

  out.push(
    '### O que a IA procura nos desenhos',
    '',
    ...d.procurar.map((x) => `- ${MARCAR} · ${x}`),
    '',
    '### Fica sempre para o técnico (nem a regra nem a IA decidem)',
    '',
    ...d.sempre_tecnico.map((x) => `- ${MARCAR} · ${x}`),
    '',
    'Falta alguma coisa? ______________________',
    '',
  );
  return out;
}

export function checklistRegrasMarkdown(): string {
  const partes = [
    '# Validar as regras da análise de projetos',
    '',
    '> Gerado a partir do código (`code/api/src/modules/processos/checklist-regras.ts`) com `npm run checklist-regras` (em `code/api`). Não edite à mão: o teste `checklist-regras.spec.ts` falha se este ficheiro não corresponder ao código. As respostas dos técnicos registam-se numa cópia (impressa ou PDF) e passam para o código.',
    '',
    '**Para quem:** os técnicos de urbanismo da câmara. **Para quê:** confirmar, tipo de operação a tipo de operação, o que as verificações automáticas fazem antes de o técnico abrir o processo (V4 #2).',
    '',
    'Como preencher: em cada linha, marque **certo** ou **errado**; se estiver errado, escreva o valor correto e o artigo (PDM, RGEU, RJUE, Portaria n.º 113/2015, regulamento municipal…). O que diz **valor de demonstração** ainda não vem de uma fonte oficial: foi posto para mostrar o motor.',
    '',
    'Lembrete: a leitura da IA **nunca aprova nada**. Só aponta (com a folha onde viu) e fica sempre "a confirmar pelo técnico". As regras abaixo são determinísticas: o mesmo processo dá sempre o mesmo resultado.',
    '',
    'Técnico: ______________________ · Data: ____/____/______ · Assinatura: ______________________',
    '',
    ...seccaoComum(),
    ...PERFIS.flatMap((p, i) => seccaoPerfil(p, i + 1)),
  ];
  return `${partes
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}
