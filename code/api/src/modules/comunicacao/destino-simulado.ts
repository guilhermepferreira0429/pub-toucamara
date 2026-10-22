import { eTelefoneDemonstracao } from '../demo/demo.regras.js';

/*
 * O único ponto que decide se um envio pode sair para um fornecedor (Twilio
 * para SMS/WhatsApp, ElevenLabs para chamadas). Usado no MensagensService e
 * no ChamadasSaidaService, mesmo antes de qualquer pedido para fora.
 *
 * Dois casos nunca saem, com qualquer fornecedor e em qualquer ambiente:
 *  - 'simulado': o registo vem de uma fonte simulada (ex.: números gerados
 *    pela fonte simulada dos operadores nos avisos de emergência). Podem
 *    coincidir com números reais: o que manda é a marca no registo.
 *  - 'demonstracao': a gama de teste da demonstração (+351 910 000 xxx).
 */

/** O `provider_id` que fica gravado em cada caso. */
export const FORNECEDOR_SIMULADO = 'simulado';
export const FORNECEDOR_DEMONSTRACAO = 'demonstracao';

export type DestinoSimulado =
  | { motivo: 'simulado'; fornecedor: typeof FORNECEDOR_SIMULADO }
  | { motivo: 'demonstracao'; fornecedor: typeof FORNECEDOR_DEMONSTRACAO };

/**
 * Null = pode sair. A marca `simulado` tem de vir a `false` explícito para o
 * envio seguir: em falta (undefined/null), na dúvida, não sai.
 */
export function destinoSimulado(e: {
  destino: string | null | undefined;
  simulado: boolean | null | undefined;
}): DestinoSimulado | null {
  if (e.simulado !== false) {
    return { motivo: 'simulado', fornecedor: FORNECEDOR_SIMULADO };
  }
  if (eTelefoneDemonstracao(e.destino)) {
    return { motivo: 'demonstracao', fornecedor: FORNECEDOR_DEMONSTRACAO };
  }
  return null;
}
