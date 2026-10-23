/*
 * Tipos partilhados entre as partes do avaliador (ver o README). Mudar isto mexe
 * em todas as partes: acrescentar é seguro, alterar não.
 */

export const COMPORTAMENTOS = [
  'responder',
  'encaminhar',
  'ocorrencia',
  'perguntar',
  'passar_humano',
  'emergencia',
  'fora_ambito',
  'outra_lingua',
] as const;
export type Comportamento = (typeof COMPORTAMENTOS)[number];

export const VEREDICTOS = [
  'certa',
  'passada_bem',
  'errada',
  'sem_resposta',
] as const;
export type Veredicto = (typeof VEREDICTOS)[number];

export type TipoAdaptador = 'tou-chat' | 'tou-voz' | 'manual';

/** Uma pergunta como está em `avaliacao.perguntas`. */
export interface Pergunta {
  id: string;
  conjunto_id: string;
  ordem: number;
  categoria: string;
  texto: string;
  idioma: string;
  comportamento: Comportamento;
  entidade_esperada: string | null;
  nota: string | null;
}

/** Gabarito aprovado de uma pergunta para um município. */
export interface Gabarito {
  id: string;
  pergunta_id: string;
  municipio_id: string;
  resposta: string;
  factos_obrigatorios: string[];
  factos_proibidos: string[];
  fontes: { titulo: string; url: string }[];
  versao: number;
}

/** Um sistema avaliado, como está em `avaliacao.sistemas`. */
export interface Sistema {
  id: string;
  nome: string;
  municipio_id: string | null;
  adaptador: TipoAdaptador;
  url: string | null;
  config: Record<string, unknown>;
  nosso: boolean;
}

/** O que um adaptador devolve por pergunta. */
export interface RespostaSistema {
  texto: string;
  latencia_ms: number;
  /** PNG (adaptadores com browser): guarda-se em PASTA_SAIDA e a chave vai para `respostas.captura_key`. */
  captura?: Buffer;
  /** Só o nosso agente. */
  ferramentas?: string[];
  fontes?: { titulo: string; url: string }[];
  /** O que o sistema devolveu, para auditoria. */
  bruto?: unknown;
}

/**
 * Interface única de todos os sistemas: igualdade de tratamento. Cada
 * pergunta é uma conversa nova, como um munícipe faria.
 */
export interface Adaptador {
  perguntar(p: { texto: string; idioma: string }): Promise<RespostaSistema>;
  /** Pausa entre perguntas em ms (o nosso: 0; sistemas de outros: ritmo de pessoa). */
  pausa(): number;
  /** Quantas perguntas em paralelo (o nosso: 4; voz e sistemas de outros: 1). */
  paralelo: number;
  /** Libertar recursos (browser, ligações). */
  fechar?(): Promise<void>;
}

/** Erro do adaptador numa pergunta: fica na resposta e a execução segue. */
export class ErroAdaptador extends Error {
  constructor(
    message: string,
    /** true = o sistema mudou (ex.: seletor não encontrado): interromper. */
    readonly fatal = false,
  ) {
    super(message);
  }
}

/** Um comando da CLI. Cada parte exporta os seus em `<parte>/comandos.ts`. */
export interface Comando {
  /** Ex.: 'gabarito propor'. */
  nome: string;
  descricao: string;
  /** Uso, para a ajuda: '--municipio <slug> [--conjunto <nome>]'. */
  uso?: string;
  correr(args: Args): Promise<void>;
}

/** Argumentos da CLI: posicionais e --opcoes (flags sem valor = true). */
export interface Args {
  posicionais: string[];
  opcoes: Record<string, string | true>;
}
