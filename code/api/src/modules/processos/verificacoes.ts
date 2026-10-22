/*
 * Verificações automáticas do apoio ao técnico (V2 · Apoio ao técnico,
 * bloco "VERIFICAÇÕES AUTOMÁTICAS"). Regras puras, sem BD nem IA, para
 * testar à parte:
 *
 * - PDM no local (regra): a zona do ponto, pelo mesmo motor do
 *   `o_que_posso_fazer` (`zonaDe`/`avaliarObra`), as condicionantes e se a
 *   operação do tipo de processo é admitida.
 * - Instrução do processo (regra): os documentos exigidos pelo tipo.
 * - Termo de responsabilidade (regra): entregue, válido, verificação.
 * - Técnico inscrito na Ordem (simulado): não há API pública da Ordem.
 * - Leitura do projeto (IA): o que o Claude viu nas folhas, a confirmar
 *   pelo técnico. A IA nunca dá um "ok" definitivo de algo legal.
 *
 * Os textos de sistema ficam em cache no ClaudeService: nada de datas, ids
 * ou nomes lá dentro.
 */
import { z } from 'zod';
import {
  CODIGOS_ELEMENTO,
  CODIGOS_GRANDEZA,
  Elemento,
  ELEMENTOS,
  Grandeza,
  GRANDEZAS,
  medicaoPlausivel,
  numeroPt,
  UNIDADES_LIDAS,
} from './medidas.js';
import {
  avaliarObra,
  Controlo,
  CONTROLO_DITO,
  dentro,
  Obra,
  OBRAS,
  Ponto,
  RegrasZona,
  zonaDe,
} from '../ordenamento/regras.js';

/** 'AAAA-MM-DD' → 'DD/MM/AAAA'. */
function diaPt(iso: string): string {
  return iso.split('-').reverse().join('/');
}

/** Sobe quando as regras deste ficheiro mudam (a cache deixa de servir). */
export const VERSAO_VERIFICACOES = '2';

export const ESTADOS_VERIFICACAO = [
  'ok',
  'atencao',
  'falha',
  'nao_verificavel',
] as const;
export type EstadoVerificacao = (typeof ESTADOS_VERIFICACAO)[number];

/** regra = determinística; ia = leitura do Claude (a confirmar); simulado = sem ligação real. */
export type OrigemVerificacao = 'regra' | 'ia' | 'simulado';

export interface Evidencia {
  tipo: 'documento' | 'regra';
  /** O que se mostra: 'Projeto de arquitetura, folha 3', 'PDM · ERC'. */
  rotulo: string;
  documento_id?: string | null;
  /** Página do PDF (1 = primeira), para abrir o documento no sítio certo. */
  pagina?: number | null;
  /** A folha como vem escrita no desenho ('3', 'A-02'). */
  folha?: string | null;
  url?: string | null;
}

/** Os grupos do bloco: documentos, PDM, desenhos (IA). */
export const GRUPOS_VERIFICACAO = ['documentos', 'pdm', 'desenhos'] as const;
export type GrupoVerificacao = (typeof GRUPOS_VERIFICACAO)[number];

/** Uma linha da tabela lido × declarado × permitido. */
export interface ValorComparado {
  grandeza: Grandeza;
  rotulo: string;
  /** 'm²', 'm', 'pisos', 'lugares'. */
  unidade: string;
  /** O que a IA leu nos desenhos (a confirmar), com a folha. */
  lido: { valor: number; evidencia: Evidencia | null } | null;
  /** O que o requerente declarou no requerimento. */
  declarado: number | null;
  /** O que o PDM permite (valores de demonstração enquanto a câmara não carrega os seus). */
  permitido: { valor: number; sentido: 'max' | 'min'; origem: string } | null;
}

export interface Verificacao {
  codigo: string;
  /** Sem grupo (verificações antigas): deduz-se do código. */
  grupo?: GrupoVerificacao;
  /** Só nas verificações com números. */
  valor?: ValorComparado | null;
  estado: EstadoVerificacao;
  titulo: string;
  detalhe: string;
  evidencias: Evidencia[];
  origem: OrigemVerificacao;
  /** Vem da IA (ou de uma simulação): o técnico tem de confirmar. */
  a_confirmar: boolean;
  /** Assenta em valores de demonstração (zonas do PDM, consulta simulada). */
  demonstracao: boolean;
  notas: string[];
}

export function novaVerificacao(
  x: Omit<
    Verificacao,
    'evidencias' | 'a_confirmar' | 'demonstracao' | 'notas'
  > &
    Partial<Verificacao>,
): Verificacao {
  return {
    evidencias: [],
    a_confirmar: x.origem !== 'regra',
    demonstracao: false,
    notas: [],
    ...x,
  };
}

function lista(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

function minuscula(t: string): string {
  return t.charAt(0).toLowerCase() + t.slice(1);
}

// ---------------------------------------------------------------------------
// Operação do processo (para o PDM)
// ---------------------------------------------------------------------------

const ORDEM_CONTROLO: Record<Controlo, number> = {
  isento: 0,
  comunicacao_previa: 1,
  licenca: 2,
  nao_permitido: 3,
};

/** O controlo que o tipo de processo representa (CP → comunicação prévia). */
export function controloDoTipo(tipo: {
  codigo: string;
  nome: string;
}): Controlo | null {
  const c = tipo.codigo.toUpperCase();
  const n = tipo.nome.toLowerCase();
  if (c === 'CP' || /comunica[cç][aã]o pr[eé]via/.test(n))
    return 'comunicacao_previa';
  if (
    ['LO', 'LU', 'LE'].includes(c) ||
    /licen[cç]a.*(obra|edifica|constru|urban)/.test(n)
  )
    return 'licenca';
  return null;
}

/**
 * A obra do PDM que o processo descreve, pelo texto (tipo, assunto e
 * descrição do requerimento). null se não se percebe: aí não se diz se o PDM
 * a admite.
 */
export function obraDoProcesso(texto: string): Obra | null {
  const t = texto.toLowerCase();
  if (/piscina/.test(t)) return 'piscina';
  if (/\bmuro|veda[cç][aã]o/.test(t)) return 'muro';
  if (/anexo|telheiro|arrumos|garagem/.test(t)) return 'anexo';
  if (/amplia/.test(t)) return 'ampliacao';
  if (/fachada|janela|exterior|pintar|varanda|cobertura|telhado/.test(t))
    return 'fachada';
  if (
    /interior|cozinha|parede|porta|sala|quarto|casa de banho|remodela|altera/.test(
      t,
    )
  )
    return 'interior';
  return null;
}

// ---------------------------------------------------------------------------
// 1. PDM no local
// ---------------------------------------------------------------------------

export interface ZonaParaVerificar {
  codigo: string;
  nome: string;
  categoria: string;
  descricao: string | null;
  poligono: Ponto[];
  regras: RegrasZona;
  fonte: { titulo: string; artigo: string | null; url: string | null };
  demonstracao: boolean;
}

export interface EntradaPdm {
  ponto: Ponto | null;
  /** Porque não há ponto ('O processo não tem morada.'). */
  sem_ponto?: string;
  zonas: ZonaParaVerificar[];
  obra: Obra | null;
  tipo: { codigo: string; nome: string };
  /** As medidas da obra (do requerimento), para os degraus do PDM. */
  medidas?: { area_m2?: number; altura_m?: number };
}

const CATEGORIAS_COM_CONDICIONANTES = ['protecao', 'agricola', 'florestal'];

export function verificarPdm(e: EntradaPdm): Verificacao {
  const base = { codigo: 'pdm', origem: 'regra' as const };
  const titulo = 'PDM no local: por verificar';
  if (!e.zonas.length) {
    return novaVerificacao({
      ...base,
      estado: 'nao_verificavel',
      titulo,
      detalhe: 'O PDM ainda não está carregado nesta câmara.',
    });
  }
  if (!e.ponto) {
    return novaVerificacao({
      ...base,
      estado: 'nao_verificavel',
      titulo,
      detalhe: e.sem_ponto ?? 'O processo não tem coordenadas.',
    });
  }
  const zona = zonaDe(e.ponto, e.zonas);
  if (!zona) {
    return novaVerificacao({
      ...base,
      estado: 'nao_verificavel',
      titulo,
      detalhe: 'A morada fica fora das zonas do PDM carregadas.',
      demonstracao: e.zonas.some((z) => z.demonstracao),
    });
  }

  const evidencias: Evidencia[] = [
    {
      tipo: 'regra',
      rotulo: `${zona.fonte.titulo}${zona.fonte.artigo ? `, ${zona.fonte.artigo}` : ''} · ${zona.nome} (${zona.codigo})`,
      url: zona.fonte.url,
    },
  ];
  const comum = {
    ...base,
    evidencias,
    demonstracao: zona.demonstracao,
  };
  const a = e.obra ? avaliarObra(zona.regras[e.obra], e.medidas ?? {}) : null;
  const notas = [...(a?.notas ?? [])];
  const pedido = controloDoTipo(e.tipo);
  const obraDita = e.obra ? minuscula(OBRAS[e.obra]) : null;

  if (zona.categoria === 'protecao') {
    return novaVerificacao({
      ...comum,
      estado: 'atencao',
      titulo: `Condicionantes no local: ${zona.nome}`,
      detalhe:
        zona.descricao ??
        'Zona de proteção: confirmar os pareceres que a obra precisa.',
      notas,
    });
  }
  if (a?.controlo === 'nao_permitido') {
    return novaVerificacao({
      ...comum,
      estado: 'falha',
      titulo: 'O PDM não admite esta obra no local',
      detalhe: `${zona.nome}: ${obraDita} não é permitido nesta zona.`,
      notas,
    });
  }
  if (
    a?.controlo &&
    pedido &&
    ORDEM_CONTROLO[a.controlo] > ORDEM_CONTROLO[pedido]
  ) {
    return novaVerificacao({
      ...comum,
      estado: 'atencao',
      titulo: `O PDM pede ${a.controlo === 'licenca' ? 'licença' : 'mais'} no local`,
      detalhe: `${zona.nome}: para ${obraDita}, ${CONTROLO_DITO[a.controlo]}; este processo é ${minuscula(e.tipo.nome)}.`,
      notas,
    });
  }
  if (a?.em_falta.length) {
    return novaVerificacao({
      ...comum,
      estado: 'atencao',
      titulo: 'PDM: faltam medidas para decidir',
      detalhe: `${zona.nome}: o que o PDM admite depende ${a.em_falta.includes('area_m2') ? 'da área' : 'da altura'} da obra.`,
      notas: [...notas, ...a.limites],
    });
  }
  if (CATEGORIAS_COM_CONDICIONANTES.includes(zona.categoria)) {
    return novaVerificacao({
      ...comum,
      estado: 'atencao',
      titulo: `Condicionantes no local: ${zona.nome}`,
      detalhe:
        zona.descricao ?? `Zona ${zona.categoria}: ver as condicionantes.`,
      notas,
    });
  }

  // Sem condicionantes: diz-se também que fica fora da zona de proteção.
  const protecao = e.zonas.find(
    (z) => z.categoria === 'protecao' && !dentro(e.ponto!, z.poligono),
  );
  if (!e.obra) {
    notas.push(
      'Não se percebeu o tipo de obra pelo processo: o que o PDM admite fica por confirmar.',
    );
  } else if (!a?.controlo) {
    notas.push(
      `O PDM carregado não tem regra para ${obraDita} nesta zona: confirmar.`,
    );
  }
  return novaVerificacao({
    ...comum,
    estado: 'ok',
    titulo: 'Sem condicionantes do PDM no local',
    detalhe: protecao
      ? `${zona.nome}, fora do ${protecao.nome.toLowerCase()}`
      : zona.nome,
    notas,
  });
}

// ---------------------------------------------------------------------------
// 2. Instrução do processo
// ---------------------------------------------------------------------------

export interface EntradaInstrucao {
  tipo_nome: string;
  /** Quantos documentos o tipo exige (obrigatórios, não gerados pelo sistema). */
  exigidos: number;
  /** De `ProcessosService.emFalta`: o que já há e o que falta (pedidos incluídos). */
  tem: string[];
  faltam: string[];
}

export function verificarInstrucao(e: EntradaInstrucao): Verificacao {
  const base = {
    codigo: 'instrucao',
    origem: 'regra' as const,
    evidencias: [
      {
        tipo: 'regra' as const,
        rotulo: `Documentos exigidos para ${minuscula(e.tipo_nome)}`,
      },
    ],
  };
  if (e.exigidos === 0 && e.faltam.length === 0) {
    return novaVerificacao({
      ...base,
      estado: 'nao_verificavel',
      titulo: 'Instrução do processo: por verificar',
      detalhe:
        'O tipo de processo não tem documentos exigidos configurados (Tipos de processo).',
    });
  }
  if (e.faltam.length === 0) {
    return novaVerificacao({
      ...base,
      estado: 'ok',
      titulo: 'Processo instruído com todos os elementos',
      detalhe: e.tem.length ? `Entregues: ${lista(e.tem)}.` : 'Nada em falta.',
    });
  }
  const n = e.faltam.length;
  return novaVerificacao({
    ...base,
    estado: 'falha',
    titulo: n === 1 ? 'Falta 1 elemento' : `Faltam ${n} elementos`,
    detalhe: `${lista(e.faltam)}.`,
  });
}

// ---------------------------------------------------------------------------
// 3. Termo de responsabilidade
// ---------------------------------------------------------------------------

export interface DocumentoVerificado {
  id: string;
  nome: string;
  verificacao_estado: string;
  verificacao: unknown;
  /** 'AAAA-MM-DD' */
  emitido_em: string | null;
  recebido_em: Date | string;
}

export const TERMO = /termo\s+de\s+responsabilidade/i;

/** 'AAAA-MM-DD' + n meses (dia limitado ao fim do mês). */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const fim = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(d, fim)).padStart(2, '0')}`;
}

function regrasDaVerificacao(
  x: unknown,
): { regra: string; ok: boolean; detalhe: string | null }[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter(
      (y): y is { regra?: unknown; ok?: unknown; detalhe?: unknown } =>
        typeof y === 'object' && y !== null,
    )
    .filter((y) => typeof y.regra === 'string' && typeof y.ok === 'boolean')
    .map((y) => ({
      regra: y.regra as string,
      ok: y.ok as boolean,
      detalhe: typeof y.detalhe === 'string' ? y.detalhe : null,
    }));
}

function diaIso(d: Date | string): string {
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(d).toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Lisbon',
  });
}

export function verificarTermo(e: {
  documento: DocumentoVerificado | null;
  /** Validade configurada no tipo ({"tipo":"validade","meses":N}); null = sem validade definida. */
  validade_meses: number | null;
  hoje: string;
  /** Da leitura da IA: se viu a assinatura no termo (null = não se sabe). */
  assinado_ia?: boolean | null;
}): Verificacao {
  const d = e.documento;
  const base = { codigo: 'termo', origem: 'regra' as const };
  if (!d) {
    return novaVerificacao({
      ...base,
      estado: 'falha',
      titulo: 'Termo de responsabilidade em falta',
      detalhe: 'Não há termo de responsabilidade do técnico autor no processo.',
    });
  }
  const evidencias: Evidencia[] = [
    { tipo: 'documento', rotulo: d.nome, documento_id: d.id, pagina: null },
  ];
  const comum = { ...base, evidencias };
  const entregue = `Entregue a ${diaPt(diaIso(d.recebido_em))}`;
  const emitido = d.emitido_em ? `emitido a ${diaPt(d.emitido_em)}` : null;

  if (d.verificacao_estado === 'documento_errado') {
    return novaVerificacao({
      ...comum,
      estado: 'falha',
      titulo: 'O termo entregue não é o documento certo',
      detalhe: `${entregue}: a verificação diz que não é um termo de responsabilidade.`,
    });
  }
  if (d.verificacao_estado === 'ilegivel') {
    return novaVerificacao({
      ...comum,
      estado: 'falha',
      titulo: 'Termo de responsabilidade ilegível',
      detalhe: `${entregue}: é preciso pedir outra cópia.`,
    });
  }
  const caducaEm =
    e.validade_meses && d.emitido_em
      ? somarMeses(d.emitido_em, e.validade_meses)
      : null;
  if (
    d.verificacao_estado === 'fora_de_prazo' ||
    (caducaEm !== null && caducaEm < e.hoje)
  ) {
    return novaVerificacao({
      ...comum,
      estado: 'falha',
      titulo: 'Termo de responsabilidade caducado',
      detalhe: [
        emitido ? emitido.replace(/^./, (c) => c.toUpperCase()) : entregue,
        caducaEm
          ? `valia até ${diaPt(caducaEm)}`
          : 'a verificação diz que está fora de prazo',
      ].join('; '),
    });
  }
  const regras = regrasDaVerificacao(d.verificacao);
  const falhas = regras.filter((r) => !r.ok);
  if (falhas.length) {
    return novaVerificacao({
      ...comum,
      estado: 'atencao',
      titulo: 'Termo de responsabilidade: confirmar',
      detalhe: falhas
        .map((f) => (f.detalhe ? `${f.regra}: ${f.detalhe}` : f.regra))
        .join('; '),
    });
  }
  const assinaturaOk = regras.some((r) => r.regra === 'assinatura' && r.ok);
  const partes = [entregue, emitido].filter(Boolean) as string[];
  if (d.verificacao_estado === 'valido') {
    if (assinaturaOk) partes.push('assinatura verificada');
    else if (e.assinado_ia) partes.push('assinatura visível (IA, a confirmar)');
    if (caducaEm) partes.push(`válido até ${diaPt(caducaEm)}`);
    return novaVerificacao({
      ...comum,
      estado: 'ok',
      titulo: 'Termo de responsabilidade válido',
      detalhe: `${partes.join(' · ')}.`,
    });
  }
  // por_verificar
  if (e.assinado_ia === false) {
    partes.push('a IA não viu assinatura');
  }
  return novaVerificacao({
    ...comum,
    estado: 'atencao',
    titulo: 'Termo de responsabilidade por verificar',
    detalhe: `${partes.join(' · ')}; o documento ainda não foi verificado.`,
  });
}

// ---------------------------------------------------------------------------
// 4. Técnico inscrito na Ordem (adaptador; nesta versão, simulado)
// ---------------------------------------------------------------------------

export const ORDENS = ['OA', 'OE', 'OET', 'desconhecida'] as const;
export type Ordem = (typeof ORDENS)[number];

export const ORDEM_NOME: Record<Ordem, string> = {
  OA: 'Ordem dos Arquitectos',
  OE: 'Ordem dos Engenheiros',
  OET: 'Ordem dos Engenheiros Técnicos',
  desconhecida: 'Ordem',
};

export interface DadosTecnico {
  nome: string | null;
  ordem: Ordem;
  numero_inscricao: string | null;
}

export interface ResultadoOrdem {
  estado: 'inscrito' | 'nao_inscrito' | 'suspenso' | 'numero_invalido';
  /** true: não houve consulta real à Ordem. */
  simulado: boolean;
  fonte: string;
}

/**
 * Consulta da inscrição do técnico na Ordem. Não há API pública da Ordem
 * dos Arquitectos nem da dos Engenheiros: quando houver (ou um acordo), uma
 * implementação real substitui a simulada no módulo (token VERIFICADOR_ORDEM).
 */
export interface VerificadorOrdem {
  consultar(t: DadosTecnico): Promise<ResultadoOrdem>;
}

export const VERIFICADOR_ORDEM = 'VERIFICADOR_ORDEM';

/**
 * Simulação: só confirma que o número tem o formato de uma inscrição (3 a 6
 * algarismos, com uma letra no fim, opcional). Diz sempre que é simulada:
 * nunca se apresenta como verificada a sério.
 */
export class OrdemSimulada implements VerificadorOrdem {
  consultar(t: DadosTecnico): Promise<ResultadoOrdem> {
    const n = (t.numero_inscricao ?? '').replace(/\s+/g, '');
    return Promise.resolve({
      estado: /^\d{3,6}[A-Z]?$/i.test(n) ? 'inscrito' : 'numero_invalido',
      simulado: true,
      fonte: 'Consulta simulada (sem ligação à Ordem)',
    });
  }
}

export function verificarOrdem(
  t: DadosTecnico | null,
  r: ResultadoOrdem | null,
  evidencias: Evidencia[] = [],
  motivo?: string,
): Verificacao {
  const base = {
    codigo: 'ordem',
    origem: (r?.simulado === false ? 'regra' : 'simulado') as OrigemVerificacao,
    evidencias,
  };
  if (!t || !t.numero_inscricao || !r) {
    return novaVerificacao({
      ...base,
      origem: 'regra',
      a_confirmar: false,
      estado: 'nao_verificavel',
      titulo: 'Técnico inscrito na Ordem: por verificar',
      detalhe:
        motivo ??
        'Não se leu o nome e o n.º de inscrição do técnico autor nos documentos.',
    });
  }
  const quem = `${t.nome ?? 'Técnico autor'}, ${ORDEM_NOME[t.ordem]} n.º ${t.numero_inscricao}`;
  const notas = r.simulado
    ? [`${r.fonte}: confirmar no site da ${ORDEM_NOME[t.ordem]}.`]
    : [r.fonte];
  const comum = {
    ...base,
    demonstracao: r.simulado,
    a_confirmar: r.simulado,
    notas,
  };
  switch (r.estado) {
    case 'inscrito':
      return novaVerificacao({
        ...comum,
        estado: 'ok',
        titulo: 'Técnico inscrito na Ordem',
        detalhe: quem,
      });
    case 'numero_invalido':
      return novaVerificacao({
        ...comum,
        estado: 'atencao',
        titulo: 'N.º de inscrição na Ordem por confirmar',
        detalhe: `${quem}: o número não tem o formato de uma inscrição.`,
      });
    case 'suspenso':
    case 'nao_inscrito':
      return novaVerificacao({
        ...comum,
        estado: r.simulado ? 'atencao' : 'falha',
        titulo:
          r.estado === 'suspenso'
            ? 'Inscrição do técnico suspensa'
            : 'Técnico sem inscrição na Ordem',
        detalhe: quem,
      });
  }
}

// ---------------------------------------------------------------------------
// 5. Leitura do projeto pela IA
// ---------------------------------------------------------------------------

/** Os documentos que se mandam ao Claude: o projeto e as peças à volta. */
export const PROJETO =
  /projeto|arquitetura|arquitectura|planta|al[cç]ado|corte|mem[oó]ria|desenho|pe[cç]as/i;

/** Limites do que se manda à IA (a API aceita 32 MB por pedido). */
export const MAX_FICHEIROS_IA = 5;
export const MAX_BYTES_IA = 20 * 1024 * 1024;

const referencia = z
  .object({
    documento: z
      .number()
      .int()
      .describe('O número do documento na lista (1 = o primeiro).'),
    pagina: z
      .number()
      .int()
      .nullable()
      .describe(
        'A página do PDF onde se vê (1 = a primeira); null se é uma imagem.',
      ),
    folha: z
      .string()
      .nullable()
      .describe(
        'O número da folha como está escrito no desenho ou no rodapé ("3", "A-02"); null se não tem.',
      ),
  })
  .describe('Onde se vê, para o técnico abrir o documento no sítio certo.');

export const esquemaLeituraProjeto = z.object({
  legivel: z
    .boolean()
    .describe(
      'Se os documentos se leem o suficiente para responder (não estão em branco, cortados nem ilegíveis).',
    ),
  motivo_ilegivel: z
    .string()
    .nullable()
    .describe('Se não se leem, porquê, numa frase; null se se leem.'),
  fachada_cobertura: z.object({
    alteracoes: z
      .enum(['nao', 'sim', 'incerto'])
      .describe(
        'Se o projeto altera a fachada ou a cobertura (alçados, vãos exteriores, telhado, cores, materiais).',
      ),
    descricao: z
      .string()
      .describe('Uma frase: o que se vê nos alçados ou o que muda.'),
    referencia: referencia.nullable(),
  }),
  paredes: z.object({
    abertura_ou_demolicao: z
      .enum(['nao', 'sim', 'incerto'])
      .describe(
        'Se o projeto abre vãos ou demole paredes (interiores ou exteriores).',
      ),
    declarada_nao_estrutural: z
      .boolean()
      .describe(
        'Se a memória descritiva ou os desenhos dizem que a parede a abrir não é estrutural.',
      ),
    descricao: z.string().describe('Uma frase: que parede, onde, que vão.'),
    referencia: referencia.nullable(),
  }),
  planta_estruturas: z.object({
    existe: z
      .boolean()
      .describe(
        'Se há planta ou projeto de estruturas (estabilidade) entre os documentos.',
      ),
    referencia: referencia.nullable(),
  }),
  areas_cerceas: z.object({
    coerentes: z
      .enum(['sim', 'nao', 'sem_dados'])
      .describe(
        'Se as áreas e cérceas declaradas (memória, quadros) batem certo com as desenhadas. sem_dados se o projeto não as indica.',
      ),
    descricao: z
      .string()
      .describe('Uma frase com os valores lidos, se houver.'),
    referencia: referencia.nullable(),
  }),
  contradicoes: z
    .array(
      z.object({
        descricao: z
          .string()
          .describe(
            'A contradição entre a memória descritiva e os desenhos, numa frase.',
          ),
        referencia: referencia.nullable(),
      }),
    )
    .describe(
      'Contradições entre peças escritas e desenhadas. Lista vazia se não há.',
    ),
  medicoes: z
    .array(
      z.object({
        grandeza: z
          .enum(CODIGOS_GRANDEZA)
          .describe('Qual das medidas pedidas é.'),
        valor: z
          .number()
          .describe('O número como está escrito ou cotado no desenho.'),
        unidade: z
          .enum(UNIDADES_LIDAS)
          .describe('A unidade como está no desenho (m2 para m²).'),
        referencia: referencia.nullable(),
      }),
    )
    .describe(
      'Só as medidas pedidas no pedido, quando estão escritas ou cotadas nos desenhos ou quadros. Lista vazia se não há.',
    ),
  elementos: z
    .array(
      z.object({
        elemento: z
          .enum(CODIGOS_ELEMENTO)
          .describe('Qual dos elementos pedidos é.'),
        resposta: z.enum(['sim', 'nao', 'incerto']),
        descricao: z
          .string()
          .describe('Uma frase: o que se vê (ou porque não se sabe).'),
        referencia: referencia.nullable(),
      }),
    )
    .describe(
      'Só os elementos pedidos no pedido, um por elemento. Lista vazia se não se pede nenhum.',
    ),
  tecnico_autor: z
    .object({
      nome: z.string().nullable(),
      ordem: z
        .enum(ORDENS)
        .describe('OA arquitetos, OE engenheiros, OET engenheiros técnicos.'),
      numero_inscricao: z
        .string()
        .nullable()
        .describe('O n.º de inscrição na Ordem, como está escrito.'),
      termo_assinado: z
        .boolean()
        .nullable()
        .describe(
          'Se o termo de responsabilidade tem assinatura visível; null se não há termo.',
        ),
      referencia: referencia.nullable(),
    })
    .nullable()
    .describe(
      'O técnico autor do projeto, como aparece no termo ou na memória; null se não aparece.',
    ),
});

export type LeituraProjeto = z.output<typeof esquemaLeituraProjeto>;

export const SISTEMA_LEITURA_PROJETO = `És assistente de um técnico de urbanismo de uma câmara municipal portuguesa.
Recebes os documentos de um processo de obras (projeto de arquitetura: memória descritiva, plantas, alçados, cortes, termo de responsabilidade), numerados, e o tipo de operação.
Lê todas as páginas e responde só com o que se vê nos documentos, para o técnico confirmar.

Regras:
- Não inventes: se algo não aparece, diz "incerto", "sem_dados" ou null. Não deduzas o que não está desenhado nem escrito.
- Uma parede só é "não estrutural" se o projeto o disser. Uma planta de estruturas é uma peça própria (estabilidade, betão, vigas); não confundas com a planta de arquitetura.
- Em cada referência, indica o documento, a página do PDF e a folha como está escrita no desenho.
- Em "medicoes", só as medidas que o pedido lista, e só números escritos ou cotados nos desenhos ou nos quadros de áreas. Não meças à escala, não somes nem calcules. Se a memória e o desenho dão números diferentes, usa o do desenho e regista a diferença em "contradicoes".
- Em "elementos", responde a cada elemento que o pedido lista (e só a esses), com "incerto" se não se vê.
- As descrições são para o técnico: português de Portugal, frases curtas e concretas.
- Não dês pareceres nem digas se a obra é legal: só o que os documentos mostram.`;

export interface DocumentoLido {
  id: string;
  nome: string;
}

function evidenciaDe(
  r: z.output<typeof referencia> | null | undefined,
  docs: DocumentoLido[],
): Evidencia[] {
  if (!r) return [];
  const d = docs[r.documento - 1];
  if (!d) return [];
  const folha = r.folha?.trim() || null;
  const pagina = r.pagina && r.pagina > 0 ? r.pagina : null;
  return [
    {
      tipo: 'documento',
      documento_id: d.id,
      pagina,
      folha,
      rotulo: folha
        ? `${d.nome}, folha ${folha.replace(/^folha\s*/i, '')}`
        : pagina
          ? `${d.nome}, página ${pagina}`
          : d.nome,
    },
  ];
}

const limpar = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Sem leitura (sem IA, sem documento, resposta inválida): uma linha a dizer porquê. */
export function leituraNaoVerificavel(motivo: string): Verificacao {
  return novaVerificacao({
    codigo: 'ia_leitura',
    origem: 'ia',
    a_confirmar: false,
    estado: 'nao_verificavel',
    titulo: 'Leitura do projeto pela IA: por fazer',
    detalhe: motivo,
  });
}

/** Um número lido pela IA, já validado (unidade e plausibilidade). */
export interface MedicaoLida {
  grandeza: Grandeza;
  valor: number;
  evidencia: Evidencia | null;
}

/** A resposta da IA sobre um elemento pedido (casa das máquinas, amianto...). */
export interface ElementoLido {
  elemento: Elemento;
  resposta: 'sim' | 'nao' | 'incerto';
  descricao: string;
  evidencias: Evidencia[];
}

export interface ResultadoLeitura {
  /** Pela ordem do design: fachada primeiro, paredes e o resto no fim. */
  antes: Verificacao[];
  depois: Verificacao[];
  tecnico: DadosTecnico | null;
  tecnico_evidencias: Evidencia[];
  termo_assinado: boolean | null;
  /** A IA leu o projeto (há resposta válida). */
  lida?: boolean;
  medicoes?: MedicaoLida[];
  elementos?: ElementoLido[];
  /** Números da IA postos de parte (unidade errada, implausíveis, repetidos). */
  descartadas?: string[];
}

const SEM_LEITURA = (motivo: string): ResultadoLeitura => ({
  antes: [],
  depois: [leituraNaoVerificavel(motivo)],
  tecnico: null,
  tecnico_evidencias: [],
  termo_assinado: null,
  lida: false,
  medicoes: [],
  elementos: [],
  descartadas: [],
});

/** O que o tipo de operação muda na leitura (ver `perfis-verificacao.ts`). */
export interface OpcoesLeitura {
  /** A operação mexe no exterior de propósito (ampliação, fachada...): a alteração não é um aviso. */
  fachada_esperada?: boolean;
  /** Ver aberturas e demolições de paredes (não em piscinas nem muros). */
  paredes?: boolean;
  /** Há a tabela de números: a linha geral "áreas e cérceas" não se mostra. */
  com_medidas?: boolean;
}

/** As leituras guardadas antes da V4 não tinham medições nem elementos. */
function comListas(bruto: unknown): unknown {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return bruto;
  const b = bruto as Record<string, unknown>;
  return { ...b, medicoes: b.medicoes ?? [], elementos: b.elementos ?? [] };
}

/**
 * A resposta da IA validada e passada a verificações. Nunca um "ok" legal:
 * o melhor que a IA dá é "sem alterações detetadas", a confirmar. Uma
 * resposta fora do esquema dá uma linha não verificável. Os números lidos
 * passam pela plausibilidade antes de se compararem.
 */
export function interpretarLeitura(
  bruto: unknown,
  docs: DocumentoLido[],
  opcoes: OpcoesLeitura = {},
): ResultadoLeitura {
  const p = esquemaLeituraProjeto.safeParse(comListas(bruto));
  if (!p.success) {
    return SEM_LEITURA(
      'A resposta da IA não veio no formato pedido: tente gerar outra vez.',
    );
  }
  const l = p.data;
  if (!l.legivel) {
    return SEM_LEITURA(
      l.motivo_ilegivel
        ? `A IA não conseguiu ler o projeto: ${minuscula(limpar(l.motivo_ilegivel))}`
        : 'A IA não conseguiu ler o projeto.',
    );
  }
  const ia = { origem: 'ia' as const, a_confirmar: true };
  const antes: Verificacao[] = [];
  const depois: Verificacao[] = [];

  // Fachada e cobertura.
  const f = l.fachada_cobertura;
  const evF = evidenciaDe(f.referencia, docs);
  if (f.alteracoes === 'nao') {
    antes.push(
      novaVerificacao({
        ...ia,
        codigo: 'ia_fachada',
        estado: 'ok',
        titulo: 'Fachada e cobertura sem alterações',
        detalhe: evF[0]?.rotulo ?? limpar(f.descricao),
        evidencias: evF,
        notas: [
          `Sem alterações detetadas pela IA (${minuscula(limpar(f.descricao))}): a confirmar.`,
        ],
      }),
    );
  } else if (f.alteracoes === 'sim' && opcoes.fachada_esperada) {
    antes.push(
      novaVerificacao({
        ...ia,
        codigo: 'ia_fachada',
        estado: 'ok',
        titulo: 'Alterações no exterior próprias da operação',
        detalhe: limpar(f.descricao),
        evidencias: evF,
        notas: ['Detetado pela IA: a confirmar.'],
      }),
    );
  } else {
    antes.push(
      novaVerificacao({
        ...ia,
        codigo: 'ia_fachada',
        estado: 'atencao',
        titulo:
          f.alteracoes === 'sim'
            ? 'Alterações na fachada ou na cobertura'
            : 'Fachada e cobertura: confirmar',
        detalhe: limpar(f.descricao),
        evidencias: evF,
      }),
    );
  }

  // Paredes a abrir e estrutura (não em piscinas nem muros).
  const pa = l.paredes;
  const evP = [
    ...evidenciaDe(pa.referencia, docs),
    ...evidenciaDe(l.planta_estruturas.referencia, docs),
  ];
  const verParedes = opcoes.paredes ?? true;
  if (
    verParedes &&
    pa.abertura_ou_demolicao === 'sim' &&
    !l.planta_estruturas.existe
  ) {
    depois.push(
      novaVerificacao({
        ...ia,
        codigo: 'ia_paredes',
        estado: 'atencao',
        titulo: 'Parede a abrir: confirmar que não é estrutural',
        detalhe: pa.declarada_nao_estrutural
          ? 'O projeto diz “não estrutural”, mas não há planta de estruturas'
          : 'O projeto não diz se a parede é estrutural e não há planta de estruturas',
        evidencias: evP,
        notas: [limpar(pa.descricao)],
      }),
    );
  } else if (verParedes && pa.abertura_ou_demolicao === 'sim') {
    depois.push(
      novaVerificacao({
        ...ia,
        codigo: 'ia_paredes',
        estado: 'ok',
        titulo: 'Parede a abrir com planta de estruturas',
        detalhe: limpar(pa.descricao),
        evidencias: evP,
        notas: ['Detetado pela IA: a confirmar.'],
      }),
    );
  } else if (verParedes && pa.abertura_ou_demolicao === 'incerto') {
    depois.push(
      novaVerificacao({
        ...ia,
        codigo: 'ia_paredes',
        estado: 'atencao',
        titulo: 'Paredes: confirmar se há aberturas ou demolições',
        detalhe: limpar(pa.descricao),
        evidencias: evP,
      }),
    );
  }

  // Áreas e cérceas (só se o projeto as indica e não há a tabela de números).
  const ac = l.areas_cerceas;
  if (ac.coerentes !== 'sem_dados' && !opcoes.com_medidas) {
    depois.push(
      novaVerificacao({
        ...ia,
        codigo: 'ia_areas',
        estado: ac.coerentes === 'sim' ? 'ok' : 'atencao',
        titulo:
          ac.coerentes === 'sim'
            ? 'Áreas e cérceas coerentes com os desenhos'
            : 'Áreas ou cérceas não batem certo',
        detalhe: limpar(ac.descricao),
        evidencias: evidenciaDe(ac.referencia, docs),
      }),
    );
  }

  l.contradicoes.slice(0, 3).forEach((c, i) => {
    depois.push(
      novaVerificacao({
        ...ia,
        codigo: `ia_contradicao_${i + 1}`,
        estado: 'atencao',
        titulo: 'Memória descritiva e desenhos não batem certo',
        detalhe: limpar(c.descricao),
        evidencias: evidenciaDe(c.referencia, docs),
      }),
    );
  });

  // Números lidos: plausibilidade e um por grandeza (o primeiro).
  const medicoes: MedicaoLida[] = [];
  const descartadas: string[] = [];
  for (const m of l.medicoes) {
    const pl = medicaoPlausivel(m.grandeza, m.valor, m.unidade);
    if (!pl.ok) {
      descartadas.push(pl.motivo);
      continue;
    }
    const ja = medicoes.find((x) => x.grandeza === m.grandeza);
    if (ja) {
      if (Math.abs(ja.valor - pl.valor) > 1e-6) {
        descartadas.push(
          `${GRANDEZAS[m.grandeza].rotulo}: a IA leu dois valores (${numeroPt(ja.valor)} e ${numeroPt(pl.valor)}); ficou o primeiro`,
        );
      }
      continue;
    }
    medicoes.push({
      grandeza: m.grandeza,
      valor: pl.valor,
      evidencia: evidenciaDe(m.referencia, docs)[0] ?? null,
    });
  }
  const elementos: ElementoLido[] = [];
  for (const e of l.elementos) {
    if (elementos.some((x) => x.elemento === e.elemento)) continue;
    elementos.push({
      elemento: e.elemento,
      resposta: e.resposta,
      descricao: limpar(e.descricao),
      evidencias: evidenciaDe(e.referencia, docs),
    });
  }

  const t = l.tecnico_autor;
  return {
    antes,
    depois,
    tecnico:
      t && (t.nome || t.numero_inscricao)
        ? {
            nome: t.nome ? limpar(t.nome) : null,
            ordem: t.ordem,
            numero_inscricao: t.numero_inscricao
              ? limpar(t.numero_inscricao)
              : null,
          }
        : null,
    tecnico_evidencias: evidenciaDe(t?.referencia, docs),
    termo_assinado: t?.termo_assinado ?? null,
    lida: true,
    medicoes,
    elementos,
    descartadas,
  };
}

/** O que o tipo de operação pede à IA (vai no pedido, não no texto de sistema). */
export interface PedidoPerfil {
  nome: string;
  procurar: string[];
  grandezas: Grandeza[];
  elementos: Elemento[];
}

/** O que vai ao Claude com os ficheiros: a lista numerada e o caso. */
export function conteudoLeitura(d: {
  tipo: string;
  assunto: string;
  descricao: string;
  documentos: { nome: string; mime: string }[];
  perfil?: PedidoPerfil | null;
}): string {
  const p = d.perfil;
  return [
    `Tipo de operação: ${d.tipo}`,
    `Assunto: ${d.assunto}`,
    d.descricao ? `Descrição do requerente: ${d.descricao}` : '',
    '',
    'Documentos (pela ordem em que seguem):',
    ...d.documentos.map(
      (x, i) =>
        `${i + 1}. ${x.nome} (${x.mime === 'application/pdf' ? 'PDF' : 'imagem'})`,
    ),
    ...(p
      ? [
          '',
          `Operação a analisar: ${p.nome}.`,
          ...(p.procurar.length
            ? [
                'O que procurar nos desenhos:',
                ...p.procurar.map((x) => `- ${x}`),
              ]
            : []),
          p.grandezas.length
            ? `Medidas a ler (em "medicoes", pelo código): ${p.grandezas
                .map((g) => `${g} (${GRANDEZAS[g].rotulo.toLowerCase()})`)
                .join('; ')}.`
            : 'Medidas a ler: nenhuma (deixa "medicoes" vazia).',
          p.elementos.length
            ? `Elementos a responder (em "elementos", pelo código): ${p.elementos
                .map((e) => `${e} (${ELEMENTOS[e].pergunta})`)
                .join('; ')}`
            : 'Elementos a responder: nenhum (deixa "elementos" vazia).',
        ]
      : []),
  ]
    .filter((x) => x !== '')
    .join('\n');
}

// ---------------------------------------------------------------------------
// Juntar e usar
// ---------------------------------------------------------------------------

/** O grupo de uma verificação pelo código (as antigas não o traziam). */
export function grupoDe(
  x: Pick<Verificacao, 'codigo' | 'grupo'>,
): GrupoVerificacao {
  if (x.grupo) return x.grupo;
  if (['instrucao', 'termo', 'ordem', 'perfil_documentos'].includes(x.codigo))
    return 'documentos';
  if (x.codigo === 'pdm' || x.codigo.startsWith('pdm_')) return 'pdm';
  return 'desenhos';
}

/**
 * A ordem do design: fachada (IA), instrução, termo, Ordem, PDM, o resto da
 * IA. As do tipo de operação entram no seu sítio: documentos a seguir à
 * instrução, PDM e números a seguir ao PDM, elementos no fim.
 */
export function juntarVerificacoes(p: {
  leitura: ResultadoLeitura;
  instrucao: Verificacao;
  termo: Verificacao;
  ordem: Verificacao;
  pdm: Verificacao;
  documentos_perfil?: Verificacao[];
  pdm_perfil?: Verificacao[];
  desenhos_perfil?: Verificacao[];
}): Verificacao[] {
  return [
    ...p.leitura.antes,
    p.instrucao,
    ...(p.documentos_perfil ?? []),
    p.termo,
    p.ordem,
    p.pdm,
    ...(p.pdm_perfil ?? []),
    ...p.leitura.depois,
    ...(p.desenhos_perfil ?? []),
  ].map((x) => ({ ...x, grupo: grupoDe(x) }));
}

export function contagem(vs: Verificacao[]): Record<EstadoVerificacao, number> {
  const r = { ok: 0, atencao: 0, falha: 0, nao_verificavel: 0 };
  for (const x of vs) r[x.estado]++;
  return r;
}

const ESTADO_DITO: Record<EstadoVerificacao, string> = {
  ok: 'ok',
  atencao: 'ATENÇÃO',
  falha: 'FALHA',
  nao_verificavel: 'não verificável',
};

const ORIGEM_DITA: Record<OrigemVerificacao, string> = {
  regra: 'regra',
  ia: 'leitura da IA, a confirmar pelo técnico',
  simulado: 'consulta simulada',
};

/** As verificações em texto, para o contexto dos rascunhos. */
export function verificacoesEmTexto(vs: Verificacao[]): string {
  if (!vs.length) return 'Nenhuma.';
  return vs
    .map(
      (x) =>
        `- [${ESTADO_DITO[x.estado]}] ${x.titulo}: ${x.detalhe}` +
        ` (${ORIGEM_DITA[x.origem]}${x.demonstracao ? ', valores de demonstração' : ''})` +
        (x.evidencias.length
          ? ` · ${x.evidencias.map((e) => e.rotulo).join('; ')}`
          : ''),
    )
    .join('\n');
}
