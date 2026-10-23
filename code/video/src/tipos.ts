/** Retângulo em píxeis CSS da página capturada (a imagem está a 2x). */
export interface Retangulo {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Captura {
  ficheiro: string;
  largura: number;
  altura: number;
  zonas: Record<string, Retangulo>;
  /** O que nunca pode aparecer no vídeo (o render falha se a câmara lhes tocar). */
  proibidas?: Retangulo[];
}

export type Quem = 'agente' | 'municipe';

/** O que `npm run capturar` escreve em src/dados.gerado.json. */
export interface Dados {
  gerado_em: string;
  visao: {
    conversas: number;
    fora_de_horas_pct: number;
    resolvidas_pct: number;
    passadas: number;
    ocorrencias: number;
    requerimentos: number;
    consultas: number;
    marcacoes: number;
    referencias: number;
  };
  processo: {
    numero: string;
    requerente: string;
    verificados: number;
    faltam: number;
  };
  ocorrencia: { numero: string; avisos: number };
  campanha: {
    total: number;
    bem: number;
    ajuda: number;
    sem_resposta: number;
    tratados: number;
  };
  falas: { quem: Quem; texto: string; captura: string }[];
  capturas: Record<string, Captura>;
  /** O vídeo do munícipe (a renovação), se já foi capturado. */
  municipe?: DadosMunicipe;
}

export interface DadosMunicipe {
  estabelecimento: string;
  telefone: string;
  numero: string;
  renovacao: string;
  estado_renovacao: string | null;
  valida_ate: string;
  nova_valida_ate: string | null;
  taxa: string | null;
  taxa_cent: number | null;
  mbway: boolean;
  aviso: { dias: number; canal: string };
  sms: { aviso: string | null; pagamento: string | null; emitida: string | null };
  falas: { quem: Quem; texto: string; captura: string | null }[];
}

/** Para onde a câmara olha: uma zona da captura, um retângulo ou o ecrã inteiro. */
export type Enquadramento =
  | { zona: string; margem?: number }
  | { zonas: string[]; margem?: number }
  | { rect: Retangulo }
  /** Uma faixa de largura fixa que acompanha a zona (fica a `altura` do quadro). */
  | { seguir: string; x: number; w: number; altura?: number }
  | 'ecra';

export interface PlanoPainel {
  tipo: 'painel';
  captura: string;
  de: Enquadramento;
  para?: Enquadramento;
  /** Zona destacada (o resto escurece um pouco): o nome de uma zona ou um retângulo. */
  foco?: string | Retangulo;
  /** Força o lado do selo "Dados de demonstração" (por omissão, à direita). */
  selo?: 'esquerda' | 'direita';
  peso?: number;
}

/** Recortes do painel (elementos soltos) arrumados num ecrã. */
export interface Recortes {
  tipo: 'recortes';
  antes: string;
  titulo: string;
  /** Coluna da esquerda, de cima para baixo. */
  itens: string[];
  /** Coluna da direita (opcional). */
  lado?: string;
  peso?: number;
}
