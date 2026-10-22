/*
 * Menos dados pessoais no que vai para a Claude: emails, IBAN, cartões,
 * telefones e NIF que aparecem num texto livre (uma transcrição, um email, a
 * descrição de uma ocorrência) passam a uma etiqueta.
 *
 * Só onde não fazem falta (resumos, classificação, propostas, análises):
 * preencher um requerimento precisa do NIF, por isso a minimização é por
 * pedido (`PedidoIa.minimizar`), não global.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// PT50 0002 0123 1234 5678 9015 4: duas letras, dois algarismos e grupos de até 4.
const IBAN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g;
// 13 a 19 algarismos, com espaços ou hífenes; só conta se passar o Luhn.
const CARTAO = /\b\d(?:[ -]?\d){12,18}\b/g;
// Portugueses: 9 algarismos a começar por 2 ou 9, com ou sem indicativo. O
// \b fica antes do indicativo ou do número: "00351912345678" colado também
// conta (com o \b depois de "351", não contava).
const TELEFONE =
  /(?:(?:\+|\b00)351[\s.-]?|\b)[29]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g;
const NIF = /\b[1-35-9]\d{8}\b/g;

function luhn(numero: string): boolean {
  let soma = 0;
  let dobra = false;
  for (let i = numero.length - 1; i >= 0; i--) {
    let d = Number(numero[i]);
    if (dobra) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
    dobra = !dobra;
  }
  return soma % 10 === 0;
}

/** O mesmo teste do NIF de municipes.service (cópia: o ia/ não depende dos módulos). */
function nifValido(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false;
  const soma = [...nif.slice(0, 8)].reduce(
    (s, d, i) => s + Number(d) * (9 - i),
    0,
  );
  const controlo = 11 - (soma % 11);
  return Number(nif[8]) === (controlo >= 10 ? 0 : controlo);
}

export function minimizar(texto: string): string {
  return texto
    .replace(EMAIL, '[email]')
    .replace(IBAN, '[iban]')
    .replace(CARTAO, (m) => (luhn(m.replace(/\D/g, '')) ? '[cartão]' : m))
    .replace(TELEFONE, '[telefone]')
    .replace(NIF, (m) => (nifValido(m) ? '[nif]' : m));
}
