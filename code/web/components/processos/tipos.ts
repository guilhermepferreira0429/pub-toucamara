/*
 * Formatos das respostas da API usados nos ecrãs dos processos
 * (code/api/src/modules/processos, integracoes, modelos, chamadas-saida).
 */

export const FASES = [
  "entrada",
  "documentos",
  "apreciacao",
  "pareceres_externos",
  "decisao",
  "notificado",
  "arquivado",
] as const;
export type Fase = (typeof FASES)[number];

export const FASE_ROTULO: Record<Fase, string> = {
  entrada: "Entrada",
  documentos: "Documentos",
  apreciacao: "Apreciação",
  pareceres_externos: "Pareceres externos",
  decisao: "Decisão",
  notificado: "Notificado",
  arquivado: "Arquivado",
};

export interface Pagina<T> {
  itens: T[];
  proximo_cursor: string | null;
}

export interface ProcessoResumo {
  id: string;
  numero: string;
  tipo: { codigo: string; nome: string };
  assunto: string;
  morada: string | null;
  fase: Fase;
  fase_rotulo: string;
  decisao: string | null;
  tecnico: { id: string; nome: string | null } | null;
  municipe: string | null;
  prazo_fim: string | null;
  dias_uteis_restantes: number | null;
  atrasado: boolean;
  aguarda_municipe: boolean;
  prazo_municipe: string | null;
  criado_em: string;
}

export type EstadoVerificacao =
  | "por_verificar"
  | "valido"
  | "fora_de_prazo"
  | "documento_errado"
  | "ilegivel";

export interface DocumentoProcesso {
  id: string;
  tipo_documento_id: string | null;
  tipo_documento: string | null;
  mime: string;
  tamanho: number | null;
  origem: string;
  verificacao_estado: EstadoVerificacao;
  verificacao: { regra: string; ok: boolean; detalhe: string }[] | null;
  emitido_em: string | null;
  recebido_em: string;
  url: string | null;
}

export interface PedidoMunicipe {
  id: string;
  evento_id: string;
  descricao: string;
  tipo_documento_id: string | null;
  nota: string | null;
  pedido_em: string;
  prazo: string;
  respondido_em: string | null;
  lembrete_enviado_em: string | null;
  estado: "por_responder" | "respondido" | "fora_de_prazo";
  dias_uteis_restantes: number | null;
}

export interface EventoProcesso {
  id: string;
  tipo: string;
  descricao: string;
  interno: boolean;
  ator_tipo: string;
  ator_id: string | null;
  ator_nome: string | null;
  dados: Record<string, unknown> | null;
  em: string;
}

export interface CampoRequerimento {
  chave: string;
  rotulo: string;
  tipo: string;
  obrigatorio: boolean;
  valor: string | null;
}

export interface ProcessoDetalhe {
  id: string;
  numero: string;
  tipo: { id: string; codigo: string; nome: string; prazo_dias_uteis: number };
  assunto: string;
  morada: string | null;
  freguesia: string | null;
  fase: Fase;
  fase_rotulo: string;
  decisao: "admitido" | "indeferido" | null;
  decidido_em: string | null;
  tecnico: { id: string; nome: string | null } | null;
  prazo: {
    inicio: string | null;
    fim: string | null;
    dias_uteis_restantes: number | null;
    atrasado: boolean;
  };
  municipe: {
    id: string;
    nome: string | null;
    telefone: string | null;
    tem_email: boolean;
    tem_nif: boolean;
  } | null;
  requerimento: {
    id: string;
    estado: string;
    conversa_id: string | null;
    dados: CampoRequerimento[];
    assinatura: string | null;
    assinatura_simulada: boolean;
    assinado_em: string | null;
    pdf_url: string | null;
    criado_em: string;
  } | null;
  documentos: DocumentoProcesso[];
  documentos_resumo: {
    tem: string[];
    faltam: string[];
    em_falta: { nome: string; prazo: string | null }[];
  };
  pedidos: PedidoMunicipe[];
  armazenamento_disponivel: boolean;
  eventos: EventoProcesso[];
  apoio: {
    resumo: { gerado_em: string; atualizado: boolean } | null;
    regulamento: { gerado_em: string; atualizado: boolean } | null;
    rascunhos: {
      total: number;
      rascunho: number;
      aprovado: number;
      descartado: number;
    } | null;
  } | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ResultadoSincronizacao {
  processo_id: string;
  gd_id: string | null;
  gd_estado: "nao_aplicavel" | "por_sincronizar" | "sincronizado" | "erro";
  gd_tentativas: number;
  enviados: { processo: boolean; documentos: number; fase: boolean };
  erro: string | null;
  proxima_tentativa_em: string | null;
}

export interface ChamadaSaida {
  id: string;
  motivo: string;
  estado: string;
  agendada_para: string;
  iniciada_em: string | null;
  erro: string | null;
}

export interface ProximoPrazo {
  data: string;
  de_quem: "camara" | "municipe";
  descricao: string;
  atrasado: boolean;
}

export interface ResumoProcesso {
  processo_id: string;
  numero: string;
  o_caso: string;
  requerente: string;
  o_que_ja_ha: string;
  o_que_falta: string;
  prazos: { texto: string; proximo: ProximoPrazo | null };
  pontos_de_atencao: string[];
  proximo_passo_sugerido: string;
  gerado_em: string;
  em_cache: boolean;
}

export interface TrechoDestacado {
  trecho_id: string;
  referencia: string | null;
  texto: string;
  fonte: string;
  entidade: string | null;
  url: string;
  data: string | null;
  origem: "base_legal" | "pesquisa";
  porque_se_aplica: string | null;
  destaques: { inicio: number; fim: number }[];
}

export interface Regulamento {
  processo_id: string;
  perguntas: string[];
  trechos: TrechoDestacado[];
  destacado: boolean;
  ia_disponivel: boolean;
  gerado_em: string | null;
  em_cache: boolean;
}

export const TIPOS_RASCUNHO = [
  "oficio",
  "pedido_elementos",
  "notificacao_sms",
] as const;
export type TipoRascunho = (typeof TIPOS_RASCUNHO)[number];

export const TIPO_RASCUNHO_ROTULO: Record<TipoRascunho, string> = {
  oficio: "Ofício ao munícipe",
  pedido_elementos: "Pedido de elementos",
  notificacao_sms: "Notificação por SMS",
};

export interface VersaoRascunho {
  versao: number;
  origem: string;
  autor: string | null;
  em: string;
  corpo: string;
}

export interface Rascunho {
  id: string;
  processo_id: string;
  tipo: TipoRascunho | "parecer";
  tipo_rotulo: string;
  estado: "rascunho" | "aprovado" | "assinado" | "enviado" | "descartado";
  versao: number;
  corpo: string;
  modelo_id: string | null;
  instrucoes: string | null;
  documentos_pedidos: { tipo_documento_id: string | null; nome: string }[] | null;
  prazo_dias_uteis: number | null;
  artigos_citados: { referencia: string; fonte: string }[];
  assinatura: string | null;
  assinatura_simulada: boolean;
  assinado_por: { id: string; nome: string | null } | null;
  assinado_em: string | null;
  pdf_url: string | null;
  pdf_aviso: string | null;
  aviso: string | null;
  pedido_ids: string[];
  criado_por: { id: string; nome: string | null } | null;
  criado_em: string;
  atualizado_em: string;
  descartado_em: string | null;
  versoes: VersaoRascunho[];
}

export interface DocumentoTipo {
  id: string;
  nome: string;
  obrigatorio: boolean;
  ordem: number;
  gerado_pelo_sistema: boolean;
  verificacoes: unknown;
}

export interface CampoFormulario {
  chave: string;
  rotulo: string;
  tipo: string;
  obrigatorio: boolean;
  pergunta_do_agente?: string;
  opcoes?: string[];
}

export interface TipoProcesso {
  id: string;
  codigo: string;
  nome: string;
  prazo_dias_uteis: number;
  frase_do_agente: string | null;
  ativo: boolean;
  servico: string | null;
  formulario: CampoFormulario[];
  documentos: DocumentoTipo[];
}

export const CANAIS_MODELO = ["oficio", "email", "sms"] as const;
export type CanalModelo = (typeof CANAIS_MODELO)[number];
export type EstadoModelo = "rascunho" | "a_rever" | "aprovado" | "substituido";

export interface InfoSms {
  codificacao: "gsm7" | "ucs2";
  caracteres: number;
  segmentos: number;
}

export interface Modelo {
  id: string;
  familia_id: string;
  canal: CanalModelo;
  nome: string;
  corpo: string;
  estado: EstadoModelo;
  versao: number;
  aprovado_por: string | null;
  aprovado_por_nome: string | null;
  aprovado_em: string | null;
  criado_por_nome: string | null;
  criado_em: string;
  atualizado_por_nome: string | null;
  atualizado_em: string;
  substituido_em: string | null;
  variaveis: string[];
  variaveis_invalidas: string[];
  sms: InfoSms | null;
}

export interface ModeloDetalhe extends Modelo {
  transicoes: EstadoModelo[];
  versoes: {
    id: string;
    versao: number;
    estado: EstadoModelo;
    nome: string;
    aprovado_em: string | null;
    aprovado_por_nome: string | null;
    criado_em: string;
    criado_por_nome: string | null;
    atualizado_em: string;
  }[];
  nova_versao?: boolean;
}

export interface VariavelModelo {
  nome: string;
  marcador: string;
  rotulo: string;
  descricao: string;
}

export interface PreVisualizacao {
  modelo_id: string;
  processo_id: string;
  canal: CanalModelo;
  estado: EstadoModelo;
  texto: string;
  valores: Record<string, string | null>;
  em_falta: string[];
  sms: InfoSms | null;
}

export interface MembroEquipa {
  id: string;
  nome: string;
  perfil: string;
  servico: string | null;
  ativo: boolean;
}
