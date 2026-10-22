import {
  Droplets,
  HeartHandshake,
  Snowflake,
  ThermometerSun,
  type LucideIcon,
} from "lucide-react";

export type TipoCampanha = "onda_calor" | "frio" | "corte_agua" | "outro";

export type EstadoDestinatario =
  | "por_ligar"
  | "a_ligar"
  | "bem"
  | "precisa_ajuda"
  | "atendeu"
  | "nao_atendeu"
  | "sem_ligacao"
  | "recusou"
  | "cancelado";

export type Contagens = Record<EstadoDestinatario, number>;

export interface Preset {
  tipo: TipoCampanha;
  titulo: string;
  mensagem: string;
  perguntas: string[];
  sms_recurso: string;
}

export interface Contacto {
  id: string;
  nome: string;
  telefone: string | null;
  morada: string | null;
  freguesia: string | null;
  notas: string | null;
  consentimento_em: string;
  consentimento_origem: string;
  ligavel: boolean;
}

export interface Contactos {
  contactos: Contacto[];
  freguesias: { nome: string; pessoas: number }[];
  presets: Preset[];
}

export interface CampanhaLista {
  id: string;
  tipo: TipoCampanha;
  titulo: string;
  estado: "a_ligar" | "terminada" | "cancelada";
  criada_em: string;
  terminada_em: string | null;
  criada_por_nome: string | null;
  contagens: Contagens;
}

export interface Destinatario {
  id: string;
  nome: string;
  telefone: string | null;
  morada: string | null;
  freguesia: string | null;
  notas: string | null;
  estado: EstadoDestinatario;
  necessidades: string[];
  nota: string | null;
  respondido_em: string | null;
  tratado_em: string | null;
  tratado_nota: string | null;
  tratado_por_nome: string | null;
  tentativas: number | null;
  chamada_erro: string | null;
  conversa_id: string | null;
}

export interface Campanha extends Omit<CampanhaLista, "contagens"> {
  mensagem: string;
  perguntas: string[];
  sms_recurso: string;
  freguesias: string[] | null;
  ignorar_horario: boolean;
  contagens: Contagens;
  total: number;
  destinatarios: Destinatario[];
}

export const TIPOS: Record<TipoCampanha, { rotulo: string; icone: LucideIcon; acao: string }> = {
  onda_calor: { rotulo: "Onda de calor", icone: ThermometerSun, acao: "Onda de calor, ligar a todos" },
  frio: { rotulo: "Frio intenso", icone: Snowflake, acao: "Frio intenso, ligar a todos" },
  corte_agua: { rotulo: "Corte de água", icone: Droplets, acao: "Corte de água, ligar a todos" },
  outro: { rotulo: "Outro contacto", icone: HeartHandshake, acao: "Contacto da ação social" },
};

export const NECESSIDADES: Record<string, string> = {
  agua: "água",
  transporte: "transporte",
  medicamentos: "medicamentos",
  companhia: "companhia",
  saude: "saúde",
  alimentacao: "alimentação",
  outro: "outro",
};

/** Quantas pessoas já têm um resultado (a chamada acabou). */
export function contactadas(c: Contagens): number {
  return c.bem + c.precisa_ajuda + c.atendeu + c.nao_atendeu + c.sem_ligacao + c.recusou;
}

export function total(c: Contagens): number {
  return Object.values(c).reduce((a, b) => a + b, 0);
}
