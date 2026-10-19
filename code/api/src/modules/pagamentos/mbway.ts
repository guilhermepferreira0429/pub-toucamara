import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/*
 * MB WAY em MODO DE TESTE. Como o Multibanco: fornecedor por escolher
 * (decisão em aberto 5), por isso o pedido é simulado. Nada é enviado a
 * nenhuma app nem a nenhum banco; o pedido "aceita-se" na página do link do
 * SMS e passa pelo mesmo caminho do webhook.
 *
 * Imita o real: o pedido chega à app do telemóvel e tem de ser aceite em
 * poucos minutos (as gateways dão 4 a 5); depois expira e pede-se outro.
 */

/** Minutos que o pedido de teste fica à espera de ser aceite. */
export const MBWAY_VALIDADE_MIN = 5;

/** Pedidos por pagamento (o primeiro + 2 reenvios). */
export const MBWAY_MAX_PEDIDOS = 3;

/**
 * Telemóvel português (9x xxx xxxx) em E.164, ou null. O MB WAY está
 * associado a um número móvel; fixos e números estrangeiros não servem.
 * Usa os metadados completos (`/max`): os mínimos não sabem o tipo.
 */
export function telemovelMbway(tel: string | null | undefined): string | null {
  if (!tel) return null;
  const n = parsePhoneNumberFromString(tel.trim(), 'PT');
  if (!n?.isValid() || n.country !== 'PT') return null;
  return n.getType() === 'MOBILE' ? n.number : null;
}

/** '+351912345214' → '9•• ••• 214' (para a página e para dizer). */
export function mascararTelemovel(e164: string): string {
  const d = e164.replace(/\D/g, '').slice(-9);
  return `${d.slice(0, 1)}•• ••• ${d.slice(-3)}`;
}

export type EstadoPedidoGuardado =
  'pendente' | 'pago' | 'expirado' | 'cancelado';
export type EstadoPedidoMbway =
  'por_aceitar' | 'pago' | 'expirado' | 'cancelado';

/** O estado que se mostra: um pendente fora de prazo já está expirado. */
export function estadoPedido(
  estado: EstadoPedidoGuardado,
  expiraEm: Date,
  agora = new Date(),
): EstadoPedidoMbway {
  if (estado !== 'pendente') return estado;
  return expiraEm.getTime() > agora.getTime() ? 'por_aceitar' : 'expirado';
}

/** Segundos até expirar (0 se já expirou), para a contagem decrescente. */
export function segundosRestantes(expiraEm: Date, agora = new Date()): number {
  return Math.max(0, Math.ceil((expiraEm.getTime() - agora.getTime()) / 1000));
}
