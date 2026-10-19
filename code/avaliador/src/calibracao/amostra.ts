/*
 * Peças puras da calibração: amostra estratificada determinística,
 * concordância (acordo e kappa de Cohen) e o ficheiro markdown de revisão.
 */
import { VEREDICTOS, type Veredicto } from '../tipos.js';

/** Gerador pseudo-aleatório com semente (mulberry32 sobre um hash FNV-1a). */
export function aleatorio(semente: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < semente.length; i++) {
    h ^= semente.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function baralhar<T>(itens: T[], rnd: () => number): T[] {
  const r = [...itens];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/**
 * Amostra de `n` itens repartida pelos estratos (ex.: sistema × veredicto)
 * à vez, para que um estrato pequeno (as poucas "erradas" do nosso, as
 * "passadas bem") também apareça. Mesma entrada + mesma semente = mesma
 * amostra, seja qual for a ordem em que a BD devolveu as linhas. A ordem
 * final é baralhada: quem avalia não deve adivinhar o sistema pela posição.
 */
export function amostraEstratificada<T>(
  itens: T[],
  opts: {
    id: (t: T) => string;
    estrato: (t: T) => string;
    n: number;
    semente: string;
  },
): T[] {
  const rnd = aleatorio(opts.semente);
  const grupos = new Map<string, T[]>();
  const ordenados = [...itens].sort((a, b) =>
    opts.id(a).localeCompare(opts.id(b)),
  );
  for (const t of ordenados) {
    const k = opts.estrato(t);
    grupos.set(k, [...(grupos.get(k) ?? []), t]);
  }
  const filas = [...grupos.keys()]
    .sort()
    .map((k) => baralhar(grupos.get(k)!, rnd));
  const escolhidos: T[] = [];
  while (escolhidos.length < opts.n && filas.some((f) => f.length)) {
    for (const f of filas) {
      if (escolhidos.length >= opts.n) break;
      const t = f.shift();
      if (t !== undefined) escolhidos.push(t);
    }
  }
  return baralhar(escolhidos, rnd);
}

export interface Concordancia {
  n: number;
  /** % de respostas em que juiz e pessoa deram o mesmo veredicto. */
  acordo: number | null;
  /** Kappa de Cohen: acordo descontado do que se esperava por acaso. */
  kappa: number | null;
  /** matriz[juiz][pessoa] = contagem. */
  matriz: Record<Veredicto, Record<Veredicto, number>>;
}

export function concordancia(
  pares: { juiz: Veredicto; pessoa: Veredicto }[],
): Concordancia {
  const matriz = Object.fromEntries(
    VEREDICTOS.map((a) => [
      a,
      Object.fromEntries(VEREDICTOS.map((b) => [b, 0])),
    ]),
  ) as Concordancia['matriz'];
  for (const p of pares) matriz[p.juiz][p.pessoa]++;
  const n = pares.length;
  if (!n) return { n, acordo: null, kappa: null, matriz };
  const po = pares.filter((p) => p.juiz === p.pessoa).length / n;
  let pe = 0;
  for (const v of VEREDICTOS) {
    const j = pares.filter((p) => p.juiz === v).length / n;
    const h = pares.filter((p) => p.pessoa === v).length / n;
    pe += j * h;
  }
  // Se o acaso já explica tudo (todos no mesmo veredicto), kappa não informa:
  // 1 se concordam em tudo, 0 caso contrário.
  const kappa = pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe);
  return { n, acordo: 100 * po, kappa, matriz };
}

/** Interpretação habitual (Landis & Koch), para o relatório em linguagem simples. */
export function lerKappa(k: number | null): string {
  if (k === null) return 'sem dados';
  // Arredondar: 0,39999… de vírgula flutuante é 0,40.
  k = Math.round(k * 100) / 100;
  if (k >= 0.8) return 'quase perfeita';
  if (k >= 0.6) return 'forte';
  if (k >= 0.4) return 'moderada';
  if (k >= 0.2) return 'fraca';
  return 'muito fraca';
}

/* ---------- ficheiro de revisão ---------- */

export interface ItemCalibracao {
  resposta_id: string;
  pergunta: string;
  idioma: string;
  categoria: string;
  comportamento: string;
  entidade_esperada: string | null;
  gabarito_resposta: string | null;
  factos_obrigatorios: string[];
  factos_proibidos: string[];
  texto: string | null;
}

const MARCA = '<!-- avaliador:calibracao v1 -->';

function citar(t: string | null): string {
  const s = (t ?? '').trim();
  return s
    ? s
        .split(/\r?\n/)
        .map((l) => `> ${l}`)
        .join('\n')
    : '> (vazia)';
}

/**
 * Markdown para uma pessoa avaliar. Sem o veredicto do juiz nem o nome do
 * sistema: a pessoa tem de ser tão cega como o juiz, senão a concordância
 * não mede nada.
 */
export function gerarCalibracao(
  itens: ItemCalibracao[],
  titulo: string,
): string {
  const partes = [
    `# ${titulo}`,
    MARCA,
    '',
    'Para cada resposta, marque UMA caixa com [x]. Avalie só o texto, contra o gabarito:',
    '- **certa**: dá a informação certa (ou faz o que se esperava: passar a humano, dizer que não é da câmara, pedir um esclarecimento, responder na língua da pergunta);',
    '- **passada_bem**: numa pergunta difícil, passa a uma pessoa em vez de inventar;',
    '- **errada**: falta informação essencial, tem informação errada, só manda contactar a câmara, ou numa emergência não manda ligar 112;',
    '- **sem_resposta**: vazia, erro ou "não percebi".',
    'Pode deixar uma nota curta. Não altere as linhas `<!-- resposta: ... -->`.',
    '',
  ];
  itens.forEach((it, i) => {
    partes.push(
      `## ${i + 1}. ${it.pergunta.replace(/\s+/g, ' ').trim()}`,
      `<!-- resposta: ${it.resposta_id} -->`,
      '',
      `- Categoria: ${it.categoria} · idioma: ${it.idioma}`,
      `- Comportamento esperado: ${it.comportamento}${it.entidade_esperada ? ` · entidade: ${it.entidade_esperada}` : ''}`,
      `- Factos obrigatórios: ${it.factos_obrigatorios.length ? it.factos_obrigatorios.join(' | ') : '(nenhum)'}`,
      `- Factos proibidos: ${it.factos_proibidos.length ? it.factos_proibidos.join(' | ') : '(nenhum)'}`,
      '',
      '**Gabarito:**',
      citar(it.gabarito_resposta),
      '',
      '**Resposta do assistente:**',
      citar(it.texto),
      '',
      '**Veredicto:**',
      ...VEREDICTOS.map((v) => `- [ ] ${v}`),
      '',
      '**Nota:** ',
      '',
    );
  });
  return partes.join('\n');
}

export interface LeituraCalibracao {
  avaliacoes: {
    resposta_id: string;
    veredicto: Veredicto;
    nota: string | null;
  }[];
  /** Secções sem caixa marcada (a pessoa ainda não avaliou). */
  porAvaliar: string[];
  /** Secções com problemas (mais de uma caixa, sem id). */
  erros: string[];
}

export function lerCalibracao(texto: string): LeituraCalibracao {
  if (!texto.includes(MARCA))
    throw new Error(
      'Este ficheiro não é uma calibração exportada pelo avaliador.',
    );
  const r: LeituraCalibracao = { avaliacoes: [], porAvaliar: [], erros: [] };
  const seccoes = texto.split(/^## /m).slice(1);
  for (const s of seccoes) {
    const titulo = s.split(/\r?\n/, 1)[0].trim();
    const id = /<!--\s*resposta:\s*([0-9a-f-]{36})\s*-->/i.exec(s)?.[1];
    if (!id) {
      r.erros.push(`"${titulo}": falta a linha <!-- resposta: ... -->`);
      continue;
    }
    const marcadas = VEREDICTOS.filter((v) =>
      new RegExp(`^\\s*[-*]\\s*\\[[xX]\\]\\s*${v}\\s*$`, 'm').test(s),
    );
    if (marcadas.length === 0) {
      r.porAvaliar.push(titulo);
      continue;
    }
    if (marcadas.length > 1) {
      r.erros.push(
        `"${titulo}": mais de uma caixa marcada (${marcadas.join(', ')})`,
      );
      continue;
    }
    const nota = /\*\*Nota:\*\*[ \t]*([\s\S]*)$/.exec(s)?.[1].trim() || null;
    r.avaliacoes.push({ resposta_id: id, veredicto: marcadas[0], nota });
  }
  return r;
}
