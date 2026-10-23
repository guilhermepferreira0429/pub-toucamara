/**
 * As caras das pessoas fictícias da demonstração (retratos gerados, não são
 * de ninguém), em public/caras/<n>.webp. Só os telefones da gama de teste
 * (+351 910 000 xxx) têm cara: um munícipe real nunca fica com a cara de
 * outra pessoa, mesmo que tenha o mesmo nome.
 *
 * A lista é gerada por scripts/caras.mjs a partir das imagens que existem.
 */
const COM_CARA = new Set<number>([]);

/**
 * Pelo telefone inteiro (a ação social recebe-o) ou pelo n que a API manda
 * quando o telefone vem mascarado (`cara_demo`).
 */
export function caraDemo(telefone: string | null | undefined, n?: number | null): string | null {
  const m = /^\+351910000(\d{3})$/.exec((telefone ?? "").replace(/\s/g, ""));
  const i = m ? Number(m[1]) : n;
  return i != null && COM_CARA.has(i) ? `/caras/${i}.webp` : null;
}
