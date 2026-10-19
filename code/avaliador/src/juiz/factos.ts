/*
 * Verificação determinística de factos (antes e por cima do juiz).
 *
 * O modelo pode não reparar num número errado escrito com outros espaços, ou
 * num nome de entidade sem acentos. Aqui procuramos literalmente os factos do
 * gabarito no texto, com normalização, e juntamos o resultado ao do juiz. Um
 * facto proibido encontrado aqui conta SEMPRE como errado, mesmo que o modelo
 * não o veja: é a parte do veredicto que não depende de ninguém.
 */

/**
 * Minúsculas, sem acentos, pontuação → espaço, espaços colapsados e
 * separadores entre algarismos removidos ("800 910 410" = "800-910-410" =
 * "800910410"), para que telefones e códigos postais batam qualquer que seja
 * a forma como o sistema os escreveu.
 */
export function normalizar(texto: string): string {
  return (
    texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Separadores entre algarismos: espaço, ponto, hífen, barra.
      .replace(/(\d)[\s.\-–/]+(?=\d)/g, '$1')
      // O resto da pontuação não conta para o sentido.
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
  );
}

/**
 * true se `facto` aparece no texto como sequência inteira de palavras/
 * algarismos: "112" não bate com "1120", "agua" não bate com "aguas".
 */
export function contemFacto(texto: string, facto: string): boolean {
  const t = ` ${normalizar(texto)} `;
  const f = normalizar(facto);
  if (!f) return false;
  return t.includes(` ${f} `);
}

export interface FactosDeterministicos {
  obrigatoriosEncontrados: string[];
  proibidosEncontrados: string[];
  /** "112" aparece no texto. */
  menciona112: boolean;
}

export function verificarFactos(
  texto: string,
  gabarito: { factos_obrigatorios: string[]; factos_proibidos: string[] },
): FactosDeterministicos {
  return {
    obrigatoriosEncontrados: gabarito.factos_obrigatorios.filter((f) =>
      contemFacto(texto, f),
    ),
    proibidosEncontrados: gabarito.factos_proibidos.filter((f) =>
      contemFacto(texto, f),
    ),
    menciona112: contemFacto(texto, '112'),
  };
}

/**
 * O juiz deve copiar os factos tal como estão no gabarito, mas pode mudar
 * uma vírgula ou usar o identificador ("O2"). Isto decide se o que o juiz
 * escreveu se refere a `facto` (o i-ésimo da lista, com prefixo O ou P).
 */
export function mesmoFacto(
  doJuiz: string,
  facto: string,
  id?: string,
): boolean {
  const a = normalizar(doJuiz);
  const b = normalizar(facto);
  if (!a || !b) return false;
  if (id && (a === id.toLowerCase() || a.startsWith(id.toLowerCase() + ' ')))
    return true;
  if (a === b) return true;
  // Contido um no outro só conta se forem de tamanho parecido: "253" não
  // pode valer pelo telefone inteiro.
  const [curto, longo] = a.length < b.length ? [a, b] : [b, a];
  return longo.includes(curto) && curto.length >= 0.6 * longo.length;
}
