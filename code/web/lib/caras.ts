/**
 * As caras das pessoas fictícias da demonstração (retratos gerados, não são
 * de ninguém), em public/caras/<n>.webp. Só os telefones da gama de teste
 * (+351 910 000 xxx) têm cara: um munícipe real nunca fica com a cara de
 * outra pessoa, mesmo que tenha o mesmo nome.
 *
 * A lista é gerada por scripts/caras.mjs a partir das imagens que existem.
 */
const COM_CARA = new Set<number>([]);

export function caraDemo(telefone: string | null | undefined): string | null {
  const m = /^\+351910000(\d{3})$/.exec((telefone ?? "").replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  return COM_CARA.has(n) ? `/caras/${n}.webp` : null;
}
