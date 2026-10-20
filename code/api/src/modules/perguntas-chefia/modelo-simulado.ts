import type Anthropic from '@anthropic-ai/sdk';
import type { AbrirFluxo, FluxoMensagem } from '../../ia/agente-chat.js';

/*
 * Um modelo a fingir, para os testes: devolve as voltas por ordem e guarda os
 * pedidos. Não há chamadas à Anthropic nos testes.
 */

type Bloco = Anthropic.Beta.BetaContentBlock;

export interface Volta {
  blocos: Bloco[];
  stop: Anthropic.Beta.BetaStopReason;
}

export const texto = (t: string): Bloco => ({
  type: 'text',
  text: t,
  citations: null,
});

export const usar = (id: string, name: string, input: unknown): Bloco => ({
  type: 'tool_use',
  id,
  name,
  input,
});

export function simulado(voltas: Volta[]) {
  const pedidos: Anthropic.Beta.BetaMessageParam[][] = [];
  const params: Record<string, unknown>[] = [];
  const abrir: AbrirFluxo = (p) => {
    pedidos.push(structuredClone(p.messages));
    params.push(p as unknown as Record<string, unknown>);
    const v = voltas.shift();
    if (!v) throw new Error('Pedido a mais ao modelo.');
    const fluxo: FluxoMensagem = {
      async *[Symbol.asyncIterator]() {},
      finalMessage: () =>
        Promise.resolve({
          content: v.blocos,
          stop_reason: v.stop,
          usage: { input_tokens: 100, output_tokens: 20 },
        } as Anthropic.Beta.BetaMessage),
    };
    return fluxo;
  };
  return { abrir, pedidos, params };
}

/** Os tool_result da última mensagem `user` de um pedido. */
export function resultados(
  pedido: Anthropic.Beta.BetaMessageParam[],
): Anthropic.Beta.BetaToolResultBlockParam[] {
  const ultima = pedido[pedido.length - 1];
  return Array.isArray(ultima.content)
    ? ultima.content.filter(
        (b): b is Anthropic.Beta.BetaToolResultBlockParam =>
          b.type === 'tool_result',
      )
    : [];
}
