/*
 * Fábrica dos adaptadores: um sistema da BD → o Adaptador que lhe pergunta.
 * Todos passam pela mesma interface (igualdade de tratamento, spec secção 1).
 */
import type { Adaptador, Sistema } from '../tipos.js';
import { AdaptadorManual } from './manual.js';
import { AdaptadorTouChat } from './tou-chat.js';
import { AdaptadorTouVoz } from './tou-voz.js';
import { AdaptadorExterno } from './externo.js';

export interface OpcoesAdaptador {
  /** externo: browser visível (`--ver`). */
  ver?: boolean;
}

export function criarAdaptador(
  sistema: Sistema,
  opcoes: OpcoesAdaptador = {},
): Adaptador {
  switch (sistema.adaptador) {
    case 'tou-chat':
      return new AdaptadorTouChat(sistema);
    case 'tou-voz':
      return new AdaptadorTouVoz(sistema);
    case 'externo':
      return new AdaptadorExterno(sistema, { ver: opcoes.ver });
    case 'manual':
      return new AdaptadorManual(sistema);
    default:
      throw new Error(
        `Adaptador desconhecido: ${String((sistema as Sistema).adaptador)}`,
      );
  }
}

export { slugDoSistema, versaoAgente } from './tou-chat.js';
