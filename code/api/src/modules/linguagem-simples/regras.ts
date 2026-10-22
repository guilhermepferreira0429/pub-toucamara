import { z } from 'zod';
import { partirEmTrechos } from '../conhecimento/texto.js';

/*
 * Regras puras da linguagem simples (FUN §14) e do glossário administrativo
 * (CONC, ideia 5): partir o original em secções citáveis, ligar as secções
 * aos trechos do conhecimento, limpar o que a IA devolve, o rascunho sem IA
 * (excertos), a desatualização e a deteção de termos no texto. Sem BD nem
 * rede, para se testarem sozinhas.
 */

export const TIPOS_DOCUMENTO = [
  'edital',
  'regulamento',
  'aviso',
  'deliberacao',
  'lei',
  'outro',
] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** As perguntas a que a versão simples responde, por esta ordem. */
export const CHAVES = [
  'o_que_e',
  'a_quem_se_aplica',
  'o_que_tem_de_fazer',
  'ate_quando',
  'quanto_custa',
  'onde',
  'outro',
] as const;
export type Chave = (typeof CHAVES)[number];

export const TITULOS_CHAVE: Record<Chave, string> = {
  o_que_e: 'O que é',
  a_quem_se_aplica: 'A quem se aplica',
  o_que_tem_de_fazer: 'O que tem de fazer',
  ate_quando: 'Até quando',
  quanto_custa: 'Quanto custa',
  onde: 'Onde tratar',
  outro: 'Mais informação',
};

/** O aviso que acompanha sempre a versão simples. */
export const AVISO_LEGAL =
  'Este resumo ajuda a perceber; o que vale legalmente é o texto oficial.';

// ---------------------------------------------------------------------------
// O original em secções
// ---------------------------------------------------------------------------

export interface Seccao {
  /** 's1', 's2', … (estável para o mesmo texto). */
  id: string;
  /** 'art. 6.º', o título da secção, ou null (parágrafo). */
  referencia: string | null;
  texto: string;
}

/**
 * Parte o texto oficial em secções para mostrar e citar: por artigos quando
 * há pelo menos dois "Artigo N.º", senão por títulos (`## `); se der uma só
 * secção, por parágrafos. É o mesmo corte dos trechos do conhecimento, sem
 * tamanho máximo nem sobreposição: o texto todo, uma vez, por ordem.
 */
export function seccoesDoOriginal(texto: string): Seccao[] {
  const partes = partirEmTrechos(texto, {
    alvo: 10_000_000,
    maximo: 10_000_000,
    sobreposicao: 0,
  });
  let brutas = partes.map((p) => ({
    referencia: p.referencia,
    texto: p.texto,
  }));
  if (brutas.length === 1) {
    const linhas = brutas[0].texto
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (linhas.length > 1) {
      brutas = linhas.map((l) => ({ referencia: null, texto: l }));
    }
  }
  return brutas.map((s, i) => ({
    id: `s${i + 1}`,
    referencia: s.referencia,
    texto: s.texto,
  }));
}

export interface TrechoBase {
  id: string;
  referencia: string | null;
  texto: string;
}

/** 'art. 6.º, n.º 2' → 'art. 6.º'. */
function referenciaBase(r: string | null): string | null {
  if (!r) return null;
  return r.replace(/,\s*n\.º.*$/, '').trim();
}

/** O início de um trecho sem a sobreposição ("… fim do anterior\n"). */
function inicioDoTrecho(texto: string): string {
  const semCauda = texto.startsWith('… ')
    ? texto.slice(texto.indexOf('\n') + 1)
    : texto;
  return semCauda.trim().slice(0, 60);
}

/**
 * Que trechos (os que o agente cita) caem em cada secção: pela referência do
 * artigo, senão pelo início do texto do trecho.
 */
export function ligarTrechos(
  seccoes: Seccao[],
  trechos: TrechoBase[],
): Map<string, string[]> {
  const mapa = new Map<string, string[]>(seccoes.map((s) => [s.id, []]));
  for (const t of trechos) {
    const ref = referenciaBase(t.referencia);
    let alvo =
      ref !== null
        ? seccoes.find((s) => s.referencia !== null && s.referencia === ref)
        : undefined;
    if (!alvo) {
      const inicio = inicioDoTrecho(t.texto);
      if (inicio) alvo = seccoes.find((s) => s.texto.includes(inicio));
    }
    if (alvo) mapa.get(alvo.id)!.push(t.id);
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// Partes da versão simples
// ---------------------------------------------------------------------------

export interface Parte {
  chave: Chave;
  titulo: string;
  texto: string;
  /** Secções do original (s1, s2…) de onde vem. */
  seccoes: string[];
  /** Trechos do conhecimento dessas secções (para confirmar e citar). */
  trechos: string[];
}

export type ParteEntrada = Omit<Parte, 'trechos'>;

export const esquemaParte = z.object({
  chave: z.enum(CHAVES),
  titulo: z.string().trim().min(2).max(120),
  texto: z.string().trim().min(3).max(3000),
  seccoes: z.array(z.string().regex(/^s\d{1,5}$/)).max(40),
});

/** O que se pede à IA (`ClaudeService.extrair`). */
export const esquemaIa = z.object({
  titulo: z
    .string()
    .describe(
      'Título curto e simples, ex.: "Esplanadas: o que precisa de saber".',
    ),
  resumo: z
    .string()
    .describe('Uma ou duas frases curtas: de que trata e a quem interessa.'),
  partes: z
    .array(
      z.object({
        chave: z.enum(CHAVES),
        titulo: z
          .string()
          .describe('Título da parte, em pergunta ou frase curta.'),
        texto: z
          .string()
          .describe(
            'Frases curtas, em português de Portugal claro. Pode ter uma lista com "- " no início de cada linha.',
          ),
        seccoes: z
          .array(z.string())
          .describe(
            'Os ids das secções do original (s1, s2…) de onde vem o que está nesta parte. Pelo menos um.',
          ),
      }),
    )
    .describe(
      'Uma parte por pergunta a que o documento responde. Sem partes inventadas.',
    ),
});

export const SISTEMA_SIMPLES = [
  'Reescreves documentos oficiais de uma câmara municipal portuguesa (editais, regulamentos, avisos, deliberações) em linguagem simples, para qualquer pessoa perceber.',
  'Recebes o título, o tipo e o texto oficial partido em secções com id (s1, s2…).',
  'Regras:',
  '- Português de Portugal, claro e direto. Frases curtas (até 20 palavras). Sem jargão: quando um termo técnico for preciso, explica-o logo a seguir entre parênteses.',
  '- Trata a pessoa por "você" implícito ("Pode pedir…", "Tem de entregar…").',
  '- Organiza pelas perguntas: o_que_e (O que é), a_quem_se_aplica (A quem se aplica), o_que_tem_de_fazer (O que tem de fazer), ate_quando (prazos e datas), quanto_custa (taxas e valores), onde (onde e como tratar), outro (o resto que importa).',
  '- Só usas o que está no texto oficial. Se o documento não fala de uma pergunta (ex.: não diz quanto custa), NÃO crias essa parte. Nunca inventes prazos, valores, contactos ou exceções.',
  '- Mantém exatamente os números, datas, prazos, valores e referências legais do original.',
  '- Cada parte diz de que secções vem (seccoes), com os ids tal como vêm. Uma parte sem secção de origem não serve.',
  '- Não dás conselhos jurídicos nem opiniões. Não contradizes o original.',
].join('\n');

/** Texto muito longo não vai à IA: escreve-se à mão (ou por excertos). */
export const MAX_ORIGINAL_IA = 150_000;

/** O que vai à IA (o que muda a cada pedido). */
export function conteudoIa(
  titulo: string,
  tipo: TipoDocumento,
  seccoes: Seccao[],
): string {
  return JSON.stringify({
    titulo,
    tipo,
    seccoes: seccoes.map((s) => ({
      id: s.id,
      referencia: s.referencia,
      texto: s.texto,
    })),
  });
}

/**
 * Partes prontas a gravar: só as secções que existem, sem repetidos, com os
 * trechos dessas secções. Uma parte que fica sem origem sai (não se pode
 * confirmar no original). Por ordem das perguntas.
 */
export function limparPartes(
  partes: ParteEntrada[],
  seccoes: Seccao[],
  trechosPorSeccao: Map<string, string[]>,
): Parte[] {
  const existentes = new Set(seccoes.map((s) => s.id));
  const ordem = new Map(seccoes.map((s, i) => [s.id, i]));
  const fora: Parte[] = [];
  for (const p of partes) {
    const ids = [...new Set(p.seccoes.filter((s) => existentes.has(s)))].sort(
      (a, b) => ordem.get(a)! - ordem.get(b)!,
    );
    const texto = p.texto.trim();
    if (!ids.length || !texto) continue;
    fora.push({
      chave: p.chave,
      titulo: p.titulo.trim() || TITULOS_CHAVE[p.chave],
      texto,
      seccoes: ids,
      trechos: [...new Set(ids.flatMap((s) => trechosPorSeccao.get(s) ?? []))],
    });
  }
  const pos = (c: Chave) => CHAVES.indexOf(c);
  return fora
    .map((p, i) => ({ p, i }))
    .sort((a, b) => pos(a.p.chave) - pos(b.p.chave) || a.i - b.i)
    .map(({ p }) => p);
}

/** Secções que as partes dizem existir e não existem (para recusar ao gravar). */
export function seccoesInvalidas(
  partes: ParteEntrada[],
  seccoes: Seccao[],
): string[] {
  const existentes = new Set(seccoes.map((s) => s.id));
  return [
    ...new Set(
      partes.flatMap((p) => p.seccoes).filter((s) => !existentes.has(s)),
    ),
  ];
}

const MAX_EXCERTOS = 15;

/** As primeiras frases de um texto, até ~n caracteres. */
export function primeirasFrases(texto: string, n = 320): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (limpo.length <= n) return limpo;
  const frases = limpo.match(/[^.!?;]+[.!?;]+(?=\s|$)/g) ?? [];
  let fora = '';
  for (const f of frases) {
    if (fora && fora.length + f.length > n) break;
    fora += f;
  }
  if (!fora) {
    const corte = limpo.slice(0, n);
    const espaco = corte.lastIndexOf(' ');
    fora = `${(espaco > n / 2 ? corte.slice(0, espaco) : corte).trim()}…`;
  }
  return fora.trim();
}

/**
 * Sem IA: um rascunho honesto, feito de excertos do original (uma parte por
 * secção, as primeiras frases). NÃO é linguagem simples: fica marcado
 * 'extrativo' e não se publica sem alguém o reescrever.
 */
export function rascunhoExtrativo(
  titulo: string,
  seccoes: Seccao[],
): { titulo: string; resumo: string; partes: ParteEntrada[] } {
  return {
    titulo,
    resumo:
      'Excertos do texto oficial, ainda por simplificar (a IA não está disponível). Reescreva antes de publicar.',
    partes: seccoes.slice(0, MAX_EXCERTOS).map((s, i) => ({
      chave: 'outro' as const,
      titulo: s.referencia ?? `Parte ${i + 1}`,
      texto: primeirasFrases(s.texto),
      seccoes: [s.id],
    })),
  };
}

// ---------------------------------------------------------------------------
// Estado e desatualização
// ---------------------------------------------------------------------------

export type EstadoDocumento =
  'sem_versao' | 'rascunho' | 'publicada' | 'desatualizada';

/**
 * Desatualizada: a versão simples foi feita de uma versão do texto oficial
 * que já não é a atual da fonte. Sem versão atual (fonte revogada ou sem
 * texto) também conta como desatualizada.
 */
export function desatualizada(
  versaoBase: string,
  versaoAtual: string | null,
): boolean {
  return versaoAtual === null || versaoBase !== versaoAtual;
}

/** O estado de um documento na lista do painel. */
export function estadoDocumento(d: {
  publicada: { fonte_versao_id: string } | null;
  rascunho: unknown;
  versao_atual_id: string | null;
}): EstadoDocumento {
  if (d.publicada) {
    return desatualizada(d.publicada.fonte_versao_id, d.versao_atual_id)
      ? 'desatualizada'
      : 'publicada';
  }
  return d.rascunho ? 'rascunho' : 'sem_versao';
}

// ---------------------------------------------------------------------------
// Glossário: deteção de termos no texto
// ---------------------------------------------------------------------------

export interface TermoGlossario {
  id: string;
  termo: string;
  variantes: string[];
}

export interface Marca {
  /** Posições no texto ORIGINAL (com acentos), [inicio, fim). */
  inicio: number;
  fim: number;
  termo_id: string;
}

/** Minúsculas e sem acentos, com o mapa de cada carácter para o original. */
function normalizarComMapa(texto: string): { n: string; mapa: number[] } {
  let n = '';
  const mapa: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    // Espaços seguidos (e mudanças de linha) contam como um só.
    if (/\s/.test(texto[i])) {
      if (!n.endsWith(' ')) {
        n += ' ';
        mapa.push(i);
      }
      continue;
    }
    const c = texto[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const ch of c) {
      n += ch;
      mapa.push(i);
    }
  }
  mapa.push(texto.length);
  return { n, mapa };
}

/** Minúsculas, sem acentos e com espaços simples. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const LETRA = /[\p{L}\p{N}]/u;

/**
 * Onde aparecem os termos do glossário num texto (sem distinguir acentos nem
 * maiúsculas, só palavras inteiras). Ganha a forma mais comprida ("audiência
 * prévia" antes de "audiência") e não há marcas sobrepostas. Por defeito só
 * a primeira vez de cada termo (sublinhar todas cansa a leitura).
 */
export function detetarTermos(
  texto: string,
  termos: TermoGlossario[],
  opcoes: { todas?: boolean } = {},
): Marca[] {
  const { n, mapa } = normalizarComMapa(texto);
  const formas = termos
    .flatMap((t) =>
      [t.termo, ...t.variantes]
        .map((f) => normalizar(f))
        .filter((f) => f.length >= 2)
        .map((f) => ({ f, id: t.id })),
    )
    .sort((a, b) => b.f.length - a.f.length);

  const ocupado = new Array<boolean>(n.length).fill(false);
  const marcas: Marca[] = [];
  const vistos = new Set<string>();
  for (const { f, id } of formas) {
    let desde = 0;
    while (desde <= n.length - f.length) {
      const i = n.indexOf(f, desde);
      if (i < 0) break;
      const j = i + f.length;
      desde = i + 1;
      const antes = i > 0 ? n[i - 1] : '';
      const depois = j < n.length ? n[j] : '';
      if ((antes && LETRA.test(antes)) || (depois && LETRA.test(depois))) {
        continue;
      }
      if (ocupado.slice(i, j).some(Boolean)) continue;
      if (!opcoes.todas && vistos.has(id)) break;
      for (let k = i; k < j; k++) ocupado[k] = true;
      vistos.add(id);
      marcas.push({ inicio: mapa[i], fim: mapa[j - 1] + 1, termo_id: id });
      if (!opcoes.todas) break;
    }
  }
  return marcas.sort((a, b) => a.inicio - b.inicio);
}

const PREFIXOS_PERGUNTA =
  /^(?:(?:mas |entao |e )?(?:o que (?:e|sao|significa|quer dizer)|que e|que quer dizer|significado de|explica(?:-me)?|explique(?:-me)?|define)\s+)?(?:(?:o|a|os|as|um|uma|de|do|da)\s+)?/;

/**
 * O termo do glossário que a pessoa pergunta ("o que é o deferimento
 * tácito?"): igual a um termo ou variante, senão o termo mais comprido que
 * aparece na pergunta, senão um termo que contém a pergunta. null se nada.
 */
export function procurarTermo<T extends TermoGlossario>(
  termos: T[],
  consulta: string,
): T | null {
  const q = normalizar(consulta)
    .replace(/[?!.«»"“”']/g, '')
    .replace(PREFIXOS_PERGUNTA, '')
    .trim();
  if (q.length < 2) return null;
  const formas = (t: T) => [t.termo, ...t.variantes].map(normalizar);

  const exato = termos.find((t) => formas(t).includes(q));
  if (exato) return exato;

  let melhor: { t: T; n: number } | null = null;
  for (const t of termos) {
    for (const f of formas(t)) {
      const dentro = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapar(f)}($|[^\\p{L}\\p{N}])`,
        'u',
      );
      if (dentro.test(q) && (!melhor || f.length > melhor.n)) {
        melhor = { t, n: f.length };
      }
    }
  }
  if (melhor) return melhor.t;
  if (q.length >= 4) {
    return termos.find((t) => formas(t).some((f) => f.includes(q))) ?? null;
  }
  return null;
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Termos iniciais (valores de demonstração)
// ---------------------------------------------------------------------------

export interface TermoInicial {
  termo: string;
  variantes: string[];
  explicacao: string;
  exemplo?: string;
  fonte_legal?: string;
}

/**
 * Termos iniciais do glossário. As explicações foram escritas por nós a
 * partir das leis citadas, sem validação da câmara: entram com
 * `demonstracao = true` até alguém da câmara as rever no painel.
 */
export const TERMOS_DEMONSTRACAO: TermoInicial[] = [
  {
    termo: 'comunicação prévia',
    variantes: ['comunicações prévias'],
    explicacao:
      'Uma forma mais simples de tratar certas obras: em vez de esperar por uma licença, entrega à câmara a comunicação com os documentos e, depois de pagar as taxas, pode começar. A câmara pode verificar depois.',
    exemplo:
      'Obras dentro de um loteamento já aprovado costumam ser por comunicação prévia.',
    fonte_legal: 'RJUE (Decreto-Lei n.º 555/99), art. 4.º e art. 34.º',
  },
  {
    termo: 'deferimento tácito',
    variantes: ['deferido tacitamente', 'aprovação tácita'],
    explicacao:
      'Quando a lei o prevê, se a câmara não responder a um pedido dentro do prazo, o pedido conta como aprovado. Só acontece nos casos em que a lei o diz.',
    fonte_legal: 'Código do Procedimento Administrativo, art. 130.º',
  },
  {
    termo: 'deferimento',
    variantes: ['deferido', 'deferida'],
    explicacao: 'A resposta "sim" da câmara a um pedido.',
  },
  {
    termo: 'indeferimento',
    variantes: ['indeferido', 'indeferida'],
    explicacao:
      'A resposta "não" da câmara a um pedido. Deve dizer porquê e como pode reagir.',
  },
  {
    termo: 'instrução do processo',
    variantes: ['instrução do procedimento'],
    explicacao:
      'A fase em que a câmara junta e analisa os documentos e as informações de que precisa para decidir o seu pedido.',
    fonte_legal:
      'Código do Procedimento Administrativo, art. 115.º e seguintes',
  },
  {
    termo: 'audiência prévia',
    variantes: ['audiência dos interessados', 'audiência de interessados'],
    explicacao:
      'Antes de decidir contra si, a câmara tem de lhe dizer o que pensa decidir e porquê, e dar-lhe um prazo (pelo menos 10 dias úteis) para responder por escrito.',
    fonte_legal: 'Código do Procedimento Administrativo, arts. 121.º e 122.º',
  },
  {
    termo: 'alvará',
    variantes: ['alvarás'],
    explicacao:
      'O documento que prova que tem a autorização da câmara, por exemplo para uma obra ou para usar um espaço.',
  },
  {
    termo: 'licenciamento zero',
    variantes: [],
    explicacao:
      'Regras que simplificam abrir certos negócios (cafés, lojas, esplanadas): em vez de esperar por licenças, faz uma comunicação no Balcão do Empreendedor (ePortugal).',
    fonte_legal: 'Decreto-Lei n.º 48/2011',
  },
  {
    termo: 'edital',
    variantes: ['editais'],
    explicacao:
      'Um aviso oficial que a câmara afixa e publica para que todos fiquem a saber de uma decisão, de um prazo ou de uma consulta.',
  },
  {
    termo: 'RJUE',
    variantes: ['regime jurídico da urbanização e edificação'],
    explicacao:
      'A lei com as regras das obras, construções e loteamentos em Portugal (Regime Jurídico da Urbanização e Edificação).',
    fonte_legal: 'Decreto-Lei n.º 555/99',
  },
  {
    termo: 'licença',
    variantes: ['licenças'],
    explicacao:
      'Autorização da câmara que tem de pedir antes de fazer certas coisas: uma obra, ocupar a rua, uma festa com som.',
  },
  {
    termo: 'dias úteis',
    variantes: ['dia útil', 'prazo útil'],
    explicacao: 'Dias de trabalho: não contam sábados, domingos nem feriados.',
    fonte_legal: 'Código do Procedimento Administrativo, art. 87.º',
  },
  {
    termo: 'requerente',
    variantes: ['requerentes'],
    explicacao: 'A pessoa ou a empresa que faz o pedido.',
  },
  {
    termo: 'requerimento',
    variantes: ['requerimentos'],
    explicacao: 'O pedido escrito que entrega à câmara.',
  },
  {
    termo: 'consulta pública',
    variantes: ['discussão pública', 'consultas públicas'],
    explicacao:
      'Um período em que qualquer pessoa pode dar a sua opinião sobre uma proposta antes de ser aprovada.',
  },
  {
    termo: 'caducidade',
    variantes: ['caduca', 'caducou'],
    explicacao:
      'Quando uma licença ou autorização deixa de valer, por exemplo porque passou o prazo sem ser usada.',
  },
  {
    termo: 'embargo',
    variantes: ['embargada', 'embargado'],
    explicacao: 'Uma ordem da câmara para parar uma obra.',
  },
  {
    termo: 'isenção',
    variantes: ['isento', 'isenta', 'isentos'],
    explicacao:
      'Quando não tem de pagar (ou de pedir) algo que normalmente teria.',
  },
];
