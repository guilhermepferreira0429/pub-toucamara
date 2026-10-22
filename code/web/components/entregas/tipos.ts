/*
 * Entregar o pedido em nome da pessoa. Espelha code/api/src/modules/entregas
 * (entregas.service.ts: vistaPublica, vistaPainel, modo).
 */

export type EstadoEntrega =
  | "preparado"
  | "a_espera_autorizacao"
  | "autorizado"
  | "entregue"
  | "falhou"
  | "expirado"
  | "cancelado";

export const ESTADO_ROTULO: Record<EstadoEntrega, string> = {
  preparado: "Preparado",
  a_espera_autorizacao: "À espera de autorização",
  autorizado: "Autorizado",
  entregue: "Entregue",
  falhou: "Falhou",
  expirado: "Expirou",
  cancelado: "Cancelado",
};

export interface ResumoPedido {
  tipo: { codigo: string; nome: string };
  requerente: string | null;
  campos: { rotulo: string; valor: string }[];
  documentos: { entregues: string[]; em_falta: string[] };
}

export interface Comprovativo {
  numero_entrada: string;
  recebido_em: string;
  documentos: string[];
  requerente: { nome: string | null; nif_mascarado: string | null };
  destino: string;
  simulado: boolean;
}

export interface EntregaPublica {
  municipio: string;
  estado: EstadoEntrega;
  estado_rotulo: string;
  resumo: ResumoPedido;
  confirmado_em: string;
  expira_em: string;
  simulado: boolean;
  aviso: string | null;
  autenticacao: {
    modo: "simulada" | "cmd";
    simulada: boolean;
    pin_demonstracao?: string;
    telefone_mascarado?: string | null;
    pede_telefone?: boolean;
    pede_nif?: boolean;
  };
  pode_autorizar: boolean;
  consentimento_em: string | null;
  autorizacao: {
    em: string;
    nome: string | null;
    nif_mascarado: string | null;
    nivel_garantia: string;
    simulada: boolean;
  } | null;
  comprovativo: (Comprovativo & { pdf: string }) | null;
  processo: { numero: string } | null;
  erro: string | null;
}

export interface ModoEntrega {
  simulado: boolean;
  estado: "simulado" | "real" | "real_por_configurar";
  autenticacao: {
    modo: string;
    rotulo: string;
    simulada: boolean;
    configurada: boolean;
    em_falta: string[];
  };
  submissao: {
    modo: string;
    rotulo: string;
    simulada: boolean;
    configurada: boolean;
    em_falta: string[];
  };
  validade_horas: number;
  aviso: string | null;
  o_que_falta: string[];
  documento: string;
}

export interface EntregaPainel {
  id: string;
  estado: EstadoEntrega;
  estado_rotulo: string;
  simulado: boolean;
  requerimento_id: string;
  processo: { id: string; numero: string | null } | null;
  municipe: { id: string; nome: string | null } | null;
  tipo: { codigo: string; nome: string };
  canal: string;
  confirmacao: string;
  confirmado_em: string;
  expira_em: string;
  consentimento_em: string | null;
  autorizado_em: string | null;
  autenticacao: {
    modo: string;
    nivel_garantia: string | null;
    nif_mascarado: string | null;
  };
  submissao: { modo: string };
  numero_entrada: string | null;
  entregue_em: string | null;
  comprovativo: Comprovativo | null;
  tentativas: number;
  tentativas_autenticacao: number;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ListaEntregas {
  modo: ModoEntrega;
  itens: EntregaPainel[];
}

export interface DetalheEntrega extends EntregaPainel {
  resumo: ResumoPedido;
  historico: { acao: string; ator_tipo: string; em: string; dados: Record<string, unknown> }[];
  modo: ModoEntrega;
}

/** Tom da pílula de cada estado no painel. */
export const TOM_ESTADO: Record<EstadoEntrega, "verde" | "ambar" | "terracota" | "neutro" | "tinta"> = {
  preparado: "neutro",
  a_espera_autorizacao: "ambar",
  autorizado: "tinta",
  entregue: "verde",
  falhou: "terracota",
  expirado: "neutro",
  cancelado: "neutro",
};
