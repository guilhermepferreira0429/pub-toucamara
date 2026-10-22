/*
 * "O que se passa perto de mim": a forma das respostas de
 * GET /v1/public/agora/:municipio (feed) e /:municipio/:tipo/:id (detalhe),
 * os tipos com ícone e cor, e as contas de datas (no fuso de Lisboa).
 * Ver code/api/src/modules/agora/agora.regras.ts.
 */
import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  Construction,
  Megaphone,
  MessagesSquare,
  Siren,
  TriangleAlert,
} from "lucide-react";
import { dataLonga, hora } from "@/components/municipe/formatar";

export const TIPOS_ITEM = ["obras", "incidentes", "avisos", "eventos", "consultas"] as const;
export type TipoItem = (typeof TIPOS_ITEM)[number];

export type FonteItem =
  | "licenca"
  | "aviso_zona"
  | "emergencia"
  | "ocorrencia"
  | "comunicado"
  | "evento"
  | "consulta_publica";

export interface PontoGeo {
  lat: number;
  lng: number;
}

export interface ItemAgora {
  id: string;
  tipo: TipoItem;
  fonte: FonteItem;
  etiqueta: string;
  titulo: string;
  resumo: string;
  inicio: string | null;
  fim: string | null;
  publicado_em: string;
  lat: number | null;
  lng: number | null;
  raio_m: number | null;
  poligono: PontoGeo[] | null;
  freguesia: string | null;
  freguesias: string[] | null;
  todo_concelho: boolean;
  rua: string | null;
  gravidade: "aviso" | "alerta" | "emergencia" | null;
  link: string;
  imagem: string | null;
  distancia_m?: number | null;
}

export interface Parametros {
  raio_omissao_m: number;
  novos_horas: number;
  demonstracao: boolean;
  nota: string;
}

export interface RespostaFeed {
  municipio: { slug: string; nome: string; telefone_sms?: string | null };
  freguesias?: string[];
  filtro: {
    lat: number | null;
    lng: number | null;
    raio_m: number | null;
    freguesia: string | null;
    tipos: TipoItem[];
    de: string | null;
    ate: string | null;
  };
  total: number;
  itens: ItemAgora[];
  proximo_cursor: string | null;
  link: string;
  parametros: Parametros;
}

export interface RespostaDetalhe {
  municipio: { slug: string; nome: string };
  item: ItemAgora;
  texto: string | null;
  quando: string;
  feed: string;
}

export interface EstiloTipo {
  nome: string;
  /** Nome no singular, para o nome acessível dos marcadores. */
  singular: string;
  icone: LucideIcon;
  /** Fundo do marcador e da marca na lista (texto/ícone branco por cima, ≥ 4,5:1). */
  cor: string;
}

export const ESTILO_TIPO: Record<TipoItem, EstiloTipo> = {
  obras: { nome: "Obras e cortes", singular: "Obra", icone: Construction, cor: "#8a5a00" },
  incidentes: { nome: "Incidentes", singular: "Incidente", icone: TriangleAlert, cor: "#b84a24" },
  avisos: { nome: "Avisos", singular: "Aviso", icone: Megaphone, cor: "#15263b" },
  eventos: { nome: "Eventos", singular: "Evento", icone: CalendarDays, cor: "#3f6e4a" },
  consultas: {
    nome: "Consultas públicas",
    singular: "Consulta pública",
    icone: MessagesSquare,
    cor: "#3b4a8c",
  },
};

export const ESTILO_EMERGENCIA: EstiloTipo = {
  nome: "Emergências",
  singular: "Emergência",
  icone: Siren,
  cor: "#a3101a",
};

export function eEmergencia(i: Pick<ItemAgora, "fonte" | "gravidade">): boolean {
  return i.fonte === "emergencia" || i.gravidade === "emergencia";
}

export function estiloDe(i: Pick<ItemAgora, "tipo" | "fonte" | "gravidade">): EstiloTipo {
  return eEmergencia(i) ? ESTILO_EMERGENCIA : ESTILO_TIPO[i.tipo] ?? ESTILO_TIPO.avisos;
}

/** De onde vem a informação (no detalhe). */
export const FONTE_DITA: Record<FonteItem, string> = {
  licenca: "Licença emitida pela câmara",
  aviso_zona: "Aviso da câmara aos moradores da zona",
  emergencia: "Alerta da Proteção Civil municipal",
  ocorrencia: "Problema comunicado à câmara (sem dados de quem o comunicou)",
  comunicado: "Comunicado da câmara",
  evento: "Agenda da câmara",
  consulta_publica: "Consulta pública da câmara",
};

/** Publicado há menos de 48 h (PARAMETROS.novos_horas). */
export function eNovo(i: Pick<ItemAgora, "publicado_em">, horas = 48, agora = Date.now()): boolean {
  const t = Date.parse(i.publicado_em);
  return Number.isFinite(t) && agora - t >= -60_000 && agora - t < horas * 3_600_000;
}

/** "Rua Direita · Azurém", "Todo o concelho"… (nunca com número de porta: a API já o tira). */
export function ondeDito(i: Pick<ItemAgora, "rua" | "freguesia" | "todo_concelho">): string | null {
  const partes = [i.rua, i.freguesia].filter((x): x is string => !!x?.trim());
  if (partes.length) return [...new Set(partes)].join(" · ");
  return i.todo_concelho ? "Todo o concelho" : null;
}

function comHora(v: string): string {
  const h = hora(v);
  return h === "00h00" ? dataLonga(v) : `${dataLonga(v)}, às ${h}`;
}

function mesmoDia(a: string, b: string): boolean {
  return dataLonga(a) === dataLonga(b);
}

/**
 * Quando, em frase curta: "Até 30 de outubro", "31 de outubro, às 21h00",
 * "De 20 a 25 de outubro"…
 */
export function quandoDito(
  i: Pick<ItemAgora, "inicio" | "fim" | "fonte">,
  agora = Date.now(),
): string | null {
  const ini = i.inicio ? Date.parse(i.inicio) : null;
  const fim = i.fim ? Date.parse(i.fim) : null;
  const decorre = (ini === null || ini <= agora) && (fim === null || fim >= agora);
  if (decorre) {
    if (i.fonte === "ocorrencia" || i.fonte === "comunicado") {
      return i.inicio ? `Desde ${dataLonga(i.inicio)}` : null;
    }
    return i.fim ? `A decorrer, até ${dataLonga(i.fim)}` : "A decorrer";
  }
  if (ini !== null && ini > agora && i.inicio) {
    if (i.fim && !mesmoDia(i.inicio, i.fim)) {
      return `De ${dataLonga(i.inicio)} a ${dataLonga(i.fim)}`;
    }
    const h = hora(i.inicio);
    const hf = i.fim ? hora(i.fim) : null;
    if (h !== "00h00" && hf && hf !== h && !hf.startsWith("23h5")) {
      return `${dataLonga(i.inicio)}, das ${h} às ${hf}`;
    }
    return comHora(i.inicio);
  }
  return i.fim ? `Terminou a ${dataLonga(i.fim)}` : null;
}

export function inicioDito(v: string): string {
  return comHora(v);
}

// ---------------------------------------------------------------------
// Períodos do filtro (no fuso da câmara)
// ---------------------------------------------------------------------

const FUSO = "Europe/Lisbon";

function diaLisboa(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);
}

/** 'AAAA-MM-DD' + 'HH:MM' em Lisboa → instante. */
function instanteLisboa(dia: string, horaMin: string): Date {
  const aprox = new Date(`${dia}T${horaMin}:00Z`);
  const desvio = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    timeZoneName: "longOffset",
  })
    .formatToParts(aprox)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(desvio ?? "");
  const minutos = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
  return new Date(aprox.getTime() - minutos * 60_000);
}

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const PERIODOS = [
  { id: "tudo", nome: "Tudo" },
  { id: "hoje", nome: "Hoje" },
  { id: "semana", nome: "Esta semana" },
  { id: "eventos", nome: "Próximos eventos" },
] as const;
export type Periodo = (typeof PERIODOS)[number]["id"];

/** O período → `de`/`ate` para a API (sem nada = a janela por omissão da API). */
export function periodoParaApi(p: Periodo, agora = new Date()): { de?: string; ate?: string } {
  const hoje = diaLisboa(agora);
  switch (p) {
    case "hoje":
      return {
        de: instanteLisboa(hoje, "00:00").toISOString(),
        ate: new Date(instanteLisboa(somarDias(hoje, 1), "00:00").getTime() - 1000).toISOString(),
      };
    case "semana": {
      const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay(); // 0 = domingo
      const domingo = somarDias(hoje, dow === 0 ? 0 : 7 - dow);
      return {
        de: agora.toISOString(),
        ate: new Date(instanteLisboa(somarDias(domingo, 1), "00:00").getTime() - 1000).toISOString(),
      };
    }
    case "eventos":
      return { de: agora.toISOString() };
    default:
      return {};
  }
}

export const RAIOS = [300, 500, 1000, 2000, 5000] as const;

export function raioDito(m: number): string {
  return m >= 1000 ? `${String(m / 1000).replace(".", ",")} km` : `${m} m`;
}

/** O link para o detalhe nesta web (o `link` do item pode ser de fora). */
export function caminhoDetalhe(slug: string, i: Pick<ItemAgora, "tipo" | "id">): string {
  return `/agora/${encodeURIComponent(slug)}/${i.tipo}/${i.id}`;
}
