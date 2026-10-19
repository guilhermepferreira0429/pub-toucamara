/*
 * Ficheiro de revisão do gabarito (markdown): uma secção por pergunta, com a
 * resposta e os factos editáveis e uma caixa aprovar/rejeitar. Lógica pura:
 * gerar e ler o texto; a BD fica em gabarito.ts.
 *
 * O que o parser garante:
 * - cada secção é identificada pelo comentário `<!-- gabarito: <id> -->`, não
 *   pelo título, para a pessoa poder mexer no resto à vontade;
 * - exportar e voltar a ler sem mexer dá exatamente os mesmos valores
 *   (round-trip), e sem caixa marcada a secção é ignorada;
 * - aceita o que um editor faz ao ficheiro (CRLF, `*` em vez de `-`, `[X]`).
 */
import type { Comportamento } from '../tipos.js';

export interface Fonte {
  titulo: string;
  url: string;
}

/** Conteúdo editável de um gabarito. */
export interface ConteudoGabarito {
  resposta: string;
  factos_obrigatorios: string[];
  factos_proibidos: string[];
  fontes: Fonte[];
}

/** Um gabarito como vai para o ficheiro. */
export interface ItemRevisao extends ConteudoGabarito {
  gabarito_id: string;
  ordem: number;
  categoria: string;
  pergunta: string;
  comportamento: Comportamento;
  entidade_esperada: string | null;
  nota: string | null;
  estado: string;
  versao: number;
}

export type Decisao = 'aprovar' | 'rejeitar';

/** Uma secção lida do ficheiro. `decisao` null = sem caixa marcada. */
export interface ItemLido extends ConteudoGabarito {
  gabarito_id: string;
  decisao: Decisao | null;
}

export interface Leitura {
  itens: ItemLido[];
  /** Secções com problemas (ficam de fora de `itens`). */
  erros: string[];
}

const MARCA = /^<!--\s*gabarito:\s*([0-9a-f-]{36})\s*-->$/i;
const SECCOES = {
  resposta: /^resposta$/i,
  obrigatorios: /^factos obrigat[óo]rios$/i,
  proibidos: /^factos proibidos$/i,
  fontes: /^fontes$/i,
  decisao: /^decis[ãa]o$/i,
} as const;
type Seccao = keyof typeof SECCOES;

export function gerarRevisao(
  itens: ItemRevisao[],
  cab: { municipio: string; estado: string; data: string },
): string {
  const l: string[] = [
    `# Gabarito para rever · ${cab.municipio}`,
    '',
    `${cab.data} · ${itens.length} perguntas · estado: ${cab.estado}`,
    '',
    'Como rever: corrige a resposta e as listas de factos (um facto por linha,',
    'curto e verificável: um nome, um número, um termo); os proibidos são erros',
    'prováveis que tornam uma resposta errada. No fim de cada pergunta marca',
    '`- [x] aprovar` ou `- [x] rejeitar`. As perguntas sem caixa marcada ficam',
    'como estão. Não apagues as linhas `<!-- gabarito: ... -->`.',
    '',
  ];
  for (const it of itens) {
    l.push(`## ${it.ordem}. ${umaLinha(it.pergunta)}`, '');
    l.push(`<!-- gabarito: ${it.gabarito_id} -->`);
    l.push(
      `Categoria: ${it.categoria} · Comportamento: **${it.comportamento}** · v${it.versao} (${it.estado})`,
    );
    if (it.entidade_esperada)
      l.push(`Entidade esperada: ${it.entidade_esperada}`);
    if (it.nota) l.push(`Nota: ${umaLinha(it.nota)}`);
    l.push('', '### Resposta', '', escapar(it.resposta.trim()), '');
    l.push('### Factos obrigatórios', '', ...lista(it.factos_obrigatorios));
    l.push('### Factos proibidos', '', ...lista(it.factos_proibidos));
    l.push(
      '### Fontes',
      '',
      ...lista(
        it.fontes.map((f) =>
          f.titulo === f.url ? f.url : `[${f.titulo}](${f.url})`,
        ),
      ),
    );
    l.push('### Decisão', '', '- [ ] aprovar', '- [ ] rejeitar', '');
  }
  return l.join('\n');
}

/*
 * Uma linha da resposta que comece por `#` ou `<!--` seria lida como título ou
 * marca: escapa-se com `\` à saída e tira-se à entrada.
 */
function escapar(s: string): string {
  return s.replace(/^(\s*)(\\*)(#|<!--)/gm, '$1\\$2$3');
}

function desescapar(s: string): string {
  return s.replace(/^(\s*)\\(\\*)(#|<!--)/gm, '$1$2$3');
}

function umaLinha(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function lista(itens: string[]): string[] {
  return itens.length ? [...itens.map((i) => `- ${umaLinha(i)}`), ''] : [];
}

interface EmCurso {
  id: string;
  linhas: Record<Seccao, string[]>;
}

export function lerRevisao(texto: string): Leitura {
  const blocos: EmCurso[] = [];
  let atual: EmCurso | null = null;
  let seccao: Seccao | null = null;

  for (const linha of texto.split(/\r?\n/)) {
    const marca = linha.trim().match(MARCA);
    if (marca) {
      atual = {
        id: marca[1].toLowerCase(),
        linhas: {
          resposta: [],
          obrigatorios: [],
          proibidos: [],
          fontes: [],
          decisao: [],
        },
      };
      blocos.push(atual);
      seccao = null;
      continue;
    }
    // Um título de pergunta fecha a secção anterior (o texto entre o título
    // e a marca é só informação).
    if (/^##\s/.test(linha)) {
      atual = null;
      seccao = null;
      continue;
    }
    const h3 = linha.match(/^###\s+(.*?)\s*$/);
    if (h3 && atual) {
      seccao =
        (Object.keys(SECCOES) as Seccao[]).find((s) =>
          SECCOES[s].test(h3[1]),
        ) ?? null;
      continue;
    }
    if (atual && seccao) atual.linhas[seccao].push(linha);
  }

  const itens: ItemLido[] = [];
  const erros: string[] = [];
  const vistos = new Set<string>();
  for (const b of blocos) {
    if (vistos.has(b.id)) {
      erros.push(`${b.id}: aparece mais de uma vez no ficheiro`);
      continue;
    }
    vistos.add(b.id);
    const r = lerBloco(b);
    if (typeof r === 'string') erros.push(`${b.id}: ${r}`);
    else itens.push(r);
  }
  return { itens, erros };
}

function lerBloco(b: EmCurso): ItemLido | string {
  const marcadas = new Set<Decisao>();
  for (const l of b.linhas.decisao) {
    const m = l.match(/^\s*[-*+]\s*\[([ xX])\]\s*(aprovar|rejeitar)\b/i);
    if (m && m[1] !== ' ') marcadas.add(m[2].toLowerCase() as Decisao);
  }
  if (marcadas.size > 1) return 'marcou aprovar e rejeitar ao mesmo tempo';
  const decisao = marcadas.size ? [...marcadas][0] : null;

  const resposta = desescapar(b.linhas.resposta.join('\n').trim());
  if (decisao === 'aprovar' && !resposta) return 'aprovado sem resposta';

  const fontes: Fonte[] = [];
  for (const f of itensDeLista(b.linhas.fontes)) {
    const md = f.match(/^\[(.*)\]\(\s*(\S+?)\s*\)$/);
    if (md) fontes.push({ titulo: md[1].trim(), url: md[2] });
    else if (/^https?:\/\/\S+$/.test(f)) fontes.push({ titulo: f, url: f });
    else return `fonte sem URL: "${f}" (usa [título](url) ou só o URL)`;
  }

  return {
    gabarito_id: b.id,
    decisao,
    resposta,
    factos_obrigatorios: itensDeLista(b.linhas.obrigatorios),
    factos_proibidos: itensDeLista(b.linhas.proibidos),
    fontes,
  };
}

/** Uma entrada por linha não vazia; o marcador de lista é opcional. */
function itensDeLista(linhas: string[]): string[] {
  return linhas
    .map((l) => l.replace(/^\s*[-*+]\s?/, '').trim())
    .filter((l) => l && !l.startsWith('<!--'));
}

/** Normaliza para comparar o que veio do ficheiro com o que está na BD. */
export function normalizar(c: ConteudoGabarito): ConteudoGabarito {
  return {
    resposta: c.resposta.replace(/\r\n/g, '\n').trim(),
    factos_obrigatorios: c.factos_obrigatorios.map(umaLinha).filter(Boolean),
    factos_proibidos: c.factos_proibidos.map(umaLinha).filter(Boolean),
    fontes: c.fontes.map((f) => ({
      titulo: umaLinha(f.titulo),
      url: f.url.trim(),
    })),
  };
}

export function mesmoConteudo(
  a: ConteudoGabarito,
  b: ConteudoGabarito,
): boolean {
  return JSON.stringify(normalizar(a)) === JSON.stringify(normalizar(b));
}
