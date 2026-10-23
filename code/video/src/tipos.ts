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

export interface Cartao {
  tipo: 'cartao';
  /** Linha pequena por cima (ex.: a marca). */
  antes?: string;
  titulo: string;
  depois?: string;
  /** Fundo escuro (o fecho). */
  escuro?: boolean;
  marca?: boolean;
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

/** O cartão de abertura de cada vídeo, com o desenho da capa (sem o botão de play). */
export interface Capa {
  tipo: 'capa';
  video: 'painel' | 'municipe';
  titulo: string;
  sub: string;
  /** A captura dentro do ecrã (monitor ou telemóvel). */
  captura: string;
  /** Recorte da captura (px CSS) que aparece no ecrã. */
  recorte?: Retangulo;
  peso?: number;
}

/** Uma captura do telemóvel numa moldura, com texto ao lado. */
export interface Telemovel {
  tipo: 'telemovel';
  captura: string;
  /** Desce a página: do y ao y (px CSS), para as páginas compridas. */
  de?: number;
  para?: number;
  titulo?: string;
  texto?: string;
  peso?: number;
}

/** SMS recebidos (o texto é o que a API gravou), num telemóvel. */
export interface Sms {
  tipo: 'sms';
  mensagens: string[];
  titulo?: string;
  texto?: string;
  peso?: number;
}

/** A chamada: o ecrã verdadeiro no telemóvel e a conversa escrita ao lado. */
export interface Chamada {
  tipo: 'chamada';
  captura: string;
  falas: { quem: Quem; texto: string }[];
  /** Índice da fala que se está a ouvir. */
  atual: number;
  peso?: number;
}

export type Visual = PlanoPainel | Cartao | Recortes | Capa | Telemovel | Sms | Chamada;

export type Voz = 'assistente' | 'municipe';

/** Um troço com uma só voz: o que se diz, o que se mostra enquanto se diz. */
export interface Bloco {
  /** Nome do ficheiro de voz (public/voz/<id>.mp3). */
  id: string;
  voz: Voz;
  texto: string;
  /** Rótulo da legenda nas falas da chamada. */
  quem?: string;
  visual: Visual[];
  /** Silêncio depois, em segundos. */
  pausa?: number;
  /** Sem legenda (quando o ecrã já mostra a frase). */
  semLegenda?: boolean;
  /** Legenda em cima (quando o que importa está no fundo do quadro). */
  legendaEmCima?: boolean;
}

export interface Cena {
  id: string;
  /** Mostra o selo "Dados de demonstração". */
  painel: boolean;
  blocos: Bloco[];
}

/** O que `npm run voz` escreve em src/voz.gerado.json, por bloco. */
export interface VozGerada {
  ficheiro: string;
  voz_id: string;
  modelo: string;
  texto: string;
  duracao: number;
  frases: { texto: string; inicio: number; fim: number }[];
}
