import { z } from 'zod';
import type { Municipio } from '../modules/municipios/municipios.service.js';

/** Quem chama e de onde: igual para o ElevenLabs e para o chat. */
export interface ContextoFerramenta {
  municipio: Municipio;
  canal: 'telefone' | 'chat' | 'ia';
  /** id em `conversas` (já criada). */
  conversaId: string | null;
  /** Munícipe ligado à conversa (pelo número que liga ou identificado depois). */
  municipeId: string | null;
  /** Número de quem liga, em E.164. */
  telefone: string | null;
}

/**
 * Uma ferramenta do agente (secção 5.3 do plano). A mesma definição valida o
 * pedido, aparece no catálogo (JSON Schema para o ElevenLabs e para o Claude)
 * e corre no chat do lado do servidor.
 *
 * A `descricao` é para o modelo: quando usar e o que fazer com o resultado.
 * O resultado volta ao modelo tal como está: curto, em português, sem ids
 * que ele não precise de repetir.
 */
export interface Ferramenta<E extends z.ZodObject = z.ZodObject> {
  nome: string;
  descricao: string;
  entrada: E;
  executar(ctx: ContextoFerramenta, entrada: z.output<E>): Promise<unknown>;
}

/** Só para inferir o tipo da entrada no `executar`. */
export function ferramenta<E extends z.ZodObject>(
  f: Ferramenta<E>,
): Ferramenta {
  return f;
}
