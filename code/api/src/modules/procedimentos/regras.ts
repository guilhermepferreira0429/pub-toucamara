import { z } from 'zod';

/*
 * Regras puras dos procedimentos internos: o guião fixo da entrevista, o
 * rascunho montado das respostas (sem IA), o texto para a pesquisa e os
 * trechos mais relevantes de um procedimento para uma pergunta. Sem BD nem
 * rede, para se testarem sozinhas.
 */

// ---------------------------------------------------------------------------
// Conteúdo de um procedimento
// ---------------------------------------------------------------------------

const texto = (max: number) => z.string().trim().max(max);

export const esquemaOndeEsta = z.object({
  o_que: texto(200).min(1),
  onde: texto(500).default(''),
});

export const esquemaContacto = z.object({
  nome: texto(200).min(1),
  papel: texto(200).nullable().default(null),
  contacto: texto(200).nullable().default(null),
});

export const esquemaConteudo = z.object({
  titulo: texto(200).min(3),
  area: texto(200).min(2),
  servico_id: z.uuid().nullable().default(null),
  resumo: texto(2000).default(''),
  passos: z.array(texto(1000).min(1)).max(60).default([]),
  onde_esta: z.array(esquemaOndeEsta).max(40).default([]),
  contactos: z.array(esquemaContacto).max(40).default([]),
  excecoes: z.array(texto(1000).min(1)).max(40).default([]),
  erros_comuns: z.array(texto(1000).min(1)).max(40).default([]),
  notas: texto(4000).default(''),
});

export type Conteudo = z.output<typeof esquemaConteudo>;

/** Os campos que se gravam em cada versão (e que a pesquisa lê). */
export const CAMPOS_CONTEUDO = [
  'titulo',
  'area',
  'servico_id',
  'resumo',
  'passos',
  'onde_esta',
  'contactos',
  'excecoes',
  'erros_comuns',
  'notas',
] as const satisfies readonly (keyof Conteudo)[];

// ---------------------------------------------------------------------------
// Guião da entrevista (o caminho sem IA, e a rede do caminho com IA)
// ---------------------------------------------------------------------------

export const CHAVES = [
  'o_que',
  'passos',
  'onde',
  'contactos',
  'excecoes',
  'erros',
  'notas',
] as const;
export type Chave = (typeof CHAVES)[number];

export interface PerguntaGuiao {
  chave: Chave;
  pergunta: string;
}

/** As perguntas fixas, pela ordem em que fazem sentido numa conversa. */
export function guiao(area: string): PerguntaGuiao[] {
  const a = area.trim();
  return [
    {
      chave: 'o_que',
      pergunta: `Em poucas palavras: o que é "${a}", quem costuma pedir e o que a câmara tem de fazer?`,
    },
    {
      chave: 'passos',
      pergunta: `Passo a passo, como trata um pedido de "${a}", desde que chega até ficar resolvido? Um passo por linha.`,
    },
    {
      chave: 'onde',
      pergunta:
        'Onde está cada coisa de que precisa: formulários, minutas, pastas, programas, arquivo? Uma coisa por linha, no formato "o quê: onde".',
    },
    {
      chave: 'contactos',
      pergunta:
        'A quem pede ajuda ou uma decisão? Diga o nome, o serviço e como se contacta (extensão, email). Uma pessoa por linha.',
    },
    {
      chave: 'excecoes',
      pergunta:
        'Que exceções ou casos especiais aparecem? E o que faz quando falta um documento? Um caso por linha.',
    },
    {
      chave: 'erros',
      pergunta:
        'Que erros vê os colegas novos cometerem com isto, e como se evitam? Um por linha.',
    },
    {
      chave: 'notas',
      pergunta:
        'Há mais alguma coisa que só se aprende com anos de casa e que devia ficar escrita?',
    },
  ];
}

/** A próxima pergunta do guião que ainda não foi feita (ou null: acabou). */
export function proximaDoGuiao(
  area: string,
  feitas: readonly string[],
): PerguntaGuiao | null {
  return guiao(area).find((p) => !feitas.includes(p.chave)) ?? null;
}

/** Máximo de perguntas numa entrevista (com IA pode haver de seguimento). */
export const MAX_PERGUNTAS = 14;

// ---------------------------------------------------------------------------
// Rascunho montado das respostas (sem IA)
// ---------------------------------------------------------------------------

export interface Resposta {
  chave: string;
  resposta: string | null;
}

/** Marcadores de lista no início da linha: "1.", "2)", "-", "•", "a)". */
const MARCADOR = /^\s*(?:[-•*·–]|\d{1,2}\s*[.)º°-]|[a-z]\))\s*/i;

/**
 * Parte uma resposta em itens: uma linha por item; se vier tudo numa linha,
 * parte por ";" ou por "depois"/"a seguir" (como se fala). Tira marcadores.
 */
export function partirLista(t: string | null | undefined): string[] {
  if (!t) return [];
  let partes = t
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (partes.length === 1) {
    const unica = partes[0];
    const porPontoVirgula = unica.split(/\s*;\s*/).filter(Boolean);
    if (porPontoVirgula.length > 1) {
      partes = porPontoVirgula;
    } else {
      const porSequencia = unica
        .split(
          /[,.]?\s+(?:e\s+)?(?:depois|a seguir|em seguida|por fim|no fim)[,:]?\s+/i,
        )
        .filter(Boolean);
      if (porSequencia.length > 1) partes = porSequencia;
    }
  }
  return partes
    .map((p) => p.replace(MARCADOR, '').trim())
    .map((p) => p.replace(/[.;,]+$/, '').trim())
    .filter((p) => p.length > 0)
    .map(maiuscula);
}

function maiuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CONTACTO =
  /([\w.+-]+@[\w-]+(?:\.[\w-]+)+|\b(?:ext(?:ens[ãa]o)?\.?|extens[ãa]o)\s*\d{2,5}\b|\+?\d[\d ]{7,14}\d)/i;

/**
 * "D. Rosa, Fiscalização, ext. 214" → { nome: "D. Rosa", papel:
 * "Fiscalização", contacto: "ext. 214" }. O que não se reconhece fica no nome.
 */
export function lerContacto(linha: string): z.output<typeof esquemaContacto> {
  const m = CONTACTO.exec(linha);
  const contacto = m ? m[1].trim() : null;
  const resto = (m ? linha.replace(m[0], ' ') : linha)
    .replace(/\(\s*\)/g, ' ')
    .split(/\s*[,–—]\s*|\s+-\s+|\s*\(\s*|\s*\)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const nome = resto[0] ?? linha.trim();
  const papel = resto.slice(1).join(', ') || null;
  return { nome, papel, contacto };
}

/** "Minutas: pasta X" → { o_que: "Minutas", onde: "pasta X" }. */
export function lerOndeEsta(linha: string): z.output<typeof esquemaOndeEsta> {
  const i = linha.search(
    /\s*[:–—]\s*|\s+-\s+|\s+(?:está|estão|fica|ficam)\s+(?:n[oa]s?|em)\s+/i,
  );
  if (i <= 0) return { o_que: linha.trim(), onde: '' };
  const o_que = linha.slice(0, i).trim();
  const onde = linha
    .slice(i)
    .replace(/^\s*[:–—-]\s*/, '')
    .replace(/^\s+(?:está|estão|fica|ficam)\s+/i, '')
    .trim();
  return { o_que, onde };
}

/** Junta as respostas da mesma chave (há perguntas de seguimento). */
function porChave(respostas: readonly Resposta[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of respostas) {
    const t = r.resposta?.trim();
    if (!t) continue;
    m.set(r.chave, [...(m.get(r.chave) ?? []), t]);
  }
  return m;
}

/**
 * O rascunho de procedimento a partir das respostas da entrevista, sem IA:
 * cada resposta vai para o campo da sua pergunta, partida em itens.
 */
export function montarRascunho(
  area: string,
  respostas: readonly Resposta[],
  servicoId: string | null = null,
): Conteudo {
  const r = porChave(respostas);
  const lista = (c: Chave) => (r.get(c) ?? []).flatMap((t) => partirLista(t));
  const resumo = (r.get('o_que') ?? []).join('\n\n');
  return {
    titulo: `Como tratar: ${area.trim()}`.slice(0, 200),
    area: area.trim(),
    servico_id: servicoId,
    resumo: resumo.slice(0, 2000),
    passos: lista('passos').slice(0, 60),
    onde_esta: lista('onde').map(lerOndeEsta).slice(0, 40),
    contactos: lista('contactos').map(lerContacto).slice(0, 40),
    excecoes: lista('excecoes').slice(0, 40),
    erros_comuns: lista('erros').slice(0, 40),
    notas: (r.get('notas') ?? []).join('\n\n').slice(0, 4000),
  };
}

// ---------------------------------------------------------------------------
// Pesquisa
// ---------------------------------------------------------------------------

/** O texto que vai para o tsvector (todas as secções, sem estrutura). */
export function textoPesquisa(c: Conteudo): string {
  return [
    c.titulo,
    c.area,
    c.resumo,
    ...c.passos,
    ...c.onde_esta.map((o) => `${o.o_que} ${o.onde}`),
    ...c.contactos.map((x) =>
      [x.nome, x.papel, x.contacto].filter(Boolean).join(' '),
    ),
    ...c.excecoes,
    ...c.erros_comuns,
    c.notas,
  ]
    .filter(Boolean)
    .join('\n');
}

const VAZIAS = new Set(
  (
    'a o as os um uma uns umas de do da dos das em no na nos nas por para com sem ' +
    'que se e ou ao aos à às é ser foi como quando onde qual quais quem eu tu ele ela ' +
    'me te lhe isto isso aquilo este esta esse essa meu minha seu sua há ter tem tenho ' +
    'faz fazer faco fazemos trato trata tratam tratamos tratar pedido pedidos ' +
    'caso casos coisa mais muito deve devo posso pode preciso procedimento ' +
    'procedimentos'
  ).split(' '),
);

function semAcentos(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Os termos da pergunta que valem para a pesquisa por texto na BD: tira as
 * palavras vazias e as de "como se faz" ("como trato um pedido de..."), que
 * senão acertavam em todos os procedimentos "Como tratar: ...".
 */
export function termosPesquisa(t: string): string {
  return t
    .split(/[^\p{L}\p{N}]+/u)
    .filter((p) => p.length > 2 && !VAZIAS.has(semAcentos(p)))
    .join(' ');
}

/** Palavras com significado, sem acentos nem maiúsculas, com radical curto. */
export function palavras(t: string): string[] {
  return semAcentos(t)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 2 && !VAZIAS.has(p))
    .map(radical);
}

/** Radical grosseiro (plural e terminações verbais/nominais comuns). */
function radical(p: string): string {
  if (p.length <= 4) return p;
  return (
    p.replace(
      /(coes|cao|mente|ados|adas|ado|ada|idos|idas|ido|ida|ar|er|ir|es|s)$/,
      '',
    ) || p
  );
}

export type Seccao =
  | 'resumo'
  | 'passos'
  | 'onde_esta'
  | 'contactos'
  | 'excecoes'
  | 'erros_comuns'
  | 'notas';

export const NOMES_SECCAO: Record<Seccao, string> = {
  resumo: 'O que é',
  passos: 'Passo a passo',
  onde_esta: 'Onde está cada coisa',
  contactos: 'A quem perguntar',
  excecoes: 'Exceções',
  erros_comuns: 'Erros comuns',
  notas: 'Notas',
};

export interface TrechoProcedimento {
  seccao: Seccao;
  nome_seccao: string;
  texto: string;
  pontuacao: number;
}

function itens(c: Conteudo): { seccao: Seccao; texto: string }[] {
  const s = (seccao: Seccao, xs: string[]) =>
    xs.filter(Boolean).map((texto) => ({ seccao, texto }));
  return [
    ...s('resumo', [c.resumo]),
    ...c.passos.map((t, i) => ({
      seccao: 'passos' as const,
      texto: `${i + 1}. ${t}`,
    })),
    ...s(
      'onde_esta',
      c.onde_esta.map((o) => (o.onde ? `${o.o_que}: ${o.onde}` : o.o_que)),
    ),
    ...s(
      'contactos',
      c.contactos.map((x) =>
        [x.nome, x.papel, x.contacto].filter(Boolean).join(' · '),
      ),
    ),
    ...s('excecoes', c.excecoes),
    ...s('erros_comuns', c.erros_comuns),
    ...s('notas', [c.notas]),
  ];
}

/**
 * Os trechos de um procedimento que mais tocam na pergunta (palavras em
 * comum, a contar a raridade dentro do procedimento). Sem nenhum em comum,
 * devolve o resumo e os primeiros passos, que é por onde se começa.
 */
export function trechosRelevantes(
  c: Conteudo,
  pergunta: string,
  max = 3,
): TrechoProcedimento[] {
  const p = new Set(palavras(pergunta));
  const todos = itens(c);
  const frequencia = new Map<string, number>();
  const palavrasDe = todos.map((it) => new Set(palavras(it.texto)));
  for (const ws of palavrasDe)
    for (const w of ws) frequencia.set(w, (frequencia.get(w) ?? 0) + 1);

  const pontuados = todos
    .map((it, i) => {
      let pont = 0;
      for (const w of palavrasDe[i]) {
        if (p.has(w)) pont += 1 / (frequencia.get(w) ?? 1);
      }
      return { ...it, pontuacao: Math.round(pont * 1000) / 1000, i };
    })
    .filter((t) => t.pontuacao > 0)
    .sort((a, b) => b.pontuacao - a.pontuacao || a.i - b.i)
    .slice(0, max);

  const escolhidos = pontuados.length
    ? pontuados
    : todos
        .filter((t) => t.seccao === 'resumo' || t.seccao === 'passos')
        .slice(0, max)
        .map((t) => ({ ...t, pontuacao: 0 }));
  return escolhidos.map((t) => ({
    seccao: t.seccao,
    nome_seccao: NOMES_SECCAO[t.seccao],
    texto: t.texto.length > 500 ? `${t.texto.slice(0, 499)}…` : t.texto,
    pontuacao: t.pontuacao,
  }));
}
