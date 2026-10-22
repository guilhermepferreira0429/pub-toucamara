import { z } from 'zod';
import type { Municipio } from '../modules/municipios/municipios.service.js';

/** Quem chama e de onde: igual para o ElevenLabs e para o chat. */
export interface ContextoFerramenta {
  municipio: Municipio;
  canal: 'telefone' | 'chat' | 'ia' | 'sms' | 'whatsapp';
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
/**
 * Os agentes que mostram as ferramentas ao modelo:
 * - `entrada`: o agente de voz que atende quem liga (linha e `/ligar`);
 * - `saida`: o agente de voz das chamadas que a câmara faz (campanhas,
 *   emergências, antecipações, renovações, processos);
 * - `chat`: o chat do site e da app.
 * A porta para as IAs (MCP) tem a sua lista (porta-ias/ferramentas-ia.ts).
 */
export const AGENTES = ['entrada', 'saida', 'chat'] as const;
export type Agente = (typeof AGENTES)[number];

/** Por omissão uma ferramenta é do atendimento: voz de entrada e chat. */
export const AGENTES_OMISSAO: readonly Agente[] = ['entrada', 'chat'];

export interface Ferramenta<E extends z.ZodObject = z.ZodObject> {
  nome: string;
  /**
   * Quando usar e o que devolve, em 1–2 frases (mais só o que é próprio
   * desta ferramenta). As regras gerais (ler os dados de volta, "dizer",
   * precisa_identificacao, não inventar…) estão uma vez nos prompts:
   * ferramentas/regras-gerais.ts.
   */
  descricao: string;
  entrada: E;
  /**
   * Que agentes mostram esta ferramenta ao modelo (AGENTES_OMISSAO se
   * faltar). Está sempre registada: /v1/agent/tools corre-a pelo nome.
   */
  agentes?: readonly Agente[];
  executar(ctx: ContextoFerramenta, entrada: z.output<E>): Promise<unknown>;
}

/** Só para inferir o tipo da entrada no `executar`. */
export function ferramenta<E extends z.ZodObject>(
  f: Ferramenta<E>,
): Ferramenta {
  return f;
}
