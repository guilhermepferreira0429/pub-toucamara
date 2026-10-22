/*
 * Formatos da API do conhecimento (code/api/src/modules/conhecimento,
 * painel-conhecimento.service.ts, edicao.service.ts, avaliacao.service.ts,
 * melhorias.service.ts). snake_case como chegam.
 */

export interface TemaMapa {
  tema_id: string;
  nome: string;
  pai_id: string | null;
  conversas_30d: number;
  respostas_no_ar: number;
  respostas_total: number;
}

export interface Mapa {
  temas: TemaMapa[];
  resumo: {
    respostas_no_ar: number;
    sem_resposta_abertas: number;
    fontes: number;
    fontes_com_erro: number;
    alteracoes_por_rever: number;
    contradicoes_abertas: number;
  };
}

export type EstadoResposta = "rascunho" | "em_teste" | "no_ar" | "arquivada";

export interface RespostaResumo {
  id: string;
  pergunta_tipo: string;
  tema_id: string | null;
  tema: string | null;
  estado: EstadoResposta;
  versao_no_ar_id: string | null;
  usos_30d: number;
  atualizada_em: string;
  versoes: number;
  frases: number;
  por_rever: boolean;
}

export interface FonteCitada {
  trecho_id: string;
  referencia: string | null;
  titulo: string;
  url: string;
  entidade: string;
  lida_em: string;
  texto?: string;
  vigor_ate?: string | null;
}

export type EstadoVersao = "no_ar" | "publicada" | "rejeitada" | "em_revisao" | "rascunho";
export type Requisito = "avaliacao" | "revisao_interna";

export interface Versao {
  id: string;
  numero: number;
  texto_voz: string;
  texto_sms: string | null;
  passa_a_pessoa_quando: string[];
  criada_em: string;
  publicada_em: string | null;
  eval_execucao_id: string | null;
  criada_por: string | null;
  origem: "equipa" | "camara";
  no_ar: boolean;
  muda_factos: boolean;
  reverte_de: string | null;
  revisao: "aprovada" | "rejeitada" | null;
  revista_em: string | null;
  fontes: FonteCitada[];
  estado: EstadoVersao;
  precisa_de: Requisito[];
}

export interface Resposta {
  id: string;
  pergunta_tipo: string;
  tema_id: string | null;
  tema: string | null;
  estado: EstadoResposta;
  versao_no_ar_id: string | null;
  usos_30d: number;
  versoes: Versao[];
  frases: { id: string; frase: string; com_vetor: boolean }[];
  usos: {
    ultimos_30_dias: number;
    conversas: { conversa_id: string; canal: string; iniciada_em: string; resultado: string | null }[];
  };
  alteracoes: {
    alteracao_id: string;
    resumo: string;
    detetada_em: string;
    estado: string;
    proposta_versao_id: string | null;
    fonte: string;
  }[];
}

export type PassoDiff =
  | { tipo: "igual"; frase: string }
  | { tipo: "alterada"; antes: string; depois: string }
  | { tipo: "removida"; antes: string }
  | { tipo: "adicionada"; depois: string };

export interface VersaoHistorico {
  id: string;
  numero: number;
  texto_voz: string;
  texto_sms: string | null;
  passa_a_pessoa_quando: string[];
  origem: "equipa" | "camara";
  criada_por: { id: string; nome: string; perfil: string } | null;
  criada_em: string;
  publicada_em: string | null;
  no_ar: boolean;
  base_numero: number | null;
  muda_factos: boolean;
  factos: {
    adicionados?: { numeros: string[]; telefones: string[]; emails: string[] };
    removidos?: { numeros: string[]; telefones: string[]; emails: string[] };
  } | null;
  reverte_de: string | null;
  reverte_de_numero: number | null;
  revisao: "aprovada" | "rejeitada" | null;
  revista_por: { id: string; nome: string } | null;
  revista_em: string | null;
  revisao_nota: string | null;
  estado: EstadoVersao;
  precisa_de: Requisito[];
  diff: {
    anterior_numero: number | null;
    texto_voz: PassoDiff[];
    texto_sms: PassoDiff[];
    passa_a_pessoa_quando: { adicionados: string[]; removidos: string[] };
  };
}

export interface Historico {
  resposta_id: string;
  versao_no_ar_id: string | null;
  versoes: VersaoHistorico[];
}

export interface Definicoes {
  camara_edita_respostas: boolean;
  atualizado_por: string | null;
  atualizado_em: string | null;
}

export interface Revisoes {
  pode_publicar_agora: boolean;
  itens: {
    versao_id: string;
    resposta_id: string;
    pergunta_tipo: string;
    numero: number;
    criada_em: string;
    criada_por: string | null;
    muda_factos: boolean;
    estado: EstadoVersao;
    precisa_de: Requisito[];
  }[];
}

export type EstadoPsr = "nova" | "com_equipa" | "espera_camara" | "resolvida" | "fora_ambito";

export interface PerguntaSemResposta {
  id: string;
  texto: string;
  vezes: number;
  primeira_em: string;
  ultima_em: string;
  estado: EstadoPsr;
  o_que_falta: string | null;
  resposta_id: string | null;
  resposta?: string | null;
}

export type EstadoMelhoria = "proposta" | "enviada" | "publicada" | "rejeitada";

export interface MelhoriaResumo {
  id: string;
  titulo: string;
  o_que_falta: string;
  tipo: string;
  onde: string | null;
  entidade: string | null;
  estado: EstadoMelhoria;
  criada_em: string;
  enviada_em: string | null;
  enviada_para: string | null;
  publicada_em: string | null;
  perguntas: number;
  vezes: number;
}

export interface Melhoria extends Omit<MelhoriaResumo, "perguntas"> {
  sugestao: string;
  onde_url: string | null;
  fonte_existente: string | null;
  fonte_existente_url: string | null;
  servico: string | null;
  notas: string | null;
  perguntas: {
    id: string;
    texto: string;
    vezes: number;
    estado: EstadoPsr;
    exemplos: string[];
  }[];
}

export interface ResumoMelhorias {
  propostas: number;
  enviadas: number;
  publicadas: number;
  rejeitadas: number;
  perguntas_resolvidas: number;
  vezes_resolvidas: number;
}

export interface ResultadoExecucao {
  execucao_id: string;
  sistema: string;
  agente_versao: string | null;
  iniciada_em: string;
  terminada_em: string | null;
  total: number | null;
  certas: number | null;
  passadas_bem: number | null;
  erradas: number | null;
  sem_resposta: number | null;
  por_responder: number | null;
  por_avaliar: number | null;
  taxa: number | null;
  passou: boolean;
}

export interface Qualidade {
  limiar: number;
  pedidos: {
    id: string;
    motivo: string;
    conjunto: string;
    amostra: boolean;
    estado: "pendente" | "a_correr" | "terminado" | "falhou";
    execucao_id: string | null;
    erro: string | null;
    criado_em: string;
  }[];
  versao_atual: string | null;
  publicacao: {
    pode_publicar: boolean;
    motivo: string | null;
    causa: "sem_execucao" | "outra_versao" | "por_avaliar" | "abaixo" | null;
    execucao_id: string | null;
  };
  ultima:
    | (ResultadoExecucao & {
        perguntas: number;
        categorias: (Omit<ResultadoExecucao, "execucao_id" | "sistema" | "agente_versao" | "iniciada_em" | "terminada_em" | "passou"> & {
          categoria: string;
        })[];
      })
    | null;
  evolucao: ResultadoExecucao[];
  erradas: {
    resposta_id: string;
    pergunta_id: string;
    ordem: number;
    categoria: string | null;
    pergunta: string;
    comportamento: string | null;
    resposta: string | null;
    veredicto: "errada" | "sem_resposta";
    gabarito: string | null;
    factos_em_falta: unknown;
    factos_errados: unknown;
    justificacao: string | null;
  }[];
  /** Números ditos pelo agente que não estão na pergunta nem no gabarito (última execução). */
  numeros?: {
    respostas: number;
    com_numeros: number;
    com_numeros_sem_fonte: number;
    numeros_sem_fonte: number;
    percentagem: number | null;
    exemplos: { resposta_id: string; pergunta: string; resposta: string | null; numeros: string[] }[];
  } | null;
  voz: (ResultadoExecucao & { amostra: boolean; latencia_media_ms: number | null }) | null;
}

export type EstadoFonte = "em_dia" | "mudou" | "erro";

export interface Fonte {
  id: string;
  titulo: string;
  tipo: string;
  url: string;
  estado: EstadoFonte;
  erro: string | null;
  ultima_leitura_em: string | null;
  leitura_automatica: boolean;
  ler_a_cada_horas: number;
  proxima_leitura_em: string | null;
  entidade_id: string;
  entidade: string;
  versoes: number;
  /** Respostas curadas que citam esta fonte e citações em conversas. */
  respostas?: number;
  citacoes?: number;
  alteracoes_por_rever: number;
  /** Língua do texto (pt, en, es, fr). */
  lingua?: string;
  /** Texto de demonstração, a confirmar pela câmara. */
  demonstracao?: boolean;
  /** Seletor CSS: só esta parte da página. */
  seletor?: string | null;
  /** A câmara autorizou ler apesar do robots.txt. */
  ignorar_robots?: boolean;
  /** Erros de leitura seguidos desde a última leitura boa. */
  falhas_seguidas?: number;
  arquivada_em?: string | null;
  /** Descoberta por um site (fonte_sites). */
  site_id?: string | null;
  site?: string | null;
}

/** Uma leitura de uma fonte (o histórico). */
export interface LeituraFonte {
  id: string;
  iniciada_em: string;
  duracao_ms: number;
  http_estado: number | null;
  bytes: number | null;
  resultado: "mudou" | "igual" | "nao_modificado" | "erro";
  codigo_erro: string | null;
  erro: string | null;
  aviso: string | null;
}

/** A hora diária da recolha e o resumo das fontes do município. */
export interface Recolha {
  hora_recolha: string;
  fuso: string;
  fontes: number;
  vencidas: number;
  com_erro: number;
  proxima_leitura_em: string | null;
}

/** Um site cujas páginas viram fontes (sitemap ou links). */
export interface SiteFontes {
  id: string;
  titulo: string;
  url_inicial: string;
  sitemap_url: string | null;
  incluir: string[];
  excluir: string[];
  profundidade: number;
  max_paginas: number;
  tipo_fontes: string;
  ativo: boolean;
  entidade_id: string;
  entidade: string;
  ler_a_cada_horas: number;
  descobrir_a_cada_dias: number;
  ultima_descoberta_em: string | null;
  proxima_descoberta_em: string | null;
  paginas_encontradas: number | null;
  erro: string | null;
  fontes: number;
}

export interface Fontes {
  itens: Fonte[];
  ultima_ingestao: {
    id: string;
    iniciada_em: string;
    terminada_em: string | null;
    fontes_lidas: number;
    mudancas: number;
    erros: number;
  } | null;
}

export interface AlteracaoResumo {
  id: string;
  fonte_id: string;
  fonte: string;
  entidade: string;
  resumo: string;
  detetada_em: string;
  estado: "por_rever" | "aprovada" | "ignorada";
  aprovada_por: string | null;
  respostas_afetadas: number;
  propostas: number;
}

export interface BlocoDiff {
  linha_antes: number;
  linha_depois: number;
  antes: string[];
  depois: string[];
}

export interface Alteracao extends Omit<AlteracaoResumo, "respostas_afetadas" | "propostas"> {
  url: string;
  diff: {
    linhas_mudadas: number;
    removidas: number;
    adicionadas: number;
    blocos: BlocoDiff[];
    truncado: boolean;
  } | null;
  anterior_lida_em: string | null;
  nova_lida_em: string;
  vigor_desde: string | null;
  vigor_ate: string | null;
  respostas: {
    resposta_id: string;
    pergunta_tipo: string;
    estado: "proposta" | "aprovada" | "rejeitada";
    texto_atual: string | null;
    proposta_versao_id: string | null;
    texto_proposto: string | null;
    sms_proposto: string | null;
  }[];
}

export interface LadoContradicao {
  trecho_id: string;
  referencia: string | null;
  texto: string;
  fonte: string;
  url: string;
  entidade: string;
  lida_em: string;
}

export interface Contradicao {
  id: string;
  assunto: string;
  valor_a: string;
  valor_b: string;
  usar: "a" | "b" | null;
  estado: "aberta" | "avisada" | "resolvida";
  detetada_em: string;
  a: LadoContradicao;
  b: LadoContradicao;
}

export interface Entidade {
  id: string;
  nome: string;
  tipo: string;
  descricao: string | null;
  site_url: string | null;
  ativo: boolean;
  contactos: {
    id: string;
    tipo: string;
    rotulo: string | null;
    valor: string;
    horario_texto: string | null;
    aberto_agora: boolean | null;
  }[];
  regras: { id: string; assunto: string }[];
}
