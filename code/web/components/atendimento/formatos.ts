import {
  CalendarCheck,
  Check,
  CircleHelp,
  Loader,
  Mail,
  MessageCircle,
  MessageSquareText,
  Phone,
  PhoneOff,
  Siren,
  Store,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { ErroApi } from "@/lib/api";
import type { Resultado } from "./tipos";

/*
 * Formatos de números, datas e rótulos (português de Portugal). As datas
 * mostram-se no fuso do município (Açores e Madeira incluídos).
 */

const NUM = new Intl.NumberFormat("pt-PT");

/** 1 284 (com espaço fino, como no design). */
export function numero(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return NUM.format(n);
}

export function decimal(n: number | null | undefined, casas = 1): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("pt-PT", { maximumFractionDigits: casas });
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n)}%`;
}

/** "+12%" / "−4%" (sinal menos tipográfico). */
export function variacaoPct(v: number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const r = Math.round(v);
  if (r === 0) return "0%";
  return `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}

export function euros(cent: number): string {
  return (cent / 100).toLocaleString("pt-PT", {
    style: "currency",
    currency: "EUR",
  });
}

/** "3 min 12 s", "45 s", "1 h 05 min". */
export function duracao(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  const t = Math.round(s);
  if (t < 60) return `${t} s`;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const seg = t % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  return seg ? `${m} min ${seg} s` : `${m} min`;
}

/** "2 min" (arredondado, para as listas). */
export function duracaoCurta(s: number | null | undefined): string | null {
  if (!s) return null;
  if (s < 60) return `${Math.round(s)} s`;
  return `${Math.round(s / 60)} min`;
}

/** Posição no áudio: "0:58", "12:04". */
export function tempoAudio(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "0:00";
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

function diaNoFuso(d: Date, fuso: string): string {
  return d.toLocaleDateString("sv-SE", { timeZone: fuso });
}

export function hojeNoFuso(fuso: string): string {
  return diaNoFuso(new Date(), fuso);
}

/** Soma dias a 'AAAA-MM-DD'. */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function hora(iso: string, fuso: string): string {
  return new Date(iso).toLocaleTimeString("pt-PT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: fuso,
  });
}

/** "Hoje, 22:06", "Ontem, 18:21", "seg., 13 out., 10:02". */
export function quando(iso: string, fuso: string, comHora = true): string {
  const d = new Date(iso);
  const dia = diaNoFuso(d, fuso);
  const hoje = hojeNoFuso(fuso);
  const h = comHora ? `, ${hora(iso, fuso)}` : "";
  if (dia === hoje) return `Hoje${h}`;
  if (dia === somarDias(hoje, -1)) return `Ontem${h}`;
  const ano = dia.slice(0, 4) !== hoje.slice(0, 4);
  return `${d.toLocaleDateString("pt-PT", {
    weekday: ano ? undefined : "short",
    day: "numeric",
    month: "short",
    year: ano ? "numeric" : undefined,
    timeZone: fuso,
  })}${h}`;
}

/** "13 out. 2026" a partir de 'AAAA-MM-DD'. */
export function diaCurto(dia: string, comAno = true): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-PT", {
    day: "numeric",
    month: "short",
    year: comAno ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

/** "13 – 19 out. 2026". */
export function intervalo(de: string, ate: string): string {
  if (de === ate) return diaCurto(de);
  const mesmoAno = de.slice(0, 4) === ate.slice(0, 4);
  const mesmoMes = mesmoAno && de.slice(0, 7) === ate.slice(0, 7);
  if (mesmoMes) return `${Number(de.slice(8))} – ${diaCurto(ate)}`;
  return `${diaCurto(de, !mesmoAno)} – ${diaCurto(ate)}`;
}

/** "outubro 2026". */
export function mesAno(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-PT", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function iniciais(nome: string | null | undefined): string {
  const p = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

/** A mensagem a mostrar (as da API já vêm escritas para pessoas). */
export function mensagemErro(e: unknown): string {
  if (e instanceof ErroApi) return e.message;
  return "Ocorreu um erro. Tente outra vez.";
}

/* -------------------------------------------------------------------- */
/* Canais e resultados                                                    */
/* -------------------------------------------------------------------- */

export const CANAIS: Record<string, { rotulo: string; icone: LucideIcon }> = {
  telefone: { rotulo: "Telefone", icone: Phone },
  chat: { rotulo: "Chat", icone: MessageCircle },
  sms: { rotulo: "SMS", icone: MessageSquareText },
  email: { rotulo: "Email", icone: Mail },
  balcao: { rotulo: "Balcão", icone: Store },
  whatsapp: { rotulo: "WhatsApp", icone: MessageCircle },
};

export function canal(c: string) {
  return CANAIS[c] ?? { rotulo: c, icone: MessageCircle };
}

export type Tom = "verde" | "terracota" | "ambar" | "neutro" | "tinta" | "creme";

export const RESULTADOS: Record<
  Resultado,
  { rotulo: string; icone: LucideIcon; tom: Tom; ponto: string }
> = {
  resolvida: { rotulo: "Resolvida", icone: Check, tom: "verde", ponto: "bg-verde" },
  passada_funcionario: {
    rotulo: "Passada a funcionário",
    icone: UserRound,
    tom: "terracota",
    ponto: "bg-terracota",
  },
  sem_resposta: {
    rotulo: "Sem resposta",
    icone: CircleHelp,
    tom: "ambar",
    ponto: "bg-ambar",
  },
  marcacao: {
    rotulo: "Marcação feita",
    icone: CalendarCheck,
    tom: "creme",
    ponto: "bg-tinta-3",
  },
  emergencia: { rotulo: "Emergência", icone: Siren, tom: "tinta", ponto: "bg-tinta" },
  caiu: { rotulo: "Chamada caiu", icone: PhoneOff, tom: "neutro", ponto: "bg-tinta-3" },
  em_curso: { rotulo: "Em curso", icone: Loader, tom: "neutro", ponto: "bg-tinta-3" },
};

export function resultado(r: string) {
  return (
    RESULTADOS[r as Resultado] ?? {
      rotulo: r,
      icone: CircleHelp,
      tom: "neutro" as Tom,
      ponto: "bg-tinta-3",
    }
  );
}

export const MOTIVOS_PASSAGEM: Record<string, string> = {
  pedido: "Pediu para falar com uma pessoa",
  sem_fonte: "Sem fonte oficial para responder",
  juridico: "Questão jurídica",
  politica: "Assunto político",
  processo: "Sobre um processo",
  outro: "Outro motivo",
};

export const ESTADOS_PASSAGEM: Record<string, { rotulo: string; tom: Tom }> = {
  aberta: { rotulo: "Por pegar", tom: "terracota" },
  em_curso: { rotulo: "Em curso", tom: "ambar" },
  respondida: { rotulo: "Respondida", tom: "verde" },
  fechada: { rotulo: "Fechada", tom: "neutro" },
};

export const FASES: Record<string, string> = {
  entrada: "Entrada",
  documentos: "Documentos",
  apreciacao: "Apreciação técnica",
  pareceres_externos: "Pareceres externos",
  decisao: "Decisão",
  notificado: "Notificado",
  arquivado: "Arquivado",
};

/** Classes de cada tom (pílulas de estado). */
export const TONS: Record<Tom, string> = {
  verde: "bg-verde-suave text-verde",
  terracota: "bg-terracota-suave text-terracota-escuro",
  ambar: "bg-ambar-suave text-ambar",
  neutro: "bg-creme-2 text-tinta-2",
  creme: "bg-creme-2 text-tinta",
  tinta: "bg-tinta text-white",
};
