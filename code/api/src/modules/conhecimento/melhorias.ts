/*
 * Lógica pura das melhorias ao portal (sem BD nem IA): limpar os grupos que
 * a IA devolve, proteger valores que não estão nas fontes, transições de
 * estado e o email ao responsável.
 */

export const ESTADOS_MELHORIA = [
  'proposta',
  'enviada',
  'publicada',
  'rejeitada',
] as const;
export type EstadoMelhoria = (typeof ESTADOS_MELHORIA)[number];

/** Ativa: a pergunta não entra noutra melhoria. */
export const ESTADOS_ATIVOS: readonly EstadoMelhoria[] = [
  'proposta',
  'enviada',
];

/**
 * Para onde pode ir cada estado. Publicada é final (as perguntas já ficaram
 * resolvidas); rejeitada pode voltar a proposta.
 */
const TRANSICOES: Record<EstadoMelhoria, readonly EstadoMelhoria[]> = {
  proposta: ['enviada', 'publicada', 'rejeitada'],
  enviada: ['proposta', 'publicada', 'rejeitada'],
  publicada: [],
  rejeitada: ['proposta'],
};

export function transicaoPermitida(
  de: EstadoMelhoria,
  para: EstadoMelhoria,
): boolean {
  return de === para || TRANSICOES[de].includes(para);
}

// ---------------------------------------------------------------------------
// Grupos da IA
// ---------------------------------------------------------------------------

export interface PerguntaAberta {
  id: string;
  texto: string;
  vezes: number;
}

export interface GrupoIa {
  tema: string;
  perguntas: string[];
}

export interface Grupo {
  tema: string;
  perguntas: PerguntaAberta[];
  vezes: number;
}

/** Referência curta que a IA vê em vez do uuid ('P1', 'P2'...). */
export const refPergunta = (i: number) => `P${i + 1}`;

/**
 * Do que a IA devolveu fica só o que bate certo: referências conhecidas,
 * cada pergunta num só grupo (o primeiro), sem grupos vazios. Ordenados por
 * vezes (soma) e, em empate, pelo tema.
 */
export function limparGrupos(
  grupos: GrupoIa[],
  perguntas: PerguntaAberta[],
): Grupo[] {
  const porRef = new Map(perguntas.map((p, i) => [refPergunta(i), p]));
  const usadas = new Set<string>();
  const limpos: Grupo[] = [];
  for (const g of grupos) {
    const ps: PerguntaAberta[] = [];
    for (const r of g.perguntas) {
      const p = porRef.get(r.trim().toUpperCase());
      if (!p || usadas.has(p.id)) continue;
      usadas.add(p.id);
      ps.push(p);
    }
    if (!ps.length) continue;
    const tema = g.tema.trim() || ps[0].texto;
    limpos.push({
      tema: tema.slice(0, 200),
      perguntas: ps,
      vezes: ps.reduce((s, p) => s + p.vezes, 0),
    });
  }
  return limpos.sort(
    (a, b) => b.vezes - a.vezes || a.tema.localeCompare(b.tema),
  );
}

/** 'F2' → o id da posição 1 da lista; desconhecida ou vazia → null. */
export function resolverRef<T>(
  ref: string | null | undefined,
  prefixo: string,
  lista: T[],
): T | null {
  const m = new RegExp(`^${prefixo}(\\d+)$`, 'i').exec((ref ?? '').trim());
  if (!m) return null;
  return lista[parseInt(m[1], 10) - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Valores que não estão nas fontes
// ---------------------------------------------------------------------------

const MARCA = /\[a confirmar pela câmara:[^\]]*\]/gi;

/**
 * Valores concretos que a câmara tem de confirmar se não vierem das fontes:
 * emails, endereços, telefones, montantes, prazos e horas.
 */
const VALORES: RegExp[] = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\b(?:https?:\/\/|www\.)[^\s)\]]+/gi,
  /(?:\+351\s?)?\b\d{3}\s?\d{3}\s?\d{3}\b/g,
  /\b\d+(?:[.,]\d+)?\s?(?:€|euros?\b)/gi,
  /\b\d+\s?(?:dias?(?:\s(?:úteis|seguidos))?|horas?|semanas?|meses|mês|anos?)\b/gi,
  /\b\d{1,2}(?::\d{2}|h\d{0,2})\b/gi,
];

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[.,;:!?]+$/, '');

/**
 * Chave "número + unidade" de um montante, prazo ou hora: '15,00 €' e
 * '15 €' dão '15€'; '9h30' dá '9h'. Assim a mesma regra escrita de outra
 * forma nas fontes conta como suportada.
 */
const chaveNumero = (s: string) =>
  (/\d+/.exec(s)?.[0] ?? '') + s.replace(/[\d\s.,:]/g, '').toLowerCase();

/** Emails, endereços e telefones só contam se estiverem escritos igual. */
const EXATOS = 3;

function suportado(
  valor: string,
  exato: boolean,
  fontes: string,
  numeros: Set<string>,
): boolean {
  if (fontes.includes(normalizar(valor))) return true;
  return !exato && numeros.has(chaveNumero(valor));
}

function indiceNumeros(fontes: string): Set<string> {
  const s = new Set<string>();
  for (const re of VALORES.slice(EXATOS)) {
    for (const m of fontes.matchAll(new RegExp(re.source, re.flags))) {
      s.add(chaveNumero(m[0]));
    }
  }
  return s;
}

/**
 * Rede de segurança contra valores inventados: o que na sugestão parecer um
 * valor concreto (email, telefone, montante, prazo, hora, endereço) e não
 * estiver nas fontes passa a "[a confirmar pela câmara: …]". O que já está
 * marcado fica como está. Devolve o texto e os valores marcados.
 */
export function protegerValores(
  sugestao: string,
  fontes: string[],
): { texto: string; marcados: string[] } {
  const juntas = fontes.join('\n');
  const normal = normalizar(juntas);
  const numeros = indiceNumeros(juntas);
  const marcados: string[] = [];

  const proteger = (parte: string) => {
    let out = parte;
    VALORES.forEach((re, i) => {
      out = out.replace(re, (v: string, pos: number, todo: string) => {
        // Não voltar a mexer no que acabou de ser marcado.
        if (/\[a confirmar pela câmara:[^\]]*$/i.test(todo.slice(0, pos))) {
          return v;
        }
        if (suportado(v, i < EXATOS, normal, numeros)) return v;
        marcados.push(v.trim());
        return `[a confirmar pela câmara: ${v.trim()}]`;
      });
    });
    return out;
  };

  let texto = '';
  let ultimo = 0;
  for (const m of sugestao.matchAll(MARCA)) {
    texto += proteger(sugestao.slice(ultimo, m.index)) + m[0];
    ultimo = m.index + m[0].length;
  }
  texto += proteger(sugestao.slice(ultimo));
  return { texto, marcados };
}

// ---------------------------------------------------------------------------
// Email ao responsável
// ---------------------------------------------------------------------------

export interface DadosEmailMelhoria {
  municipio: string;
  titulo: string;
  o_que_falta: string;
  sugestao: string;
  tipo: 'nova_informacao' | 'tornar_visivel';
  onde: string | null;
  onde_url: string | null;
  fonte_existente: { titulo: string; url: string } | null;
  entidade: string | null;
  notas: string | null;
  perguntas: { texto: string; vezes: number }[];
}

/**
 * Email simples, sem dados pessoais: só a forma canónica de cada pergunta e
 * quantas vezes foi feita (nunca as frases reais dos munícipes).
 */
export function emailMelhoria(d: DadosEmailMelhoria): {
  assunto: string;
  texto: string;
} {
  const total = d.perguntas.reduce((s, p) => s + p.vezes, 0);
  const linhas = [
    `Olá,`,
    ``,
    `No atendimento do Tou, Câmara? (${d.municipio}) houve ${total} ${total === 1 ? 'pergunta' : 'perguntas'} a que não conseguimos responder com a informação publicada. Propomos esta melhoria${d.entidade ? ` (${d.entidade})` : ''}:`,
    ``,
    `O que falta`,
    d.o_que_falta,
    ``,
  ];
  if (d.tipo === 'tornar_visivel' && d.fonte_existente) {
    linhas.push(
      `A informação já existe em "${d.fonte_existente.titulo}" (${d.fonte_existente.url}), mas as pessoas não a encontram. Sugerimos torná-la visível.`,
      ``,
    );
  }
  if (d.onde) {
    linhas.push(
      `Onde pôr`,
      d.onde + (d.onde_url ? ` (${d.onde_url})` : ''),
      ``,
    );
  }
  linhas.push(
    `Texto sugerido`,
    d.sugestao,
    ``,
    `O que estiver entre "[a confirmar pela câmara: …]" não está nas fontes oficiais e tem de ser confirmado antes de publicar.`,
    ``,
    `Perguntas dos munícipes`,
    ...d.perguntas.map((p) => `- ${p.texto} (${p.vezes}×)`),
  );
  if (d.notas) linhas.push(``, `Notas`, d.notas);
  linhas.push(``, `Obrigado,`, `Tou, Câmara?`);
  return {
    assunto: `Melhoria ao portal: ${d.titulo}`,
    texto: linhas.join('\n'),
  };
}
