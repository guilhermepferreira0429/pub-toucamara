/**
 * A pesquisa global do painel (⌘K): o texto como a base o compara. Sem
 * acentos nem maiúsculas, como a função `pesquisavel` da migração 0091
 * (unaccent do Postgres): «Conceição» e «conceicao» dão o mesmo.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * As palavras da pesquisa: todas têm de aparecer (em qualquer campo e por
 * qualquer ordem). As repetidas e as contidas noutra contam uma vez; no
 * máximo 5, para a consulta não crescer.
 */
export function termosDe(texto: string): string[] {
  const palavras = [...new Set(normalizar(texto).split(' ').filter(Boolean))];
  return palavras
    .filter((p) => !palavras.some((o) => o !== p && o.includes(p)))
    .slice(0, 5);
}

/** O texto para um LIKE: o %, o _ e a barra deixam de ser especiais. */
export function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Um número como se escreve: minúsculas, só letras, dígitos e a barra, e sem
 * zeros à esquerda. 'CP 412/2026' → 'cp412/2026', 'OC-0381' → 'oc381'. O
 * SQL faz a mesma conta sobre a coluna (NUMERO_COMPACTO no serviço).
 */
export function compactarNumero(texto: string): string {
  return normalizar(texto)
    .replace(/[^a-z0-9/]/g, '')
    .replace(/(^|[^0-9])0+(?=[0-9])/g, '$1');
}

export interface Numero {
  /** Para comparar com o número compactado da coluna. */
  compacto: string;
  /** Sem prefixo ('412/2026', '381'): serve a qualquer série. */
  semPrefixo: boolean;
}

/**
 * A pesquisa parece um número de processo, ocorrência ou reclamação? 'CP
 * 412/2026', 'cp412', 'OC-0381', '#381', '412/2026'. Os prefixos têm até 4
 * letras (CP, LO, OC, REC): 'obras 2026' é pesquisa por texto.
 */
export function numeroDe(texto: string): Numero | null {
  const t = normalizar(texto);
  if (!/^#?([a-z]{1,4})?\s*[-.]?\s*\d{1,7}(\s*\/\s*\d{2,4})?$/.test(t)) {
    return null;
  }
  const compacto = compactarNumero(t);
  return { compacto, semPrefixo: !/[a-z]/.test(compacto) };
}

/**
 * Um telefone completo (9 dígitos ou mais). Só se procura pelo número
 * inteiro: com bocados do número dava para adivinhar telefones de pessoas.
 */
export function pareceTelefone(texto: string): boolean {
  const t = texto.trim();
  return /^[+\d][\d\s().-]*$/.test(t) && t.replace(/\D/g, '').length >= 9;
}

/** Texto curto para uma linha de resultado. */
export function encurtar(texto: string | null, max = 90): string {
  const t = (texto ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}
