import type Anthropic from '@anthropic-ai/sdk';

export interface TurnoGuardado {
  papel: 'municipe' | 'agente' | 'funcionario' | 'sistema';
  texto: string;
}

/** Quantos turnos do fim da conversa vão ao modelo. */
export const MAX_TURNOS = 60;

/**
 * Reconstrói as mensagens para o modelo a partir dos turnos gravados da
 * sessão (munícipe → user, agente → assistant). Começa sempre por `user`
 * (a saudação inicial fica de fora) e a primeira mensagem leva o contexto
 * fixo da sessão. O resultado é igual de pedido para pedido, para a cache.
 */
export function mensagensDoHistorico(
  turnos: TurnoGuardado[],
  contexto: string,
): Anthropic.Beta.BetaMessageParam[] {
  const relevantes = turnos
    .filter((t) => t.papel === 'municipe' || t.papel === 'agente')
    .slice(-MAX_TURNOS);
  const primeiro = relevantes.findIndex((t) => t.papel === 'municipe');
  if (primeiro < 0) return [];

  return relevantes.slice(primeiro).map((t, i) => {
    if (t.papel === 'agente') {
      return { role: 'assistant' as const, content: t.texto };
    }
    if (i === 0) {
      return {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: contexto },
          { type: 'text' as const, text: t.texto },
        ],
      };
    }
    return { role: 'user' as const, content: t.texto };
  });
}
