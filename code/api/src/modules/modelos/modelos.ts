/*
 * Modelos de resposta aprovados pela câmara (funcionalidades, secção 12;
 * plano 4.5 `modelos_resposta`): ofícios, emails e SMS com variáveis entre
 * chavetas, preenchidas com os dados do processo.
 */

export const CANAIS_MODELO = ['oficio', 'email', 'sms'] as const;
export type CanalModelo = (typeof CANAIS_MODELO)[number];

/** Mais de 4 partes já não é um SMS (o corpo, antes de preencher). */
export const CORPO_SMS_MAX = 640;

export const ESTADOS_MODELO = [
  'rascunho',
  'a_rever',
  'aprovado',
  'substituido',
] as const;
export type EstadoModelo = (typeof ESTADOS_MODELO)[number];

/** As variáveis suportadas: `{nome}` no corpo → valor do processo. */
export const VARIAVEIS = {
  nome: {
    rotulo: 'nome do requerente',
    descricao: 'Nome do munícipe que fez o pedido.',
  },
  numero_processo: {
    rotulo: 'n.º do processo',
    descricao: 'Número do processo, por exemplo "CP 412/2026".',
  },
  tipo_processo: {
    rotulo: 'tipo de processo',
    descricao: 'Nome do tipo de processo, por exemplo "Comunicação prévia".',
  },
  morada: {
    rotulo: 'morada',
    descricao: 'Morada do processo (da obra ou do local).',
  },
  prazo: {
    rotulo: 'prazo',
    descricao:
      'Data limite (dd/mm/aaaa): a do pedido em aberto mais próximo; sem pedidos, o fim do prazo do processo.',
  },
  documentos_em_falta: {
    rotulo: 'documentos em falta',
    descricao:
      'Documentos e elementos que o requerente ainda tem de entregar, separados por vírgulas.',
  },
  link: {
    rotulo: 'link do processo',
    descricao:
      'Link curto para o munícipe acompanhar o processo e entregar documentos.',
  },
  data: {
    rotulo: 'data',
    descricao: 'Data de hoje por extenso, por exemplo "20 de outubro de 2026".',
  },
  municipio: {
    rotulo: 'município',
    descricao: 'Nome do município.',
  },
} as const;
export type Variavel = keyof typeof VARIAVEIS;
export const NOMES_VARIAVEIS = Object.keys(VARIAVEIS) as Variavel[];

function eVariavel(x: string): x is Variavel {
  return Object.hasOwn(VARIAVEIS, x);
}

const CHAVETAS = /\{([^{}\n]*)\}/g;

export interface AnaliseCorpo {
  /** As suportadas, pela ordem em que aparecem, sem repetidas. */
  variaveis: Variavel[];
  /** O que está entre chavetas e não é suportado, tal como está escrito. */
  desconhecidas: string[];
  /** Chavetas sem par ("{nome", "prazo}"). */
  chavetas_soltas: number;
  valido: boolean;
}

/** Que variáveis um corpo usa e o que está mal escrito. */
export function analisarCorpo(corpo: string): AnaliseCorpo {
  const variaveis: Variavel[] = [];
  const desconhecidas: string[] = [];
  const resto = corpo.replace(CHAVETAS, (m, nome: string) => {
    if (eVariavel(nome)) {
      if (!variaveis.includes(nome)) variaveis.push(nome);
    } else if (!desconhecidas.includes(m)) {
      desconhecidas.push(m);
    }
    return '';
  });
  const chavetas_soltas = (resto.match(/[{}]/g) ?? []).length;
  return {
    variaveis,
    desconhecidas,
    chavetas_soltas,
    valido: desconhecidas.length === 0 && chavetas_soltas === 0,
  };
}

export type Valores = Partial<Record<Variavel, string | null>>;

/**
 * Preenche as variáveis com os valores. Sem valor fica
 * "[a completar: <rótulo>]" e a variável vai para `em_falta`; o que não é
 * variável suportada fica como está.
 */
export function preencher(
  corpo: string,
  valores: Valores,
): { texto: string; em_falta: Variavel[] } {
  const em_falta: Variavel[] = [];
  const texto = corpo.replace(CHAVETAS, (m, nome: string) => {
    if (!eVariavel(nome)) return m;
    const v = valores[nome]?.trim();
    if (v) return v;
    if (!em_falta.includes(nome)) em_falta.push(nome);
    return `[a completar: ${VARIAVEIS[nome].rotulo}]`;
  });
  return { texto, em_falta };
}

/** "A", "A e B", "A, B e C". */
export function juntarLista(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/** '2026-11-15' → '15/11/2026'. */
export function dataCurta(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Data por extenso no fuso do município: '20 de outubro de 2026'. */
export function dataPorExtenso(d: Date, fuso: string): string {
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'long',
    timeZone: fuso,
  }).format(d);
}

/**
 * Estados: rascunho → a_rever → aprovado; a_rever → rascunho (devolvido).
 * Um aprovado não se edita: editar cria a versão seguinte em rascunho e,
 * quando essa for aprovada, o aprovado anterior passa a 'substituido'.
 */
const TRANSICOES: Record<EstadoModelo, EstadoModelo[]> = {
  rascunho: ['a_rever'],
  a_rever: ['rascunho', 'aprovado'],
  aprovado: [],
  substituido: [],
};

export function transicoesDe(de: EstadoModelo): EstadoModelo[] {
  return TRANSICOES[de];
}

export function podeTransitar(de: EstadoModelo, para: EstadoModelo): boolean {
  return de === para || TRANSICOES[de].includes(para);
}
