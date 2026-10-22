/*
 * Tipos do chat do munícipe. Espelham code/api/src/modules/chat
 * (chat.cartoes.ts e o resultado das ferramentas): os cartões chegam no
 * evento SSE `cartao` com o resultado da ferramenta em `dados`.
 */

export interface FonteCartao {
  titulo: string;
  url: string;
  entidade: string;
  referencia: string | null;
}

export type TipoCartao =
  | "contacto"
  | "marcacao"
  | "simulacao"
  | "pagamento"
  | "rascunho"
  | "requerimento"
  | "ocorrencia"
  | "passagem"
  | "vagas"
  | "processo"
  | "apoios"
  | "consulta"
  | "reclamacao"
  | "agora"
  | "empresa";

export type Cartao =
  | { tipo: "fonte"; fontes: FonteCartao[] }
  | { tipo: "emergencia"; telefone: "112"; dados: Record<string, unknown> }
  | { tipo: TipoCartao; ferramenta: string; dados: Record<string, unknown> };

export interface Mensagem {
  id: string;
  papel: "pessoa" | "agente";
  texto: string;
  cartoes: Cartao[];
  /**
   * pessoa: "enviada" | "por_enviar" (sem ligação, fica guardada).
   * agente: "a_responder" (stream aberto) | "feita" | "interrompida" | "erro".
   */
  estado: "enviada" | "por_enviar" | "a_responder" | "feita" | "interrompida" | "erro";
  /** Ferramenta a correr (indicador "a consultar…"). */
  ferramenta?: string | null;
  /** Ferramentas usadas no turno (decide p. ex. a identificação por SMS). */
  usadas?: string[];
  /** Erro a mostrar junto da mensagem (já escrito para pessoas). */
  aviso?: string | null;
  /** Hora local (HH:MM) para a etiqueta de data. */
  hora: string;
}

export type EstadoLigacao = "a_iniciar" | "pronto" | "sem_ligacao" | "indisponivel";
