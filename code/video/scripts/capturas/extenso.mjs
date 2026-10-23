/*
 * Números por extenso (português de Portugal), como o agente os diz ao
 * telefone ("dois de novembro", "trinta euros"). Só o que a chamada precisa.
 */
const UNIDADES = [
  'zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
  'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezasseis', 'dezassete',
  'dezoito', 'dezanove',
];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

export function porExtenso(n) {
  if (n < 20) return UNIDADES[n];
  if (n < 100) {
    const d = Math.floor(n / 10);
    const u = n % 10;
    return u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d];
  }
  if (n === 100) return 'cem';
  if (n < 1000) {
    const c = Math.floor(n / 100);
    const r = n % 100;
    return r ? `${CENTENAS[c]} e ${porExtenso(r)}` : CENTENAS[c];
  }
  return String(n);
}

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** '2026-11-02' → 'dois de novembro' */
export function diaPorExtenso(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${porExtenso(d)} de ${MESES[m - 1]}`;
}

/** 3000 cêntimos → 'trinta euros' (com cêntimos, se os houver). */
export function eurosPorExtenso(cent) {
  const e = Math.floor(cent / 100);
  const c = cent % 100;
  const euros = e === 1 ? 'um euro' : `${porExtenso(e)} euros`;
  return c ? `${euros} e ${porExtenso(c)} cêntimos` : euros;
}
