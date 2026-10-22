/*
 * Comunicados, notícias e eventos que a câmara publica no feed /agora: a
 * forma das respostas de /v1/painel/comunicados, /v1/painel/eventos e
 * /v1/painel/agora/*, as regras de validação (as mesmas do zod da API, com
 * mensagens em português) e a conversão para o item do feed (pré-visualização).
 * Ver code/api/src/modules/agora/agora.publicacoes.ts.
 */
import type { ItemAgora } from "@/components/agora/tipos";

export type Situacao = "rascunho" | "publicado" | "despublicado" | "expirado";

export const SITUACOES: Record<
  Situacao,
  { rotulo: string; tom: "verde" | "ambar" | "terracota" | "neutro"; explicacao: string }
> = {
  rascunho: { rotulo: "Rascunho", tom: "neutro", explicacao: "Ainda não foi publicado." },
  publicado: { rotulo: "Publicado", tom: "verde", explicacao: "Está na página pública «O que se passa perto de mim»." },
  despublicado: {
    rotulo: "Despublicado",
    tom: "ambar",
    explicacao: "Esteve publicado e foi tirado da página pública «O que se passa perto de mim».",
  },
  expirado: {
    rotulo: "Expirado",
    tom: "terracota",
    explicacao: "Continua publicado, mas já saiu da página pública «O que se passa perto de mim» pelo prazo.",
  },
};

export interface Comunicado {
  id: string;
  tipo: "comunicado" | "noticia";
  titulo: string;
  texto: string;
  imagem_url: string | null;
  freguesias: string[] | null;
  estado: "rascunho" | "publicado";
  situacao: Situacao;
  publicado_em: string | null;
  visivel_ate: string | null;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface Evento {
  id: string;
  titulo: string;
  descricao: string;
  local: string;
  lat: number | null;
  lng: number | null;
  inicio: string;
  fim: string | null;
  freguesia: string | null;
  link: string | null;
  estado: "rascunho" | "publicado";
  situacao: Situacao;
  publicado_em: string | null;
  visivel_ate: string;
  criado_por: string | null;
  criado_em: string;
  atualizado_em: string;
}

export interface ContextoAgora {
  municipio: { slug: string; nome: string };
  freguesias: string[];
  parametros: {
    comunicado_visivel_dias: number;
    evento_visivel_dias_depois: number;
    novos_horas: number;
    raio_subscricao_m: number;
    demonstracao: boolean;
    nota: string;
  };
}

export type PedidoAbrangidos =
  | { fonte: "comunicado"; tipo: "comunicado" | "noticia"; freguesias: string[] | null }
  | { fonte: "evento"; lat: number | null; lng: number | null; freguesia: string | null };

export interface Abrangidos {
  subscricoes: number;
  pessoas: number;
  motivo: "noticia" | "todo_concelho" | "zona" | "sem_zona";
  parametros: {
    novos_horas: number;
    raio_subscricao_m: number;
    max_avisos_por_corrida: number;
    demonstracao: boolean;
  };
}

export const TIPOS_COMUNICADO = {
  comunicado: {
    rotulo: "Comunicado",
    ajuda: "Informação da câmara para quem vive na zona (recolha de lixo, trânsito, serviços).",
  },
  noticia: {
    rotulo: "Notícia",
    ajuda: "Novidades do concelho. Aparece na página pública «O que se passa perto de mim», mas nunca envia avisos por SMS.",
  },
} as const;

// ---------------------------------------------------------------------------
// Validação (igual ao zod da API; mensagens para pessoas)
// ---------------------------------------------------------------------------

export type Erros = Partial<Record<string, string>>;

const URL_OK = /^https?:\/\/\S+$/;

function tamanho(v: string, min: number, max: number, nome: string): string | undefined {
  const t = v.trim();
  if (t.length < min) return t ? `${nome} tem de ter pelo menos ${min} letras.` : `Escreva ${nome.toLowerCase()}.`;
  if (t.length > max) return `${nome} tem no máximo ${max} caracteres (tem ${t.length}).`;
  return undefined;
}

function endereco(v: string): string | undefined {
  const t = v.trim();
  if (!t) return undefined;
  if (t.length > 500) return "O endereço tem no máximo 500 caracteres.";
  return URL_OK.test(t) ? undefined : "Um endereço que comece por http:// ou https://.";
}

export interface FormComunicado {
  tipo: "comunicado" | "noticia";
  titulo: string;
  texto: string;
  imagem_url: string;
  concelho: boolean;
  freguesias: string[];
}

export function validarComunicado(f: FormComunicado): Erros {
  const e: Erros = {
    titulo: tamanho(f.titulo, 3, 140, "O título"),
    texto: tamanho(f.texto, 3, 5000, "O texto"),
    imagem_url: endereco(f.imagem_url),
    freguesias:
      !f.concelho && f.freguesias.length === 0
        ? "Escolha pelo menos uma freguesia, ou marque «todo o concelho»."
        : f.freguesias.length > 50
          ? "No máximo 50 freguesias."
          : undefined,
  };
  return limpar(e);
}

export function corpoComunicado(f: FormComunicado) {
  return {
    tipo: f.tipo,
    titulo: f.titulo.trim(),
    texto: f.texto.trim(),
    imagem_url: f.imagem_url.trim() || null,
    freguesias: f.concelho ? null : f.freguesias,
  };
}

export interface FormEvento {
  titulo: string;
  descricao: string;
  local: string;
  ponto: { lat: number; lng: number } | null;
  /** datetime-local, em hora de Lisboa (deLocal / paraLocal). */
  inicio: string;
  fim: string;
  freguesia: string;
  link: string;
}

export function validarEvento(f: FormEvento): Erros {
  const ini = f.inicio ? deLocal(f.inicio) : null;
  const fim = f.fim ? deLocal(f.fim) : null;
  const e: Erros = {
    titulo: tamanho(f.titulo, 3, 140, "O título"),
    descricao: tamanho(f.descricao, 3, 3000, "A descrição"),
    local: tamanho(f.local, 2, 200, "O local"),
    inicio: !ini ? "Diga quando começa (dia e hora)." : undefined,
    fim:
      f.fim && !fim
        ? "A data do fim não é válida."
        : fim && ini && fim.getTime() < ini.getTime()
          ? "O fim tem de ser depois do início."
          : undefined,
    freguesia: f.freguesia.trim() ? tamanho(f.freguesia, 2, 120, "A freguesia") : undefined,
    link: endereco(f.link),
  };
  return limpar(e);
}

export function corpoEvento(f: FormEvento) {
  return {
    titulo: f.titulo.trim(),
    descricao: f.descricao.trim(),
    local: f.local.trim(),
    lat: f.ponto ? arredondar(f.ponto.lat) : null,
    lng: f.ponto ? arredondar(f.ponto.lng) : null,
    inicio: deLocal(f.inicio)!.toISOString(),
    fim: deLocal(f.fim)?.toISOString() ?? null,
    freguesia: f.freguesia.trim() || null,
    link: f.link.trim() || null,
  };
}

function arredondar(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function limpar(e: Erros): Erros {
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v)) as Erros;
}

/** Os erros de campo que a API devolve (`detalhes.campos`), se houver. */
export function errosDaApi(detalhes: unknown): Erros {
  const campos = (detalhes as { campos?: { campo: string; mensagem: string }[] } | undefined)?.campos;
  if (!Array.isArray(campos)) return {};
  const r: Erros = {};
  for (const c of campos) {
    const k = c.campo.split(".")[0];
    if (!r[k]) r[k] = c.mensagem;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Datas do formulário
// ---------------------------------------------------------------------------

// As horas dos eventos são as de Portugal continental, seja qual for o fuso
// do computador de quem escreve.
const FUSO = "Europe/Lisbon";

function desvioMinutos(d: Date): number {
  const v = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, timeZoneName: "longOffset" })
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(v ?? "");
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** Valor de um <input type="datetime-local"> (hora de Lisboa) → instante, ou null. */
export function deLocal(v: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(v);
  if (!m) return null;
  const aprox = new Date(`${m[1]}T${m[2]}:00Z`);
  if (Number.isNaN(aprox.getTime())) return null;
  const d = new Date(aprox.getTime() - desvioMinutos(aprox) * 60_000);
  // Na mudança de hora o desvio pode ser o do outro lado: acerta.
  return new Date(aprox.getTime() - desvioMinutos(d) * 60_000);
}

/** ISO → valor de um <input type="datetime-local"> (hora de Lisboa). */
export function paraLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const l = new Date(d.getTime() + desvioMinutos(d) * 60_000);
  return l.toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Pré-visualização: o item como o feed o mostra (agora.regras.ts › normalizar*)
// ---------------------------------------------------------------------------

function cortar(t: string, max: number): string {
  const s = t.trim().replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function juntarComE(l: string[]): string {
  return l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`;
}

export function itemDeComunicado(
  f: FormComunicado,
  id: string,
  publicadoEm: string | null,
): ItemAgora {
  const fregs = f.concelho ? [] : f.freguesias;
  const quando = publicadoEm ?? new Date().toISOString();
  return {
    id,
    tipo: "avisos",
    fonte: "comunicado",
    etiqueta: f.tipo === "noticia" ? "Notícia" : "Comunicado",
    titulo: cortar(f.titulo || "Título do comunicado", 140),
    resumo: cortar(f.texto || "O texto aparece aqui.", 280),
    inicio: quando,
    fim: null,
    publicado_em: quando,
    lat: null,
    lng: null,
    raio_m: null,
    poligono: null,
    freguesia: fregs.length ? juntarComE(fregs) : null,
    freguesias: fregs.length ? fregs : null,
    todo_concelho: !fregs.length,
    rua: null,
    gravidade: null,
    link: "",
    imagem: f.imagem_url.trim() || null,
  };
}

export function itemDeEvento(f: FormEvento, id: string, publicadoEm: string | null): ItemAgora {
  const ini = deLocal(f.inicio)?.toISOString() ?? null;
  const fim = deLocal(f.fim)?.toISOString() ?? null;
  const freg = f.freguesia.trim();
  return {
    id,
    tipo: "eventos",
    fonte: "evento",
    etiqueta: "Evento",
    titulo: cortar(f.titulo || "Nome do evento", 140),
    resumo: cortar(f.descricao || "A descrição aparece aqui.", 280),
    inicio: ini,
    fim,
    publicado_em: publicadoEm ?? new Date().toISOString(),
    lat: f.ponto?.lat ?? null,
    lng: f.ponto?.lng ?? null,
    raio_m: null,
    poligono: null,
    freguesia: freg || null,
    freguesias: freg ? [freg] : null,
    todo_concelho: !freg && !f.ponto,
    rua: f.local.trim() || null,
    gravidade: null,
    link: f.link.trim(),
    imagem: null,
  };
}

/** Caminho público do item no site (depois de publicado). */
export function caminhoNoSite(slug: string, tipo: "avisos" | "eventos", id: string): string {
  return `/agora/${encodeURIComponent(slug)}/${tipo}/${id}`;
}
