/*
 * Acessibilidade das páginas do munícipe: preferências de leitura (guardadas
 * no browser) e a configuração da câmara para a Língua Gestual Portuguesa
 * e para a declaração de acessibilidade.
 *
 * A configuração vem de variáveis NEXT_PUBLIC_* (ver .env.example). Nada é
 * inventado: sem vídeo configurado, o vídeo em LGP não aparece; sem serviço
 * de videointérprete configurado, dizemos que ainda não existe.
 */

// ---------------------------------------------------------------------------
// Preferências de leitura (letra maior, alto contraste)
// ---------------------------------------------------------------------------

export type NivelLetra = 0 | 1 | 2;

const CHAVE_LETRA = "toucamara.letra";
const CHAVE_CONTRASTE = "toucamara.contraste";
const EVENTO = "toucamara:preferencias";

export interface Preferencias {
  letra: NivelLetra;
  contraste: boolean;
}

const POR_OMISSAO: Preferencias = { letra: 0, contraste: false };

/** localStorage pode não existir ou estar bloqueado (modo privado, iframes). */
function ler(chave: string): string | null {
  try {
    return window.localStorage.getItem(chave);
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string | null) {
  try {
    if (valor === null) window.localStorage.removeItem(chave);
    else window.localStorage.setItem(chave, valor);
  } catch {
    // Sem armazenamento: a escolha vale só até fechar a página.
  }
}

export function lerPreferencias(): Preferencias {
  if (typeof window === "undefined") return POR_OMISSAO;
  const l = Number(ler(CHAVE_LETRA));
  return {
    letra: l === 1 || l === 2 ? l : 0,
    contraste: ler(CHAVE_CONTRASTE) === "alto",
  };
}

/** Põe as preferências no <html> (o CSS em globals.css faz o resto). */
export function aplicarPreferencias(p: Preferencias) {
  const html = document.documentElement;
  if (p.letra) html.dataset.letra = String(p.letra);
  else delete html.dataset.letra;
  if (p.contraste) html.dataset.contraste = "alto";
  else delete html.dataset.contraste;
}

export function definirPreferencias(p: Preferencias) {
  gravar(CHAVE_LETRA, p.letra ? String(p.letra) : null);
  gravar(CHAVE_CONTRASTE, p.contraste ? "alto" : null);
  aplicarPreferencias(p);
  window.dispatchEvent(new Event(EVENTO));
}

/** Para useSyncExternalStore: muda quando a pessoa escolhe outra opção. */
export function subscreverPreferencias(aviso: () => void) {
  window.addEventListener(EVENTO, aviso);
  window.addEventListener("storage", aviso);
  return () => {
    window.removeEventListener(EVENTO, aviso);
    window.removeEventListener("storage", aviso);
  };
}

/**
 * Corre antes de pintar a página (script no <head>), para não piscar: aplica
 * as preferências guardadas. Tem de ser autónomo (vai como texto).
 */
export const SCRIPT_PREFERENCIAS = `(function(){try{var h=document.documentElement,l=localStorage.getItem("${CHAVE_LETRA}");if(l==="1"||l==="2")h.dataset.letra=l;if(localStorage.getItem("${CHAVE_CONTRASTE}")==="alto")h.dataset.contraste="alto";}catch(e){}})();`;

// ---------------------------------------------------------------------------
// Língua Gestual Portuguesa (LGP)
// ---------------------------------------------------------------------------

/**
 * Tipos de página que podem ter um vídeo em LGP (um vídeo por tipo, gravado
 * pela câmara com um intérprete). As chaves são as do JSON da variável
 * NEXT_PUBLIC_LGP_VIDEOS, ex.: {"processo":"https://…/processo.mp4"}.
 */
export type ConteudoLgp =
  | "acessibilidade"
  | "processo"
  | "requerimento"
  | "licenca"
  | "pagamento"
  | "marcacao"
  | "ocorrencia"
  | "reclamacao"
  | "consulta"
  | "apoios"
  | "zona"
  | "aviso"
  | "resumo"
  | "chat"
  | "ligar";

export interface VideoLgp {
  /** Endereço do vídeo (mp4/webm) ou de uma página com o vídeo. */
  url: string;
  /** Legendas em português (WebVTT), se houver. */
  legendas?: string;
}

function lerJson<T>(texto: string | undefined): T | null {
  if (!texto) return null;
  try {
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

const VIDEOS = lerJson<Record<string, string | VideoLgp>>(
  process.env.NEXT_PUBLIC_LGP_VIDEOS,
);

export function videoLgp(tipo: ConteudoLgp): VideoLgp | null {
  const v = VIDEOS?.[tipo];
  if (!v) return null;
  return typeof v === "string" ? { url: v } : v.url ? v : null;
}

/** O caminho da página → o tipo de conteúdo (para o vídeo em LGP). */
export function conteudoDoCaminho(caminho: string): ConteudoLgp | null {
  const primeiro = caminho.split("/").filter(Boolean)[0] ?? "";
  const tipos: Record<string, ConteudoLgp> = {
    acessibilidade: "acessibilidade",
    processo: "processo",
    requerimento: "requerimento",
    licenca: "licenca",
    pagamento: "pagamento",
    marcacao: "marcacao",
    ocorrencia: "ocorrencia",
    reclamacao: "reclamacao",
    consulta: "consulta",
    apoios: "apoios",
    zona: "zona",
    aviso: "aviso",
    resumo: "resumo",
  };
  return tipos[primeiro] ?? null;
}

/**
 * Atendimento em LGP por videochamada com intérprete (ex.: o serviço que a
 * câmara contratar). Só aparece como disponível se estiver configurado.
 */
export const ATENDIMENTO_LGP = {
  url: process.env.NEXT_PUBLIC_LGP_VIDEOCHAMADA_URL ?? "",
  nome: process.env.NEXT_PUBLIC_LGP_VIDEOCHAMADA_NOME ?? "",
  horario: process.env.NEXT_PUBLIC_LGP_VIDEOCHAMADA_HORARIO ?? "",
};

// ---------------------------------------------------------------------------
// Declaração de acessibilidade
// ---------------------------------------------------------------------------

export const CONTACTO_ACESSIBILIDADE = {
  email: process.env.NEXT_PUBLIC_ACESSIBILIDADE_EMAIL ?? "",
  telefone:
    process.env.NEXT_PUBLIC_ACESSIBILIDADE_TELEFONE ??
    process.env.NEXT_PUBLIC_TELEFONE_CAMARA ??
    "",
  entidade:
    process.env.NEXT_PUBLIC_MUNICIPIO_NOME
      ? `Município de ${process.env.NEXT_PUBLIC_MUNICIPIO_NOME}`
      : "a câmara municipal",
};
