/*
 * Formatos das respostas da API (code/api) usados nos ecrãs de atendimento
 * e indicadores. Só o que os ecrãs leem; datas chegam como texto ISO.
 */

export interface Pagina<T> {
  itens: T[];
  proximo_cursor: string | null;
}

export type Canal = "telefone" | "chat" | "sms" | "email" | "balcao" | "whatsapp";

export type Resultado =
  | "em_curso"
  | "resolvida"
  | "passada_funcionario"
  | "sem_resposta"
  | "marcacao"
  | "emergencia"
  | "caiu";

export interface Indicador {
  valor: number | null;
  anterior: number | null;
  variacao: number | null;
  unidade: "n" | "pct" | "s";
}

export interface Periodo {
  de: string;
  ate: string;
}

export interface TemaTop {
  tema_id: string;
  tema: string;
  total: number;
  percentagem: number | null;
  anterior: number;
  variacao: number | null;
  novo: boolean;
}

export interface PassagemAtencao {
  id: string;
  conversa_id: string;
  motivo: string;
  resumo: string;
  estado: string;
  responder_ate: string | null;
  criada_em: string;
  atribuida_a: string | null;
  atribuida_a_nome: string | null;
  atrasada: boolean;
}

export interface SemRespostaItem {
  id: string;
  texto: string;
  vezes: number;
  estado: string;
  o_que_falta: string | null;
  ultima_em: string;
}

export interface PrazoItem {
  id: string;
  numero: string;
  assunto: string;
  fase: string;
  prazo_fim: string;
  tecnico_id: string | null;
  tecnico: string | null;
  dias_uteis_restantes: number;
  atrasado: boolean;
}

export interface VisaoGeral {
  periodo: Periodo;
  periodo_anterior: Periodo;
  indicadores: Record<
    | "conversas"
    | "chamadas"
    | "escritas"
    | "resolvidas_sem_humano_pct"
    | "passadas"
    | "sem_resposta"
    | "marcacoes"
    | "fora_de_horas_pct"
    | "duracao_media_s",
    Indicador
  >;
  trabalho_semana: Periodo & {
    requerimentos: number;
    ocorrencias_agente: number;
    consultas_processo: number;
    referencias_mb: number;
    marcacoes: number;
    recolhas: number;
    passagens: number;
  };
  quando_ligam: { dias: string[]; celulas: number[][]; maximo: number };
  o_que_perguntam: TemaTop[];
  atencao: {
    passagens: { total: number; atrasadas: number; itens: PassagemAtencao[] };
    ocorrencias_novas: {
      total: number;
      itens: {
        id: string;
        numero: string;
        categoria: string;
        descricao: string;
        morada: string;
        criada_em: string;
      }[];
    };
    prazos_a_acabar: { ate: string; itens: PrazoItem[] };
    sem_resposta: { itens: SemRespostaItem[] };
  };
  melhorias_portal: {
    propostas: number;
    enviadas: number;
    publicadas: number;
    rejeitadas: number;
    perguntas_resolvidas: number;
    vezes_resolvidas: number;
  } | null;
}

export interface SerieBalde {
  balde: string;
  conversas: { total: number; por_canal: Record<string, number> };
  resolvidas_sem_humano_pct: number | null;
  passadas: number;
  fora_de_horas_pct: number | null;
  duracao_media_s: number | null;
}

export interface Indicadores {
  periodo: Periodo;
  agrupar: "dia" | "semana";
  series: SerieBalde[];
  totais: {
    conversas: number;
    chamadas: number;
    escritas: number;
    resolvidas_sem_humano: number;
    resolvidas_sem_humano_pct: number | null;
    passadas: number;
    sem_resposta: number;
    marcacoes: number;
    emergencias: number;
    fora_de_horas: number;
    fora_de_horas_pct: number | null;
    duracao_media_s: number | null;
    por_canal: Record<string, number>;
    sms: { enviados: number; segmentos: number; custo_cent: number };
    ocorrencias: {
      registadas: number;
      resolvidas: number;
      tempo_medio_resolucao_h: number | null;
      abertas_agora: number;
    };
  };
  processos: {
    em_curso: number;
    atrasados: number;
    por_fase: {
      fase: string;
      total: number;
      atrasados: number;
      dias_medios_na_fase: number | null;
    }[];
    por_tecnico: {
      tecnico_id: string | null;
      tecnico: string;
      total: number;
      atrasados: number;
    }[];
  };
}

export interface Qualidade {
  limiar: number;
  versao_atual: string | null;
  publicacao: { pode_publicar: boolean; motivo: string | null };
  ultima: {
    execucao_id: string;
    terminada_em: string | null;
    total: number | null;
    certas: number | null;
    passadas_bem: number | null;
    erradas: number | null;
    sem_resposta: number | null;
    perguntas: number;
    taxa: number | null;
    passou: boolean;
  } | null;
}

export interface ConversaLista {
  id: string;
  canal: Canal;
  iniciada_em: string;
  duracao_s: number | null;
  resultado: Resultado;
  fora_de_horas: boolean | null;
  resumo: string | null;
  revisao: "certa" | "errada" | null;
  tema: { id: string; nome: string | null } | null;
  municipe: { id: string; nome: string | null; telefone: string | null } | null;
  momentos: number;
}

export interface Turno {
  id: string;
  ordem: number;
  papel: "agente" | "municipe" | "funcionario" | "sistema";
  texto: string;
  inicio_ms: number | null;
  fim_ms: number | null;
}

export interface Momento {
  id: string;
  tipo: string;
  em_ms: number | null;
  turno_id: string | null;
  dados: Record<string, unknown>;
  criado_em: string;
}

export interface Citacao {
  turno_id: string;
  trecho_id: string;
  referencia: string | null;
  trecho: string;
  fonte: string;
  url: string | null;
  entidade: string;
  lida_em: string | null;
}

export interface ConversaDetalhe {
  id: string;
  canal: Canal;
  iniciada_em: string;
  terminada_em: string | null;
  duracao_s: number | null;
  idioma: string;
  fora_de_horas: boolean | null;
  resultado: Resultado;
  tema: { id: string; nome: string | null } | null;
  resumo: string | null;
  proximos_passos: string[];
  resumo_sms: string | null;
  resumida_em: string | null;
  continuacao_de: string | null;
  historico_municipe: {
    id: string;
    canal: Canal;
    iniciada_em: string;
    resultado: Resultado;
    tema: { id: string; nome: string | null } | null;
    resumo: string | null;
    continuada_por_esta: boolean;
  }[];
  agente_versao: string | null;
  consentimento_em: string | null;
  tem_gravacao: boolean;
  revisao: {
    valor: "certa" | "errada" | null;
    nota: string | null;
    por: { id: string; nome: string } | null;
    em: string | null;
  };
  municipe: {
    id: string;
    nome: string | null;
    telefone: string | null;
    conversas_anteriores: number;
  } | null;
  turnos: Turno[];
  momentos: Momento[];
  citacoes: Citacao[];
  criado: {
    requerimentos: {
      id: string;
      tipo: string;
      estado: string;
      campos_em_falta: string[];
      processo_id: string | null;
    }[];
    processos: { id: string; numero: string; assunto: string; fase: string }[];
    ocorrencias: {
      id: string;
      numero: string;
      categoria: string;
      morada: string;
      estado: string;
    }[];
    marcacoes: {
      id: string;
      agenda: string;
      local: string | null;
      inicio: string;
      assunto: string | null;
      levar: string[] | null;
      estado: string;
    }[];
    recolhas: { id: string; janela_inicio: string; estado: string }[];
    pagamentos: {
      id: string;
      valor_cent: number;
      estado: string;
      pagar_ate: string | null;
      modo_teste: boolean;
    }[];
    passagens: {
      id: string;
      motivo: string;
      estado: string;
      responder_ate: string | null;
    }[];
  };
}

export type TipoItem = "passagem" | "email" | "processo" | "ocorrencia" | "pedido";

export interface ItemEntrada {
  tipo: TipoItem;
  id: string;
  canal: string;
  assunto: string;
  resumo: string | null;
  municipe: string | null;
  servico: { id: string; nome: string | null } | null;
  tecnico: { id: string; nome: string | null } | null;
  estado: string;
  urgente: boolean;
  prazo_resposta: string | null;
  criado_em: string;
  link_painel: string;
  encaminhamento: {
    motivo: string;
    automatico: boolean | null;
    em: string;
  } | null;
}

export interface ResumoEntrada {
  total: number;
  urgentes: number;
  por_atribuir: number;
  por_tipo: Record<TipoItem, number>;
  por_canal: Record<string, number>;
}

export interface Passagem {
  id: string;
  conversa_id: string;
  motivo: string;
  resumo: string;
  estado: "aberta" | "em_curso" | "respondida" | "fechada";
  fora_de_horas: boolean;
  preferencia_resposta: "chat" | "telefone" | "sms" | "email" | null;
  responder_ate: string | null;
  atrasada: boolean;
  criada_em: string;
  respondida_em: string | null;
  atribuida_a: { id: string; nome: string } | null;
  canal: string;
  municipe: {
    id: string;
    nome: string | null;
    telefone: string | null;
    tem_telefone: boolean;
    tem_email: boolean;
  } | null;
  conversa?: {
    id: string;
    canal: string;
    iniciada_em: string;
    terminada_em: string | null;
    resumo: string | null;
    resultado: string;
  };
  respostas?: {
    id: string;
    canal: string;
    corpo: string;
    estado: string;
    enviar_em: string;
    enviada_em: string | null;
  }[];
}

export interface EmailLista {
  id: string;
  de: string;
  assunto: string | null;
  excerto: string | null;
  recebido_em: string;
  estado: "nova" | "respondida" | "encaminhada" | "virou_processo";
  servico_id: string | null;
  servico: string | null;
  entidade: string | null;
  tema: string | null;
  confianca: number | null;
  tem_rascunho: boolean;
  num_anexos: number;
}

export interface EmailDetalhe {
  id: string;
  de: string;
  para: string | string[] | null;
  assunto: string | null;
  texto: string | null;
  anexos: { nome: string; mime: string; tamanho: number }[] | null;
  recebido_em: string;
  estado: EmailLista["estado"];
  servico_id: string | null;
  servico: string | null;
  servico_email: string | null;
  entidade: string | null;
  tema: string | null;
  confianca: number | null;
  rascunho_resposta: string | null;
  classificado_em: string | null;
  resposta: string | null;
  respondido_em: string | null;
  respondido_por_nome: string | null;
  encaminhado_em: string | null;
  processo_id: string | null;
  fontes: {
    trecho_id: string;
    referencia: string | null;
    titulo: string;
    url: string | null;
    entidade: string;
  }[];
}

export interface PedidoEntrada {
  id: string;
  tipo: string;
  canal: string;
  assunto: string;
  descricao: string;
  estado: string;
  urgente: boolean;
  prazo_resposta: string | null;
  conversa_id: string | null;
  processo_id: string | null;
  criado_em: string;
  municipe: string | null;
  servico: { id: string; nome: string | null } | null;
  tecnico: { id: string; nome: string | null } | null;
  link_painel: string;
}

export interface Servico {
  id: string;
  nome: string;
}

export interface Pessoa {
  id: string;
  nome: string;
  servico_id: string | null;
}

/* Gestão (V2) */

export interface Carga {
  hoje: string;
  a_terminar_ate: string;
  a_terminar_dias_uteis: number;
  formula: string;
  totais: {
    abertos: number;
    atrasados: number;
    a_terminar: number;
    aguarda_municipe: number;
    passagens_em_curso: number;
    ocorrencias_abertas: number;
    carga: number;
  };
  servicos: {
    servico_id: string | null;
    servico: string;
    abertos: number;
    atrasados: number;
    a_terminar: number;
    carga: number;
  }[];
  tecnicos: {
    tecnico_id: string | null;
    tecnico: string;
    servico_id: string | null;
    servico: string | null;
    abertos: number;
    atrasados: number;
    a_terminar: number;
    aguarda_municipe: number;
    passagens_em_curso: number;
    carga: number;
  }[];
}

export interface TempoFase {
  fase: string;
  rotulo: string;
  processos: number;
  media_dias_uteis: number | null;
  mediana_dias_uteis: number | null;
}

export interface ContasTempos {
  decididos: number;
  media_dias_uteis: number | null;
  mediana_dias_uteis: number | null;
  com_prazo: number;
  dentro_do_prazo_pct: number | null;
  fases: TempoFase[];
}

export interface Tempos {
  periodo: Periodo;
  notas: string[];
  total: ContasTempos;
  tipos: (ContasTempos & {
    tipo_id: string;
    codigo: string;
    nome: string;
    prazo_legal_dias_uteis: number;
  })[];
}

export interface OndeParam {
  regra: { descricao: string };
  total_em_curso: number;
  total_parados: number;
  fases: {
    fase: string;
    rotulo: string;
    em_curso: number;
    parados: number;
    dias_parados: number;
    normal_dias_uteis: number | null;
  }[];
  gargalo: {
    fase: string;
    rotulo: string;
    parados: number;
    dias_parados: number;
  } | null;
  mais_parados: {
    id: string;
    numero: string;
    tipo: string;
    fase_rotulo: string;
    dias_parado: number;
    tecnico: string | null;
    vez: "camara" | "municipe";
  }[];
}

export interface Atrasado {
  id: string;
  numero: string;
  tipo: string;
  tipo_nome: string;
  assunto: string;
  fase: string;
  fase_rotulo: string;
  tecnico_id: string | null;
  tecnico: string | null;
  prazo_fim: string;
  dias_atraso: number;
  dias_atraso_corridos: number;
  vez: "camara" | "municipe";
}

/* Perguntas da chefia */

export type Valor = number | string | boolean | null;

export interface ConsultaPublica {
  id: string;
  ferramenta: string;
  parametros: unknown;
  linhas_devolvidas: number;
  filtros: Record<string, unknown> | null;
  fonte: string | null;
  notas: string[];
  erro: string | null;
}

export interface RespostaPergunta {
  id: string;
  pergunta: string;
  resposta: string;
  numeros_chave: {
    rotulo: string;
    valor: Valor;
    unidade: string | null;
    consulta: string;
  }[];
  tabela: {
    consulta: string;
    colunas: { chave: string; rotulo: string }[];
    linhas: Record<string, Valor>[];
    objeto: "processo" | "ocorrencia" | null;
    total_linhas: number;
  } | null;
  consultas: ConsultaPublica[];
  sugestoes: string[];
  sem_dados: boolean;
  texto_verificado: boolean;
  fim: string;
  ms: number;
}
