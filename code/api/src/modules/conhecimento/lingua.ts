/*
 * Em que língua vem a pergunta (para a pesquisa): as fontes estão quase
 * todas em português, mas as de turismo existem também em inglês, espanhol e
 * francês, com o mesmo conteúdo. Uma pergunta em português não deve trazer as
 * versões noutras línguas (ocupavam os lugares das fontes portuguesas) e uma
 * em inglês deve preferir a versão inglesa. Heurística por palavras comuns,
 * sem serviços de fora; na dúvida, português.
 */

type Lingua = 'pt' | 'en' | 'es' | 'fr';

const MARCAS: Record<Lingua, string> = {
  pt:
    'o os as é são como onde quando posso qual do da dos das não um uma para com ' +
    'tenho preciso há está ao à pelo pela quanto custa horário câmara licença obras ' +
    'castelo comboio visitar',
  en:
    'the is are what where how when can i do does to of and open opening hours ' +
    'ticket tickets castle museum train bus near visit please there which you get ' +
    'from my it in much time',
  es:
    'el los las qué cómo dónde cuándo hay puedo horario museo castillo tren autobús ' +
    'cerca es son del una y llego llegar desde cuánto cuesta iglesia tengo necesito ' +
    'oporto ver en',
  fr:
    'le les des est sont où comment quand quel quelle je peux horaires musée château ' +
    'gare près visiter du une et il venir depuis combien coûte église aller pour en au aux',
};

const LINGUAS: Lingua[] = ['pt', 'en', 'es', 'fr'];

const CONJUNTOS = Object.fromEntries(
  LINGUAS.map((l) => [l, new Set(MARCAS[l].split(' '))]),
) as Record<Lingua, Set<string>>;

/** 'pt', 'en', 'es' ou 'fr'; na dúvida (empate ou nada), 'pt'. */
export function linguaProvavel(texto: string): Lingua {
  const palavras = texto
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
  const pontos: Record<Lingua, number> = { pt: 0, en: 0, es: 0, fr: 0 };
  for (const p of palavras) {
    for (const l of LINGUAS) if (CONJUNTOS[l].has(p)) pontos[l]++;
  }
  if (/[¿¡ñ]/.test(texto)) pontos.es += 2;
  if (/[çã]/.test(texto)) pontos.pt += 1;
  if (/[èêëœ]|\b(qu'|l'|d'|j')/i.test(texto)) pontos.fr += 2;
  let melhor: Lingua = 'pt';
  for (const l of LINGUAS) if (pontos[l] > pontos[melhor]) melhor = l;
  return melhor;
}

/** As línguas das fontes a procurar: sempre português, mais a da pergunta. */
export function linguasDaPesquisa(pergunta: string): string[] {
  const l = linguaProvavel(pergunta);
  return l === 'pt' ? ['pt'] : ['pt', l];
}
