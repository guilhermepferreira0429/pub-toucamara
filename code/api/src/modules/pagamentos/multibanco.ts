import { createHmac, randomInt, timingSafeEqual } from 'crypto';

/*
 * Referências Multibanco de TESTE. Fornecedor de pagamentos ainda por
 * escolher (decisão em aberto 5): até lá, a entidade é fictícia e nenhum
 * banco a reconhece. Nada é cobrado; `pagamentos.modo_teste = true`.
 *
 * O formato imita o real para a demo ser credível e o futuro fornecedor
 * encaixar sem mudar o modelo: entidade de 5 dígitos, referência de 9 =
 * 7 dígitos de base + 2 de controlo, calculados como no algoritmo usado
 * pelas gateways MB (pesos sobre entidade + base + valor, módulo 97).
 */

/** Entidade fictícia; nenhuma entidade real começa por 99999. */
export const ENTIDADE_TESTE = '99999';

const PESOS = [
  3, 30, 9, 90, 27, 76, 81, 34, 49, 5, 50, 15, 53, 45, 62, 38, 89, 17, 73, 51,
];

/** Os 2 dígitos de controlo de entidade (5) + base (7) + valor em cêntimos (8). */
export function digitosControlo(
  entidade: string,
  base: string,
  valorCent: number,
): string {
  if (!/^\d{5}$/.test(entidade) || !/^\d{7}$/.test(base)) {
    throw new RangeError('Entidade de 5 dígitos e base de 7.');
  }
  if (
    !Number.isInteger(valorCent) ||
    valorCent <= 0 ||
    valorCent > 99_999_999
  ) {
    throw new RangeError(`Valor inválido: ${valorCent}`);
  }
  const s = `${entidade}${base}${String(valorCent).padStart(8, '0')}`;
  let soma = 0;
  // Da direita para a esquerda, cada dígito com o seu peso.
  for (let i = 0; i < 20; i++) soma += Number(s[19 - i]) * PESOS[i];
  return String(98 - (soma % 97)).padStart(2, '0');
}

/** Referência de 9 dígitos para este valor; `base` aleatória se não vier. */
export function gerarReferencia(
  valorCent: number,
  entidade = ENTIDADE_TESTE,
  base = String(randomInt(10_000_000)).padStart(7, '0'),
): string {
  return `${base}${digitosControlo(entidade, base, valorCent)}`;
}

/** Confere os dígitos de controlo (e que a referência é deste valor). */
export function referenciaValida(
  entidade: string,
  referencia: string,
  valorCent: number,
): boolean {
  if (!/^\d{9}$/.test(referencia)) return false;
  try {
    return (
      digitosControlo(entidade, referencia.slice(0, 7), valorCent) ===
      referencia.slice(7)
    );
  } catch {
    return false;
  }
}

/** '123456789' → '123 456 789', como aparece no talão. */
export function formatarReferencia(ref: string): string {
  return ref.replace(/(\d{3})(?=\d)/g, '$1 ');
}

/**
 * Assinatura do webhook de pagamentos: `X-Assinatura: sha256=<hex>` com
 * HMAC-SHA256 do corpo tal como chegou (`req.rawBody`). Comparação em tempo
 * constante.
 */
export function assinaturaValida(
  corpo: Buffer | string,
  cabecalho: string | undefined,
  segredo: string,
): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(cabecalho?.trim() ?? '');
  if (!m) return false;
  const esperado = createHmac('sha256', segredo).update(corpo).digest();
  return timingSafeEqual(Buffer.from(m[1], 'hex'), esperado);
}

/** Para testes e para quem integra: o cabeçalho a mandar. */
export function assinar(corpo: Buffer | string, segredo: string): string {
  return `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;
}
