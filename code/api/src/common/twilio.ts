/*
 * Webhooks do Twilio: X-Twilio-Signature = base64(HMAC-SHA1(auth token,
 * URL completo + cada parâmetro POST ordenado pelo nome, nome+valor)).
 * https://www.twilio.com/docs/usage/security#validating-requests
 */
import { createHmac, timingSafeEqual } from 'crypto';

export function assinaturaTwilio(
  authToken: string,
  url: string,
  parametros: Record<string, string>,
): string {
  const dados =
    url +
    Object.keys(parametros)
      .sort()
      .map((k) => k + parametros[k])
      .join('');
  return createHmac('sha1', authToken).update(dados, 'utf8').digest('base64');
}

export function assinaturaValida(
  authToken: string,
  url: string,
  parametros: Record<string, string>,
  recebida: string | undefined,
): boolean {
  if (!authToken || !recebida) return false;
  const esperada = Buffer.from(assinaturaTwilio(authToken, url, parametros));
  const dada = Buffer.from(recebida);
  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}

/** O corpo de um webhook (form) como o Twilio o assinou: tudo texto. */
export function parametrosTwilio(
  corpo: Record<string, unknown> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(corpo ?? {}).map(([k, v]) => [k, String(v)]),
  );
}
