/*
 * As formas que a API pública das regras devolve (GET /v1/public/regras/...).
 */

export interface Fonte {
  titulo: string;
  url?: string | null;
  artigo?: string | null;
}

export interface Alteracao {
  campo: string;
  rotulo: string;
  antes: string;
  depois: string;
}

export interface Versao {
  versao: number;
  vigor_desde: string;
  /** O cargo de quem mudou; null nos valores iniciais. */
  cargo: string | null;
  inicial: boolean;
  nota: string | null;
  alteracoes: Alteracao[];
}

export interface FraseRegra {
  id: string;
  texto: string;
}

export interface LicencaRegras {
  tipo: string;
  nome: string;
  versao: number;
  vigor_desde: string;
  alteracoes: number;
  aprovacao: "automatica" | "funcionario";
  aprovacao_dita: string;
  regras: FraseRegra[];
  taxas: string[];
  condicoes: string[];
  valores: { chave: string; rotulo: string; valor: string }[];
  dados_necessarios: string[];
  demonstracao: boolean;
  fonte: Fonte;
}

export interface CampoVerificador {
  chave: string;
  rotulo: string;
  tipo: "data" | "hora" | "inteiro" | "decimal" | "booleano" | "opcao" | "opcoes" | "texto";
  opcional?: boolean;
  unidade?: string;
  ajuda?: string;
  opcoes?: Record<string, string>;
  min?: number;
}

export interface LicencaDetalhe extends LicencaRegras {
  municipio: { slug: string; nome: string };
  historico: Versao[];
  verificador: CampoVerificador[];
}

export interface ObraExplicada {
  obra: string;
  nome: string;
  frases: string[];
  notas: string[];
  medidas: ("area_m2" | "altura_m")[];
}

export interface ZonaRegras {
  codigo: string;
  nome: string;
  categoria: string;
  descricao: string | null;
  versao: number;
  vigor_desde: string;
  alteracoes: number;
  obras: ObraExplicada[];
  demonstracao: boolean;
  fonte: Fonte;
}

export interface ZonaDetalhe extends ZonaRegras {
  municipio: { slug: string; nome: string };
  poligono: [number, number][];
  historico: Versao[];
  obras_texto: Record<string, string>;
}

export interface Resumo {
  municipio: { slug: string; nome: string };
  gerado_em: string;
  licencas: LicencaRegras[];
  zonas: ZonaRegras[];
  nota: string;
}

export interface MotivoExcecao {
  tipo: "regra" | "dado_em_falta";
  id: string;
  rotulo: string;
  texto: string;
}

export interface ResultadoVerificacao {
  nome: string;
  versao: number;
  proposta: "aprovar" | "tecnico";
  decisao: { via: "automatica" | "excecao" | "funcionario"; dita: string; motivos: MotivoExcecao[] };
  resultado: string;
  regras: { id: string; rotulo: string; ok: boolean; texto: string; regra: string | null }[];
  condicoes: string[];
  taxa: { total_cent: number; texto: string };
  demonstracao: boolean;
  nota: string;
}

export interface ResultadoZona {
  obra_texto: string;
  controlo: string | null;
  controlo_dito: string | null;
  em_falta: ("area_m2" | "altura_m")[];
  limites: string[];
  notas: string[];
  passos: string[];
  resultado: string;
  nota: string;
}
