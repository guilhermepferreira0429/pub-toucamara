const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function partes(d: string) {
  const [a, m, dia] = d.split("-").map(Number);
  return { a, m: m - 1, d: dia };
}

/** "1 a 31 de outubro de 2026", "28 de setembro a 4 de outubro de 2026". */
export function periodoPorExtenso(de: string, ate: string): string {
  const x = partes(de);
  const y = partes(ate);
  if (de === ate) return `${x.d} de ${MESES[x.m]} de ${x.a}`;
  if (x.a === y.a && x.m === y.m) return `${x.d} a ${y.d} de ${MESES[y.m]} de ${y.a}`;
  if (x.a === y.a) return `${x.d} de ${MESES[x.m]} a ${y.d} de ${MESES[y.m]} de ${y.a}`;
  return `${x.d} de ${MESES[x.m]} de ${x.a} a ${y.d} de ${MESES[y.m]} de ${y.a}`;
}

/** "outubro 2026" quando o período é um mês inteiro; senão o período. */
export function periodoCurto(de: string, ate: string): string {
  const x = partes(de);
  const y = partes(ate);
  const fimDoMes = new Date(y.a, y.m + 1, 0).getDate();
  if (x.d === 1 && x.a === y.a && x.m === y.m && y.d === fimDoMes) return `${MESES[x.m]} ${x.a}`;
  return periodoPorExtenso(de, ate);
}

export function mesDe(d: string): string {
  return MESES[partes(d).m];
}
