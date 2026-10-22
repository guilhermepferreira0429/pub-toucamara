/*
 * Perfis de verificação por tipo de operação (V4 · análise de projetos de
 * obras antes de o técnico ver). Regras puras, sem BD nem IA.
 *
 * Para cada operação (alteração interior, ampliação ou anexo, moradia nova,
 * piscina, muro, fachada, demolição, mudança de uso):
 *  (a) os documentos instrutórios esperados;
 *  (b) as verificações determinísticas do PDM (índices, pisos, cércea,
 *      afastamentos, altura, classe de espaço);
 *  (c) o que a IA procura nos desenhos (medidas e elementos);
 *  (d) o que fica sempre para o técnico.
 *
 * As listas de documentos seguem a lógica da Portaria n.º 113/2015 (elementos
 * instrutórios do RJUE), simplificada: são LISTAS DE DEMONSTRAÇÃO. Os
 * parâmetros das zonas (índices, cérceas, afastamentos...) são VALORES DE
 * DEMONSTRAÇÃO enquanto a câmara não carrega os do seu PDM
 * (`zonas_pdm.parametros`).
 */
import { z } from 'zod';
import type { Obra, Ponto, RegraObra } from '../ordenamento/regras.js';
import { zonaDe } from '../ordenamento/regras.js';
import {
  compararValor,
  Elemento,
  ELEMENTOS,
  Grandeza,
  GRANDEZAS,
  lerNumero,
  numeroPt,
  Permitido,
  unidadeDita,
  valorDito,
} from './medidas.js';
import {
  ElementoLido,
  Evidencia,
  MedicaoLida,
  novaVerificacao,
  OpcoesLeitura,
  PedidoPerfil,
  Verificacao,
} from './verificacoes.js';

// ---------------------------------------------------------------------------
// Usos e parâmetros das zonas
// ---------------------------------------------------------------------------

export const USOS = {
  habitacao: 'Habitação',
  comercio: 'Comércio',
  servicos: 'Serviços',
  restauracao: 'Restauração e bebidas',
  alojamento_local: 'Alojamento local',
  industria: 'Indústria',
  agricola: 'Apoio agrícola',
} as const;
export type Uso = keyof typeof USOS;
const CODIGOS_USO = Object.keys(USOS) as [Uso, ...Uso[]];

export const esquemaParametrosZona = z.object({
  /** Área de implantação total ÷ área do lote. */
  indice_implantacao_max: z.number().positive().max(1).optional(),
  /** Área de construção total ÷ área do lote. */
  indice_construcao_max: z.number().positive().max(10).optional(),
  pisos_max: z.number().int().positive().optional(),
  cercea_max_m: z.number().positive().optional(),
  afastamento_extremas_min_m: z.number().nonnegative().optional(),
  afastamento_frente_min_m: z.number().nonnegative().optional(),
  piscina_afastamento_min_m: z.number().nonnegative().optional(),
  muro_altura_via_max_m: z.number().positive().optional(),
  muro_altura_extremas_max_m: z.number().positive().optional(),
  /** Usos admitidos na classe de espaço. */
  usos: z.array(z.enum(CODIGOS_USO)).optional(),
  /** Lugares de estacionamento mínimos por uso (por fogo ou unidade). */
  estacionamento_min: z
    .partialRecord(z.enum(CODIGOS_USO), z.number().int().nonnegative())
    .optional(),
  centro_historico: z.boolean().optional(),
  /** De onde vêm os valores ('Regulamento do PDM, art. 23.º'). */
  fonte: z.string().optional(),
});
export type ParametrosZona = z.output<typeof esquemaParametrosZona>;

const FONTE_DEMONSTRACAO =
  'PDM de Guimarães · parâmetros de demonstração (a câmara substitui pelos do regulamento)';

/**
 * Parâmetros de DEMONSTRAÇÃO das zonas de demonstração (pelo código da zona).
 * Não são os do PDM de Guimarães: servem para mostrar o motor.
 */
export const PARAMETROS_DEMONSTRACAO: Record<string, ParametrosZona> = {
  CH: {
    pisos_max: 3,
    cercea_max_m: 10,
    muro_altura_via_max_m: 1.5,
    muro_altura_extremas_max_m: 2,
    usos: [
      'habitacao',
      'comercio',
      'servicos',
      'restauracao',
      'alojamento_local',
    ],
    estacionamento_min: {},
    centro_historico: true,
    fonte: FONTE_DEMONSTRACAO,
  },
  ERC: {
    indice_implantacao_max: 0.5,
    indice_construcao_max: 0.8,
    pisos_max: 2,
    cercea_max_m: 7.5,
    afastamento_extremas_min_m: 3,
    afastamento_frente_min_m: 5,
    piscina_afastamento_min_m: 3,
    muro_altura_via_max_m: 1.5,
    muro_altura_extremas_max_m: 2,
    usos: [
      'habitacao',
      'comercio',
      'servicos',
      'restauracao',
      'alojamento_local',
    ],
    estacionamento_min: {
      habitacao: 1,
      comercio: 1,
      servicos: 1,
      restauracao: 2,
      alojamento_local: 1,
    },
    fonte: FONTE_DEMONSTRACAO,
  },
  EA: {
    indice_implantacao_max: 0.05,
    indice_construcao_max: 0.05,
    pisos_max: 1,
    cercea_max_m: 4.5,
    afastamento_extremas_min_m: 5,
    muro_altura_via_max_m: 1.2,
    muro_altura_extremas_max_m: 1.5,
    usos: ['agricola', 'habitacao'],
    estacionamento_min: {},
    fonte: FONTE_DEMONSTRACAO,
  },
  EF: {
    pisos_max: 1,
    usos: [],
    fonte: FONTE_DEMONSTRACAO,
  },
};

export interface ZonaComParametros {
  codigo: string;
  nome: string;
  categoria: string;
  poligono: Ponto[];
  regras: Partial<Record<Obra, RegraObra>>;
  demonstracao: boolean;
  /** O que a câmara carregou (`zonas_pdm.parametros`); null = ainda nada. */
  parametros?: unknown;
}

/**
 * Os parâmetros da zona: os carregados pela câmara ou, numa zona de
 * demonstração sem eles, os de demonstração. null se não há nenhuns.
 */
export function parametrosDaZona(
  z: Pick<ZonaComParametros, 'codigo' | 'demonstracao' | 'parametros'>,
): { p: ParametrosZona; demonstracao: boolean } | null {
  if (z.parametros) {
    const r = esquemaParametrosZona.safeParse(z.parametros);
    if (r.success) return { p: r.data, demonstracao: z.demonstracao };
  }
  const d = z.demonstracao ? PARAMETROS_DEMONSTRACAO[z.codigo] : undefined;
  return d ? { p: d, demonstracao: true } : null;
}

// ---------------------------------------------------------------------------
// Perfis
// ---------------------------------------------------------------------------

export const PERFIS = [
  'interior',
  'ampliacao',
  'construcao_nova',
  'piscina',
  'muro',
  'fachada',
  'demolicao',
  'mudanca_uso',
] as const;
export type Perfil = (typeof PERFIS)[number];

export interface DocumentoEsperado {
  chave: string;
  nome: string;
  padrao: RegExp;
  /** true: falta → falha; false: recomendado, falta → atenção. */
  obrigatorio: boolean;
}

const DOC = {
  certidao: {
    chave: 'certidao',
    nome: 'Certidão do registo predial',
    padrao: /certid[aã]o|registo predial/i,
  },
  termo: {
    chave: 'termo',
    nome: 'Termo de responsabilidade do autor do projeto',
    padrao: /termo\s+de\s+responsabilidade/i,
  },
  projeto: {
    chave: 'projeto',
    nome: 'Projeto de arquitetura (memória e peças desenhadas)',
    padrao: /arquite(c)?tura|pe[cç]as desenhadas/i,
  },
  localizacao: {
    chave: 'localizacao',
    nome: 'Planta de localização',
    padrao: /planta de localiza|extrato.*(pdm|planta)|ortofoto/i,
  },
  levantamento: {
    chave: 'levantamento',
    nome: 'Levantamento topográfico',
    padrao: /levantamento/i,
  },
  estabilidade: {
    chave: 'estabilidade',
    nome: 'Projeto de estabilidade',
    padrao: /estabilidade|estruturas/i,
  },
  especialidades: {
    chave: 'especialidades',
    nome: 'Projetos de especialidades (águas, esgotos, eletricidade, térmica)',
    padrao: /especialidades|[aá]guas|esgotos|t[eé]rmic/i,
  },
  fotografias: {
    chave: 'fotografias',
    nome: 'Fotografias do existente',
    padrao: /fotografia/i,
  },
  plano_demolicao: {
    chave: 'plano_demolicao',
    nome: 'Plano de demolição',
    padrao: /plano de demoli/i,
  },
  rcd: {
    chave: 'rcd',
    nome: 'Plano de prevenção e gestão de resíduos de construção e demolição',
    padrao: /res[ií]duos|\bRCD\b/i,
  },
  acessibilidades: {
    chave: 'acessibilidades',
    nome: 'Plano de acessibilidades',
    padrao: /acessibilidade/i,
  },
  incendio: {
    chave: 'incendio',
    nome: 'Segurança contra incêndio (ficha ou projeto)',
    padrao: /inc[eê]ndio|\bSCIE\b/i,
  },
} satisfies Record<string, Omit<DocumentoEsperado, 'obrigatorio'>>;

const obr = (d: Omit<DocumentoEsperado, 'obrigatorio'>): DocumentoEsperado => ({
  ...d,
  obrigatorio: true,
});
const rec = (d: Omit<DocumentoEsperado, 'obrigatorio'>): DocumentoEsperado => ({
  ...d,
  obrigatorio: false,
});

export interface DefinicaoPerfil {
  codigo: Perfil;
  nome: string;
  /** A obra no motor do PDM (`avaliarObra`); null se o motor não a tem. */
  obra: Obra | null;
  documentos: DocumentoEsperado[];
  /** Números a comparar (lido × declarado × permitido). */
  grandezas: Grandeza[];
  /** Perguntas de sim/não à IA. */
  elementos: Elemento[];
  /** O que a IA procura nos desenhos (vai no pedido). */
  procurar: string[];
  /** O que nunca sai de uma regra nem da IA: decide o técnico. */
  sempre_tecnico: string[];
  /** Verifica-se a classe de espaço (o uso pretendido é admitido?). */
  classe_espaco: boolean;
  leitura: OpcoesLeitura;
}

const COMUM_TECNICO =
  'A decisão e o parecer são do técnico: estas verificações só preparam a apreciação.';

export const DEFINICOES: Record<Perfil, DefinicaoPerfil> = {
  interior: {
    codigo: 'interior',
    nome: 'Alteração interior',
    obra: 'interior',
    documentos: [obr(DOC.certidao), obr(DOC.termo), obr(DOC.projeto)],
    grandezas: [],
    elementos: [],
    procurar: [
      'Paredes a abrir ou a demolir e se o projeto diz que não são estruturais.',
      'Se a fachada e a cobertura ficam como estão.',
    ],
    sempre_tecnico: [
      'Se a parede a abrir é mesmo não estrutural (sem planta de estruturas, pedir ao técnico autor).',
      COMUM_TECNICO,
    ],
    classe_espaco: false,
    leitura: { paredes: true },
  },
  ampliacao: {
    codigo: 'ampliacao',
    nome: 'Ampliação ou anexo',
    obra: 'ampliacao',
    documentos: [
      obr(DOC.certidao),
      obr(DOC.termo),
      obr(DOC.projeto),
      obr(DOC.localizacao),
      obr(DOC.levantamento),
      rec(DOC.estabilidade),
      rec(DOC.fotografias),
    ],
    grandezas: [
      'area_obra_m2',
      'area_implantacao_m2',
      'area_construcao_m2',
      'pisos',
      'cercea_m',
      'afastamento_extremas_m',
    ],
    elementos: [],
    procurar: [
      'A área da ampliação e a área de implantação total desenhadas (quadro de áreas e planta de implantação).',
      'A área de construção total, o número de pisos acima do solo e a cércea (cortes e alçados).',
      'O menor afastamento às extremas do lote, cotado na planta de implantação.',
      'A área do lote, se estiver escrita.',
    ],
    sempre_tecnico: [
      'A inserção da ampliação na envolvente e a qualidade arquitetónica.',
      'Se a ampliação mexe na estrutura existente.',
      COMUM_TECNICO,
    ],
    classe_espaco: false,
    leitura: { paredes: true, fachada_esperada: true, com_medidas: true },
  },
  construcao_nova: {
    codigo: 'construcao_nova',
    nome: 'Construção nova de moradia',
    obra: null,
    documentos: [
      obr(DOC.certidao),
      obr(DOC.termo),
      obr(DOC.projeto),
      obr(DOC.localizacao),
      obr(DOC.levantamento),
      obr(DOC.estabilidade),
      obr(DOC.especialidades),
    ],
    grandezas: [
      'area_implantacao_m2',
      'area_construcao_m2',
      'pisos',
      'cercea_m',
      'afastamento_extremas_m',
      'afastamento_frente_m',
      'lugares_estacionamento',
    ],
    elementos: [],
    procurar: [
      'Área de implantação e de construção totais (quadro de áreas).',
      'Número de pisos acima do solo e cércea (cortes e alçados).',
      'Afastamentos às extremas e à via, cotados na planta de implantação.',
      'Lugares de estacionamento dentro do lote.',
    ],
    sempre_tecnico: [
      'A inserção urbana, o alinhamento com os vizinhos e a qualidade arquitetónica.',
      'As infraestruturas (água, esgotos, acesso) e eventuais cedências.',
      COMUM_TECNICO,
    ],
    classe_espaco: true,
    leitura: { paredes: false, fachada_esperada: true, com_medidas: true },
  },
  piscina: {
    codigo: 'piscina',
    nome: 'Piscina',
    obra: 'piscina',
    documentos: [
      obr(DOC.certidao),
      obr(DOC.termo),
      obr(DOC.projeto),
      obr(DOC.localizacao),
      rec(DOC.estabilidade),
    ],
    grandezas: ['area_obra_m2', 'afastamento_extremas_m'],
    elementos: ['casa_maquinas'],
    procurar: [
      'A área do plano de água (planta).',
      'A menor distância da piscina às extremas do lote, cotada na planta.',
      'Onde fica a casa das máquinas e se está desenhada.',
    ],
    sempre_tecnico: [
      'A drenagem e o destino da água da piscina.',
      'A segurança (vedação da piscina) e o impacto nos vizinhos.',
      COMUM_TECNICO,
    ],
    classe_espaco: false,
    leitura: { paredes: false, fachada_esperada: false, com_medidas: true },
  },
  muro: {
    codigo: 'muro',
    nome: 'Muro de vedação',
    obra: 'muro',
    documentos: [
      obr(DOC.certidao),
      obr(DOC.termo),
      obr(DOC.projeto),
      obr(DOC.localizacao),
    ],
    grandezas: ['altura_muro_m'],
    elementos: ['confronta_via'],
    procurar: [
      'A altura do muro cotada no alçado (do lado da via, se confronta com ela).',
      'Se o muro confronta com a via pública e o alinhamento proposto.',
    ],
    sempre_tecnico: [
      'O alinhamento do muro face à via (recuos, alargamentos previstos, visibilidade nos cruzamentos).',
      COMUM_TECNICO,
    ],
    classe_espaco: false,
    leitura: { paredes: false, fachada_esperada: false, com_medidas: true },
  },
  fachada: {
    codigo: 'fachada',
    nome: 'Alteração de fachada ou janelas',
    obra: 'fachada',
    documentos: [
      obr(DOC.certidao),
      obr(DOC.termo),
      obr(DOC.projeto),
      obr(DOC.fotografias),
      rec(DOC.localizacao),
    ],
    grandezas: ['cercea_m'],
    elementos: ['materiais_cores'],
    procurar: [
      'O que muda nos alçados: vãos, caixilharia, cores, materiais, cobertura.',
      'Os materiais e as cores indicados (no centro histórico têm de seguir a carta de cores).',
      'Se a cércea se mantém.',
    ],
    sempre_tecnico: [
      'A conformidade com a carta de cores e materiais, sobretudo no centro histórico.',
      'A harmonia com o conjunto (edifícios vizinhos, frente de rua).',
      COMUM_TECNICO,
    ],
    classe_espaco: false,
    leitura: { paredes: true, fachada_esperada: true, com_medidas: true },
  },
  demolicao: {
    codigo: 'demolicao',
    nome: 'Demolição',
    obra: null,
    documentos: [
      obr(DOC.certidao),
      obr(DOC.termo),
      obr(DOC.plano_demolicao),
      obr(DOC.rcd),
      obr(DOC.fotografias),
      rec(DOC.localizacao),
    ],
    grandezas: [],
    elementos: ['plano_demolicao', 'amianto'],
    procurar: [
      'O plano de demolição: o que se demole, faseamento, meios e proteção da via e dos vizinhos.',
      'Referências a fibrocimento ou amianto (coberturas, tubagens).',
    ],
    sempre_tecnico: [
      'O valor patrimonial do que se demole e se a demolição é admissível.',
      'A remoção de amianto, se houver, por empresa habilitada.',
      COMUM_TECNICO,
    ],
    classe_espaco: false,
    leitura: { paredes: false, fachada_esperada: true, com_medidas: false },
  },
  mudanca_uso: {
    codigo: 'mudanca_uso',
    nome: 'Mudança de uso',
    obra: null,
    documentos: [
      obr(DOC.certidao),
      obr(DOC.termo),
      obr(DOC.projeto),
      obr(DOC.localizacao),
      obr(DOC.acessibilidades),
      obr(DOC.incendio),
      rec(DOC.fotografias),
    ],
    grandezas: ['lugares_estacionamento'],
    elementos: ['acessibilidades'],
    procurar: [
      'O uso atual e o uso proposto, e a área afeta ao novo uso.',
      'Os lugares de estacionamento previstos.',
      'Acessibilidades: entrada sem degraus ou rampa, instalação sanitária adaptada.',
    ],
    sempre_tecnico: [
      'A compatibilidade do novo uso com a vizinhança (ruído, cargas e descargas).',
      'As condições de segurança contra incêndio e de salubridade.',
      COMUM_TECNICO,
    ],
    classe_espaco: true,
    leitura: { paredes: true, fachada_esperada: false, com_medidas: true },
  },
};

export function pedidoDoPerfil(p: Perfil): PedidoPerfil {
  const d = DEFINICOES[p];
  return {
    nome: d.nome,
    procurar: d.procurar,
    grandezas: d.grandezas,
    elementos: d.elementos,
  };
}

// ---------------------------------------------------------------------------
// Escolha do perfil
// ---------------------------------------------------------------------------

/** Pela ordem de prioridade: a operação "maior" primeiro. */
const PALAVRAS: [Perfil, RegExp][] = [
  [
    'demolicao',
    /demoli[cç][aã]o (total|de (um|uma|o|a) )|\bdemolir (a|o) (casa|edif|constru|armaz|anexo|moradia)|demoli[cç][aã]o d[aoe] (casa|edif|constru|armaz|anexo|moradia)|^demoli/,
  ],
  [
    'mudanca_uso',
    /mudan[cç]a de uso|altera[cç][aã]o (de|do) uso|alojamento local|passar a (com[eé]rcio|servi[cç]os|loja|restaura)|transforma[cç][aã]o em (loja|com[eé]rcio|restaura|escrit)/,
  ],
  [
    'construcao_nova',
    /constru[cç][aã]o (nova|de (uma )?(nova )?moradia|de habita)|nova moradia|moradia nova|edifica[cç][aã]o nova/,
  ],
  ['piscina', /piscina/],
  ['muro', /\bmuros?\b|veda[cç][aã]o/],
  [
    'ampliacao',
    /amplia|\banexo|telheiro|arrumos|garagem|acrescento|mais um piso|marquise/,
  ],
  [
    'fachada',
    /fachada|janelas?\b|caixilharia|\bpintar|\bcores?\b|varanda|cobertura|telhado/,
  ],
  ['interior', /interior|cozinha|casa de banho|remodela|\bparede|\bporta\b/],
];

const ALIAS: Record<string, Perfil> = {
  alteracao_interior: 'interior',
  anexo: 'ampliacao',
  moradia: 'construcao_nova',
  construcao: 'construcao_nova',
  muro_vedacao: 'muro',
  janelas: 'fachada',
  uso: 'mudanca_uso',
  alojamento_local: 'mudanca_uso',
};

function sem_acentos(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Os perfis que o texto sugere, pela ordem de prioridade. */
export function perfisNoTexto(texto: string): Perfil[] {
  const t = texto.toLowerCase();
  return PALAVRAS.filter(([, re]) => re.test(t)).map(([p]) => p);
}

/** A operação declarada no requerimento ('piscina', 'Muro de vedação'...) → perfil. */
export function perfilDaOperacao(op: string | null | undefined): Perfil | null {
  if (!op) return null;
  const c = sem_acentos(op.trim().toLowerCase()).replace(/[\s-]+/g, '_');
  if ((PERFIS as readonly string[]).includes(c)) return c as Perfil;
  if (ALIAS[c]) return ALIAS[c];
  const pelo = perfisNoTexto(op);
  return pelo.length === 1 ? pelo[0] : null;
}

export type EscolhidoPor = 'tecnico' | 'requerimento' | 'tipo' | 'texto';

export interface EscolhaPerfil {
  perfil: Perfil | null;
  escolhido_por: EscolhidoPor | null;
  /** Os perfis possíveis (para o técnico escolher, se ambíguo). */
  candidatos: Perfil[];
  /** Há mais do que uma leitura possível (ou nenhuma): o técnico escolhe. */
  ambiguo: boolean;
}

/**
 * O perfil do processo: o que o técnico escolheu; senão a operação declarada
 * no requerimento; senão o tipo de processo (se for específico, ex.:
 * "Licença · piscina"); senão o assunto e a descrição. Se o texto sugere
 * mais do que uma operação fica a primeira (a "maior") e diz-se que é
 * ambíguo, para o técnico confirmar.
 */
export function escolherPerfil(e: {
  tipo: { codigo: string; nome: string };
  assunto: string;
  descricao: string;
  operacao_declarada?: string | null;
  escolhido?: Perfil | null;
}): EscolhaPerfil {
  const texto = perfisNoTexto(`${e.assunto}. ${e.descricao}`);
  const doTipo = perfisNoTexto(e.tipo.nome).filter((p) => p !== 'interior');
  const candidatos = [...new Set([...doTipo, ...texto])];
  if (e.escolhido) {
    return {
      perfil: e.escolhido,
      escolhido_por: 'tecnico',
      candidatos,
      ambiguo: false,
    };
  }
  const declarada = perfilDaOperacao(e.operacao_declarada);
  if (declarada) {
    return {
      perfil: declarada,
      escolhido_por: 'requerimento',
      candidatos: [...new Set([declarada, ...candidatos])],
      ambiguo: false,
    };
  }
  if (doTipo.length === 1) {
    return {
      perfil: doTipo[0],
      escolhido_por: 'tipo',
      candidatos,
      ambiguo: false,
    };
  }
  if (texto.length) {
    return {
      perfil: texto[0],
      escolhido_por: 'texto',
      candidatos,
      ambiguo: texto.length > 1,
    };
  }
  return { perfil: null, escolhido_por: null, candidatos: [], ambiguo: true };
}

// ---------------------------------------------------------------------------
// O que o requerimento declara
// ---------------------------------------------------------------------------

export interface Declarados {
  valores: Partial<Record<Grandeza, number>>;
  operacao: string | null;
  uso_atual: Uso | null;
  uso_proposto: Uso | null;
  confronta_via: boolean | null;
}

function lerUso(x: unknown): Uso | null {
  if (typeof x !== 'string') return null;
  const c = sem_acentos(x.trim().toLowerCase()).replace(/[\s-]+/g, '_');
  if ((CODIGOS_USO as string[]).includes(c)) return c as Uso;
  if (/habita/.test(c)) return 'habitacao';
  if (/alojamento/.test(c)) return 'alojamento_local';
  if (/restaura|cafe|bebidas/.test(c)) return 'restauracao';
  if (/comerc|loja/.test(c)) return 'comercio';
  if (/servic|escrit/.test(c)) return 'servicos';
  return null;
}

function lerSimNao(x: unknown): boolean | null {
  if (typeof x === 'boolean') return x;
  if (typeof x !== 'string') return null;
  if (/^(sim|s|true|yes)$/i.test(x.trim())) return true;
  if (/^(n[aã]o|n|false|no)$/i.test(x.trim())) return false;
  return null;
}

/**
 * Os valores declarados no requerimento (os campos com o código da grandeza:
 * `area_implantacao_m2`, `pisos`...), a operação e os usos. O que não é um
 * número plausível fica de fora.
 */
export function declaradosDoRequerimento(dados: unknown): Declarados {
  const d =
    dados && typeof dados === 'object' && !Array.isArray(dados)
      ? (dados as Record<string, unknown>)
      : {};
  const valores: Partial<Record<Grandeza, number>> = {};
  for (const g of Object.keys(GRANDEZAS) as Grandeza[]) {
    const n = lerNumero(d[g]);
    const def = GRANDEZAS[g];
    if (n !== null && n >= def.min && n <= def.max) valores[g] = n;
  }
  return {
    valores,
    operacao: typeof d.operacao === 'string' ? d.operacao : null,
    uso_atual: lerUso(d.uso_atual),
    uso_proposto: lerUso(d.uso_proposto),
    confronta_via: lerSimNao(d.confronta_via),
  };
}

// ---------------------------------------------------------------------------
// (a) Documentos esperados
// ---------------------------------------------------------------------------

const EVIDENCIA_DOCUMENTOS: Evidencia = {
  tipo: 'regra',
  rotulo:
    'Portaria n.º 113/2015 (elementos instrutórios do RJUE) · lista simplificada de demonstração',
};

export function verificarDocumentosPerfil(
  perfil: Perfil,
  documentos: { id: string; nome: string }[],
): Verificacao {
  const d = DEFINICOES[perfil];
  const encontrados = d.documentos.map((x) => ({
    x,
    doc: documentos.find((doc) => x.padrao.test(doc.nome)) ?? null,
  }));
  const faltaObr = encontrados.filter((e) => !e.doc && e.x.obrigatorio);
  const faltaRec = encontrados.filter((e) => !e.doc && !e.x.obrigatorio);
  const base = {
    codigo: 'perfil_documentos',
    grupo: 'documentos' as const,
    origem: 'regra' as const,
    demonstracao: true,
    evidencias: [
      EVIDENCIA_DOCUMENTOS,
      ...encontrados
        .filter((e) => e.doc)
        .map((e): Evidencia => ({
          tipo: 'documento',
          rotulo: e.doc!.nome,
          documento_id: e.doc!.id,
          pagina: null,
        })),
    ],
    notas: encontrados.map(
      (e) =>
        `${e.doc ? '✓' : e.x.obrigatorio ? '✕' : '⚠'} ${e.x.nome}${e.x.obrigatorio ? '' : ' (recomendado)'}`,
    ),
  };
  const operacao = d.nome.toLowerCase();
  if (faltaObr.length) {
    return novaVerificacao({
      ...base,
      estado: 'falha',
      titulo: `Faltam documentos para ${operacao}`,
      detalhe: `${faltaObr.map((e) => e.x.nome).join('; ')}.`,
    });
  }
  if (faltaRec.length) {
    return novaVerificacao({
      ...base,
      estado: 'atencao',
      titulo: `Documentos para ${operacao}: falta o recomendado`,
      detalhe: `${faltaRec.map((e) => e.x.nome).join('; ')}.`,
    });
  }
  return novaVerificacao({
    ...base,
    estado: 'ok',
    titulo: `Documentos esperados para ${operacao}`,
    detalhe: `Entregues os ${d.documentos.length} documentos da lista.`,
  });
}

// ---------------------------------------------------------------------------
// (b) PDM: o permitido e a comparação dos números
// ---------------------------------------------------------------------------

/** A área máxima da obra pelos degraus do PDM, quando acima deles não é permitido. */
function areaMaximaDaRegra(r: RegraObra | undefined): number | null {
  if (!r || r.acima !== 'nao_permitido') return null;
  const areas = r.degraus
    .map((d) => d.area_max_m2)
    .filter((x): x is number => typeof x === 'number');
  return areas.length ? Math.max(...areas) : null;
}

/** O valor permitido para a grandeza nesta zona (com a conta, se houver). */
export function permitidoPara(
  g: Grandeza,
  e: {
    perfil: Perfil;
    p: ParametrosZona;
    regras: Partial<Record<Obra, RegraObra>>;
    area_lote: number | null;
    confronta_via: boolean | null;
    uso_proposto: Uso | null;
  },
): Permitido | null {
  const { p } = e;
  const lote = e.area_lote;
  switch (g) {
    case 'area_implantacao_m2':
      if (!p.indice_implantacao_max || !lote) return null;
      return {
        valor: Math.round(p.indice_implantacao_max * lote * 100) / 100,
        sentido: 'max',
        origem: `Índice de implantação ${numeroPt(p.indice_implantacao_max)} × lote de ${valorDito('area_lote_m2', lote)}.`,
      };
    case 'area_construcao_m2':
      if (!p.indice_construcao_max || !lote) return null;
      return {
        valor: Math.round(p.indice_construcao_max * lote * 100) / 100,
        sentido: 'max',
        origem: `Índice de construção ${numeroPt(p.indice_construcao_max)} × lote de ${valorDito('area_lote_m2', lote)}.`,
      };
    case 'pisos':
      return p.pisos_max
        ? {
            valor: p.pisos_max,
            sentido: 'max',
            origem: 'Número máximo de pisos da zona.',
          }
        : null;
    case 'cercea_m':
      return p.cercea_max_m
        ? {
            valor: p.cercea_max_m,
            sentido: 'max',
            origem: 'Cércea máxima da zona.',
          }
        : null;
    case 'afastamento_extremas_m': {
      const min =
        e.perfil === 'piscina'
          ? p.piscina_afastamento_min_m
          : p.afastamento_extremas_min_m;
      if (min === undefined) return null;
      return {
        valor: min,
        sentido: 'min',
        origem:
          e.perfil === 'piscina'
            ? 'Distância mínima da piscina às extremas do lote.'
            : 'Afastamento mínimo às extremas do lote.',
      };
    }
    case 'afastamento_frente_m':
      return p.afastamento_frente_min_m !== undefined
        ? {
            valor: p.afastamento_frente_min_m,
            sentido: 'min',
            origem: 'Afastamento mínimo à via.',
          }
        : null;
    case 'altura_muro_m': {
      const via = e.confronta_via !== false;
      const max = via ? p.muro_altura_via_max_m : p.muro_altura_extremas_max_m;
      if (!max) return null;
      return {
        valor: max,
        sentido: 'max',
        origem: via
          ? `Altura máxima de muro confinante com a via pública${e.confronta_via === null ? ' (assumido: não se sabe se confronta)' : ''}.`
          : 'Altura máxima de muro entre vizinhos.',
      };
    }
    case 'area_obra_m2': {
      const obra = DEFINICOES[e.perfil].obra;
      const max = obra ? areaMaximaDaRegra(e.regras[obra]) : null;
      return max
        ? {
            valor: max,
            sentido: 'max',
            origem: 'Área máxima que a zona admite para esta obra.',
          }
        : null;
    }
    case 'lugares_estacionamento': {
      const uso =
        e.uso_proposto ?? (e.perfil === 'construcao_nova' ? 'habitacao' : null);
      const min = uso ? p.estacionamento_min?.[uso] : undefined;
      return min !== undefined && uso
        ? {
            valor: min,
            sentido: 'min',
            origem: `Estacionamento mínimo para ${USOS[uso].toLowerCase()}.`,
          }
        : null;
    }
    case 'area_lote_m2':
      return null;
  }
}

export interface EntradaMedidas {
  perfil: Perfil;
  zona: { nome: string; regras: Partial<Record<Obra, RegraObra>> } | null;
  parametros: { p: ParametrosZona; demonstracao: boolean } | null;
  declarados: Declarados;
  lidas: MedicaoLida[];
  /** A IA leu o projeto (para dizer "não se viu nos desenhos"). */
  ia_leu: boolean;
}

/**
 * Uma verificação por grandeza do perfil, com a linha lido × declarado ×
 * permitido. Com limite vai para o grupo PDM; sem limite (só coerência
 * desenho/requerimento) vai para os desenhos. Sem nada para comparar, não
 * aparece.
 */
export function verificarMedidas(e: EntradaMedidas): Verificacao[] {
  const d = DEFINICOES[e.perfil];
  const lido = (g: Grandeza) => e.lidas.find((x) => x.grandeza === g) ?? null;
  const lote =
    e.declarados.valores.area_lote_m2 ?? lido('area_lote_m2')?.valor ?? null;
  const fonte = e.parametros?.p.fonte ?? null;
  const out: Verificacao[] = [];
  for (const g of d.grandezas) {
    const l = lido(g);
    const declarado = e.declarados.valores[g] ?? null;
    const permitido =
      e.parametros && e.zona
        ? permitidoPara(g, {
            perfil: e.perfil,
            p: e.parametros.p,
            regras: e.zona.regras,
            area_lote: lote,
            confronta_via: e.declarados.confronta_via,
            uso_proposto: e.declarados.uso_proposto,
          })
        : null;
    if (!l && declarado === null && !permitido) continue;
    const c = compararValor(g, {
      lido: l?.valor ?? null,
      declarado,
      permitido,
      ia_leu: e.ia_leu,
    });
    const rotulo = GRANDEZAS[g].rotulo;
    const titulo =
      c.estado === 'falha'
        ? `${rotulo}: ${permitido?.sentido === 'min' ? 'abaixo do mínimo' : 'excede o permitido'}`
        : c.estado === 'atencao'
          ? `${rotulo}: desenhado e declarado não batem certo`
          : c.estado === 'ok'
            ? `${rotulo} dentro do permitido`
            : `${rotulo}: por verificar`;
    const notas = [...c.notas];
    if (g === 'area_implantacao_m2' || g === 'area_construcao_m2') {
      if (!lote) notas.push('Sem a área do lote não se calcula o máximo.');
    }
    if (permitido && fonte) notas.push(fonte);
    out.push(
      novaVerificacao({
        codigo: `pdm_${g}`,
        grupo: permitido ? 'pdm' : 'desenhos',
        estado: c.estado,
        titulo:
          !permitido && c.estado === 'ok'
            ? `${rotulo}: desenhado e declarado batem certo`
            : titulo,
        detalhe: c.detalhe,
        origem: c.origem,
        a_confirmar: c.a_confirmar,
        demonstracao: Boolean(permitido && e.parametros?.demonstracao),
        evidencias: [
          ...(l?.evidencia ? [l.evidencia] : []),
          ...(permitido && e.zona
            ? [
                {
                  tipo: 'regra' as const,
                  rotulo: `PDM · ${e.zona.nome}`,
                },
              ]
            : []),
        ],
        notas,
        valor: {
          grandeza: g,
          rotulo,
          unidade: unidadeDita(g),
          lido: l ? { valor: l.valor, evidencia: l.evidencia } : null,
          declarado,
          permitido,
        },
      }),
    );
  }
  return out;
}

/** A classe de espaço admite o uso pretendido? (moradia nova, mudança de uso) */
export function verificarClasseEspaco(e: {
  perfil: Perfil;
  zona: { nome: string } | null;
  parametros: { p: ParametrosZona; demonstracao: boolean } | null;
  declarados: Declarados;
}): Verificacao | null {
  if (!DEFINICOES[e.perfil].classe_espaco) return null;
  const base = {
    codigo: 'pdm_classe_espaco',
    grupo: 'pdm' as const,
    origem: 'regra' as const,
    demonstracao: e.parametros?.demonstracao ?? false,
    evidencias: e.zona
      ? [{ tipo: 'regra' as const, rotulo: `PDM · ${e.zona.nome}` }]
      : [],
  };
  const uso =
    e.declarados.uso_proposto ??
    (e.perfil === 'construcao_nova' ? 'habitacao' : null);
  const titulo = 'Classe de espaço: uso pretendido';
  if (!e.zona || !e.parametros?.p.usos) {
    return novaVerificacao({
      ...base,
      estado: 'nao_verificavel',
      titulo,
      detalhe: e.zona
        ? `${e.zona.nome}: os usos admitidos não estão carregados.`
        : 'Sem zona do PDM no local.',
    });
  }
  if (!uso) {
    return novaVerificacao({
      ...base,
      estado: 'nao_verificavel',
      titulo,
      detalhe: 'O requerimento não diz o uso pretendido.',
    });
  }
  const admitidos = e.parametros.p.usos;
  const de = e.declarados.uso_atual
    ? `${USOS[e.declarados.uso_atual]} → ${USOS[uso].toLowerCase()}`
    : USOS[uso];
  if (admitidos.includes(uso)) {
    return novaVerificacao({
      ...base,
      estado: 'ok',
      titulo: 'Uso admitido na classe de espaço',
      detalhe: `${de}: admitido em ${e.zona.nome}.`,
    });
  }
  return novaVerificacao({
    ...base,
    estado: 'falha',
    titulo: 'Uso não admitido na classe de espaço',
    detalhe: `${de}: ${e.zona.nome} admite ${admitidos.length ? admitidos.map((u) => USOS[u].toLowerCase()).join(', ') : 'nenhum uso de construção'}.`,
  });
}

// ---------------------------------------------------------------------------
// (c) Desenhos: os elementos que a IA procura
// ---------------------------------------------------------------------------

export function verificarElementos(e: {
  perfil: Perfil;
  elementos: ElementoLido[];
  ia_leu: boolean;
  centro_historico: boolean;
}): Verificacao[] {
  if (!e.ia_leu) return [];
  const ia = {
    origem: 'ia' as const,
    a_confirmar: true,
    grupo: 'desenhos' as const,
  };
  return DEFINICOES[e.perfil].elementos.map((codigo) => {
    const def = ELEMENTOS[codigo];
    const r = e.elementos.find((x) => x.elemento === codigo);
    const base = { ...ia, codigo: `ia_${codigo}` };
    if (!r) {
      return novaVerificacao({
        ...base,
        estado: 'atencao',
        titulo: `${def.rotulo}: a IA não respondeu`,
        detalhe: 'Confirmar nos desenhos.',
      });
    }
    const evidencias = r.evidencias;
    if (codigo === 'materiais_cores' && e.centro_historico) {
      return novaVerificacao({
        ...base,
        estado: 'atencao',
        titulo:
          r.resposta === 'sim'
            ? 'Materiais e cores: confirmar pela carta de cores do centro histórico'
            : 'Materiais e cores não indicados (centro histórico)',
        detalhe: r.descricao,
        evidencias,
      });
    }
    if (def.esperado === null) {
      // Informativo (ex.: o muro confronta com a via): ok se se sabe.
      return novaVerificacao({
        ...base,
        estado: r.resposta === 'incerto' ? 'atencao' : 'ok',
        titulo:
          r.resposta === 'sim'
            ? def.rotulo
            : r.resposta === 'nao'
              ? `${def.rotulo}: não`
              : `${def.rotulo}: confirmar`,
        detalhe: r.descricao,
        evidencias,
      });
    }
    const conforme = r.resposta === def.esperado;
    let titulo: string;
    if (codigo === 'amianto') {
      titulo =
        r.resposta === 'sim'
          ? 'Há materiais com amianto: remoção por empresa habilitada'
          : r.resposta === 'nao'
            ? 'Sem referência a amianto'
            : 'Amianto: confirmar';
    } else {
      titulo =
        r.resposta === 'sim'
          ? `${def.rotulo}: no projeto`
          : r.resposta === 'nao'
            ? `${def.rotulo}: não se vê`
            : `${def.rotulo}: confirmar`;
    }
    return novaVerificacao({
      ...base,
      estado: conforme ? 'ok' : 'atencao',
      titulo,
      detalhe: r.descricao,
      evidencias,
      notas: conforme ? ['Detetado pela IA: a confirmar.'] : [],
    });
  });
}

/** Os números que a IA leu mas não passaram a validação, numa linha. */
export function verificarDescartadas(
  descartadas: string[],
): Verificacao | null {
  if (!descartadas.length) return null;
  return novaVerificacao({
    codigo: 'ia_valores_descartados',
    grupo: 'desenhos',
    origem: 'ia',
    a_confirmar: true,
    estado: 'atencao',
    titulo: 'Valores lidos pela IA postos de parte',
    detalhe: `${descartadas.join('; ')}.`,
    notas: ['Não entram na comparação: confirmar nos desenhos.'],
  });
}

// ---------------------------------------------------------------------------
// Juntar: tudo o que o perfil acrescenta
// ---------------------------------------------------------------------------

export interface InfoPerfil {
  codigo: Perfil | null;
  nome: string | null;
  escolhido_por: EscolhidoPor | null;
  ambiguo: boolean;
  candidatos: { codigo: Perfil; nome: string }[];
  /** Todos os perfis, para o técnico escolher. */
  opcoes: { codigo: Perfil; nome: string }[];
  sempre_tecnico: string[];
  procurar: string[];
}

export function infoPerfil(e: EscolhaPerfil): InfoPerfil {
  const d = e.perfil ? DEFINICOES[e.perfil] : null;
  return {
    codigo: e.perfil,
    nome: d?.nome ?? null,
    escolhido_por: e.escolhido_por,
    ambiguo: e.ambiguo,
    candidatos: e.candidatos.map((c) => ({
      codigo: c,
      nome: DEFINICOES[c].nome,
    })),
    opcoes: PERFIS.map((c) => ({ codigo: c, nome: DEFINICOES[c].nome })),
    sempre_tecnico: d?.sempre_tecnico ?? [COMUM_TECNICO],
    procurar: d?.procurar ?? [],
  };
}

export interface EntradaPerfil {
  perfil: Perfil;
  ponto: Ponto | null;
  zonas: ZonaComParametros[];
  documentos: { id: string; nome: string }[];
  declarados: Declarados;
  leitura: {
    lida?: boolean;
    medicoes?: MedicaoLida[];
    elementos?: ElementoLido[];
    descartadas?: string[];
  };
}

/** As verificações que o perfil acrescenta, por grupo. */
export function verificacoesDoPerfil(e: EntradaPerfil): {
  documentos: Verificacao[];
  pdm: Verificacao[];
  desenhos: Verificacao[];
} {
  const zona = e.ponto ? zonaDe(e.ponto, e.zonas) : null;
  const parametros = zona ? parametrosDaZona(zona) : null;
  const iaLeu = Boolean(e.leitura.lida);
  const classe = verificarClasseEspaco({
    perfil: e.perfil,
    zona,
    parametros,
    declarados: e.declarados,
  });
  const medidas = verificarMedidas({
    perfil: e.perfil,
    zona,
    parametros,
    declarados: e.declarados,
    lidas: e.leitura.medicoes ?? [],
    ia_leu: iaLeu,
  });
  const descartadas = verificarDescartadas(e.leitura.descartadas ?? []);
  return {
    documentos: [verificarDocumentosPerfil(e.perfil, e.documentos)],
    pdm: [
      ...(classe ? [classe] : []),
      ...medidas.filter((x) => x.grupo === 'pdm'),
    ],
    desenhos: [
      ...medidas.filter((x) => x.grupo === 'desenhos'),
      ...verificarElementos({
        perfil: e.perfil,
        elementos: e.leitura.elementos ?? [],
        ia_leu: iaLeu,
        centro_historico: Boolean(parametros?.p.centro_historico),
      }),
      ...(descartadas ? [descartadas] : []),
    ],
  };
}

/** As medidas para os degraus do PDM (área e altura da obra), do requerimento. */
export function medidasParaPdm(
  perfil: Perfil | null,
  d: Declarados,
): { area_m2?: number; altura_m?: number } {
  if (!perfil) return {};
  const r: { area_m2?: number; altura_m?: number } = {};
  if (d.valores.area_obra_m2 !== undefined) r.area_m2 = d.valores.area_obra_m2;
  if (perfil === 'muro' && d.valores.altura_muro_m !== undefined)
    r.altura_m = d.valores.altura_muro_m;
  return r;
}

/** "Pronto para decisão": nada com falha, atenção ou por verificar. */
export function prontoParaDecisao(vs: Verificacao[]): boolean {
  return vs.length > 0 && vs.every((x) => x.estado === 'ok');
}
