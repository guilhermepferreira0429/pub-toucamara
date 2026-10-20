/*
 * Relatórios (code/api/src/modules/relatorios): `relatorio.ts` (semanal,
 * mensal, executivo) e `diario.ts` (resumo diário). Só o que o painel usa.
 */

export type TipoRelatorio = "semanal" | "mensal" | "executivo" | "diario";

export interface Indicador {
  valor: number | null;
  anterior: number | null;
  variacao: number | null;
  unidade: "n" | "pct" | "s";
}

export interface RelatorioResumo {
  id: string;
  tipo: TipoRelatorio;
  de: string;
  ate: string;
  gerado_em: string;
  enviado_em: string | null;
  tem_pdf: boolean;
}

export interface DadosPeriodo {
  titulo: string;
  municipio: { nome: string; slug: string };
  tipo: "semanal" | "mensal" | "executivo";
  periodo: { de: string; ate: string };
  periodo_anterior: { de: string; ate: string };
  totais: Record<
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
  trabalho_feito: Record<
    | "requerimentos"
    | "ocorrencias_agente"
    | "consultas_processo"
    | "referencias_mb"
    | "marcacoes"
    | "recolhas"
    | "passagens",
    number | Indicador
  >;
  top_temas: {
    tema_id: string;
    tema: string;
    total: number;
    percentagem: number | null;
    anterior: number;
    variacao: number | null;
    novo: boolean;
  }[];
  sem_resposta: { texto: string; vezes: number; estado: string }[];
  ocorrencias: {
    registadas: Indicador;
    resolvidas: Indicador;
    tempo_medio_resolucao_h: Indicador;
    abertas_agora: number;
  };
  sms: { enviados: number; segmentos: number; custo_cent: number };
  processos: {
    em_curso: number;
    atrasados: number;
    por_fase: { fase: string; total: number; atrasados: number; dias_medios_na_fase: number | null }[];
  };
}

export interface TemaDiario {
  tema_id: string;
  tema: string;
  total: number;
  media_7d: number;
  variacao_pct: number | null;
  subiu_muito: boolean;
}

export interface DadosDiario {
  titulo: string;
  municipio: { nome: string; slug: string };
  tipo: "diario";
  periodo: { de: string; ate: string };
  janela: { de: string; ate: string; fuso: string };
  abertura?: { texto: string; origem: "ia" | "modelo" };
  numeros: {
    conversas: number;
    por_canal: Record<string, number>;
    chamadas: number;
    escritas: number;
    resolvidas_sem_humano: number;
    resolvidas_sem_humano_pct: number | null;
    passadas: number;
    fora_de_horas: number;
    emergencias: number;
    ocorrencias_novas: number;
    ocorrencias_resolvidas: number;
    requerimentos_novos: number;
    processos_novos: number;
    pagamentos: { pagos: number; valor_cent: number; modo_teste: number };
    chamadas_saida: { total: number; atendidas: number };
  };
  mais_pedidos: TemaDiario[];
  reclamacoes: {
    total: number;
    conversas: number;
    emails: number;
    por_tema: { tema: string; total: number }[];
    ocorrencias_repetidas: { categoria: string; zona: string; ocorrencias: string[]; repetidas: number }[];
  };
  atencao: {
    emergencias: { total: number; itens: { iniciada_em: string; canal: string; tema: string | null }[] };
    passagens: {
      total: number;
      atrasadas: number;
      itens: { motivo: string; tema: string | null; responder_ate: string; atribuida_a: string | null; atrasada: boolean }[];
    };
    processos_prazo_hoje: { total: number; itens: { numero: string; tipo: string; tecnico: string | null }[] };
    picos: TemaDiario[];
  };
  citacoes: { texto: string; tema: string | null }[];
}

export interface Relatorio extends RelatorioResumo {
  dados: DadosPeriodo | DadosDiario;
}
