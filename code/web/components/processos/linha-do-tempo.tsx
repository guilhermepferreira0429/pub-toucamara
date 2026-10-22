"use client";

import {
  AlarmClock,
  ArrowRight,
  ArrowUp,
  BellRing,
  Circle,
  CloudOff,
  CreditCard,
  FileCheck,
  FilePlus,
  FileText,
  FolderPlus,
  Gavel,
  Lock,
  type LucideIcon,
  Mail,
  MessageSquareText,
  Phone,
  Send,
  ShieldAlert,
  StickyNote,
  Timer,
  UserRoundCheck,
} from "lucide-react";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import { diaHora } from "./formatos";
import type { EventoProcesso } from "./tipos";
import { ErroEmLinha, paraErro, RotuloSeccao } from "./ui";

/*
 * Linha do tempo do processo (frame C950r): trilho com ícone por tipo de
 * evento, filtro "Tudo / Visível ao munícipe / Interno" e a nota interna
 * no fundo (POST /processos/:id/eventos).
 */

type Estilo = { icone: LucideIcon; fundo: string; cor: string; titulo: string };

const NEUTRO = "bg-creme border border-linha";

function estiloDe(e: EventoProcesso): Estilo {
  const t = e.tipo;
  switch (t) {
    case "criado":
      return { icone: FolderPlus, fundo: NEUTRO, cor: "text-tinta-2", titulo: "Processo criado" };
    case "fase":
      return { icone: ArrowRight, fundo: NEUTRO, cor: "text-tinta-2", titulo: "Mudança de fase" };
    case "atribuido":
      return { icone: UserRoundCheck, fundo: NEUTRO, cor: "text-tinta-2", titulo: "Técnico atribuído" };
    case "prazo":
      return { icone: Timer, fundo: NEUTRO, cor: "text-tinta-2", titulo: "Prazo a contar" };
    case "decisao":
      return { icone: Gavel, fundo: "bg-tinta", cor: "text-white", titulo: "Decisão" };
    case "nota_interna":
      return { icone: Lock, fundo: "bg-ambar-suave", cor: "text-ambar", titulo: "Nota interna" };
    case "nota":
      return { icone: StickyNote, fundo: NEUTRO, cor: "text-tinta-2", titulo: "Nota" };
    case "documento_pedido":
      return { icone: Send, fundo: NEUTRO, cor: "text-tinta-2", titulo: "Pedido ao munícipe" };
    case "documento":
    case "documento_recebido":
      return { icone: FileCheck, fundo: "bg-verde", cor: "text-white", titulo: "Documento recebido" };
    case "oficio":
      return { icone: FileText, fundo: "bg-tinta", cor: "text-white", titulo: "Ofício emitido" };
    case "pedido_elementos":
      return { icone: FilePlus, fundo: "bg-tinta", cor: "text-white", titulo: "Pedido de elementos" };
    case "notificacao_sms":
      return { icone: MessageSquareText, fundo: "bg-tinta", cor: "text-white", titulo: "Notificação por SMS" };
    case "chamada":
    case "chamada_saida":
      return { icone: Phone, fundo: "bg-terracota", cor: "text-white", titulo: "Chamada" };
    case "email":
      return { icone: Mail, fundo: "bg-tinta", cor: "text-white", titulo: "Email" };
    case "avisado":
    case "aviso":
      return { icone: BellRing, fundo: NEUTRO, cor: "text-tinta-2", titulo: "Munícipe avisado" };
    case "pagamento":
      return { icone: CreditCard, fundo: "bg-verde", cor: "text-white", titulo: "Pagamento" };
    case "antecipacao":
      return { icone: AlarmClock, fundo: "bg-terracota-suave", cor: "text-terracota-escuro", titulo: "Antecipação" };
    case "alerta_prazo_camara":
      return { icone: ShieldAlert, fundo: "bg-ambar-suave", cor: "text-ambar", titulo: "Alerta à chefia" };
    case "audiencia_previa":
      return { icone: Gavel, fundo: "bg-ambar-suave", cor: "text-ambar", titulo: "Audiência prévia" };
    case "sync_erro":
      return { icone: CloudOff, fundo: "bg-[#C62F1F]", cor: "text-white", titulo: "Não chegou à gestão documental" };
    default:
      return {
        icone: Circle,
        fundo: NEUTRO,
        cor: "text-tinta-2",
        titulo: t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      };
  }
}

type Filtro = "tudo" | "visivel" | "interno";

export function LinhaDoTempo({
  processoId,
  eventos,
  onNota,
}: {
  processoId: string;
  eventos: EventoProcesso[];
  onNota: () => void;
}) {
  const { pedido } = useSessao();
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const [nota, setNota] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const visiveis = eventos.filter((e) =>
    filtro === "tudo" ? true : filtro === "interno" ? e.interno : !e.interno,
  );

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    const descricao = nota.trim();
    if (!descricao) return;
    setAEnviar(true);
    setErro(null);
    try {
      await pedido(`/v1/painel/processos/${processoId}/eventos`, {
        corpo: { descricao, interno: true },
      });
      setNota("");
      onNota();
    } catch (e) {
      setErro(paraErro(e).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <section
      aria-labelledby="titulo-linha-tempo"
      className="flex min-h-[420px] flex-col rounded-2xl border border-linha bg-papel p-5"
    >
      <div className="flex items-center justify-between pb-3">
        <RotuloSeccao>
          <span id="titulo-linha-tempo">Linha do tempo</span>
        </RotuloSeccao>
        <label className="flex items-center gap-1 text-xs font-semibold text-tinta-2">
          <span className="sr-only">Mostrar</span>
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as Filtro)}
            className="rounded-md bg-transparent py-0.5 text-xs font-semibold text-tinta-2"
          >
            <option value="tudo">Tudo</option>
            <option value="visivel">Visível ao munícipe</option>
            <option value="interno">Só interno</option>
          </select>
        </label>
      </div>

      {visiveis.length === 0 ? (
        <p className="py-6 text-sm text-tinta-3">Sem eventos para mostrar.</p>
      ) : (
        <ol className="flex flex-col">
          {visiveis.map((e, i) => {
            const s = estiloDe(e);
            const Icone = s.icone;
            const ultimo = i === visiveis.length - 1;
            const erroSync = e.tipo === "sync_erro";
            return (
              <li key={e.id} className="flex gap-3.5">
                <div className="flex w-8 shrink-0 flex-col items-center">
                  <span
                    className={`flex size-8 items-center justify-center rounded-full ${s.fundo}`}
                  >
                    <Icone className={`size-[15px] ${s.cor}`} aria-hidden />
                  </span>
                  {!ultimo && <span className="w-0.5 flex-1 bg-linha" />}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[3px] pb-4 pt-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={`text-sm font-bold ${erroSync ? "text-[#8E2216]" : "text-tinta"}`}
                    >
                      {s.titulo}
                      {e.interno && !erroSync && e.tipo !== "nota_interna" && (
                        <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-[0.5px] text-tinta-3">
                          interno
                        </span>
                      )}
                    </p>
                    <time
                      dateTime={e.em}
                      className="shrink-0 text-xs text-tinta-3"
                    >
                      {diaHora(e.em)}
                    </time>
                  </div>
                  <p className="whitespace-pre-line text-[13px] text-tinta-2">
                    {e.descricao}
                    {e.ator_nome && e.ator_tipo === "utilizador" && (
                      <span className="text-tinta-3"> · {e.ator_nome}</span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <form
        onSubmit={enviar}
        className="mt-auto flex flex-col gap-1.5 pt-4"
      >
        <div className="flex items-center gap-2.5 rounded-xl border border-linha bg-creme py-[7px] pl-4 pr-2">
          <label htmlFor="nota-interna" className="sr-only">
            Nota interna
          </label>
          <input
            id="nota-interna"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={4000}
            placeholder="Escrever uma nota interna (o munícipe não vê)…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-tinta placeholder:text-tinta-3 focus:outline-none"
          />
          <button
            type="submit"
            disabled={aEnviar || !nota.trim()}
            aria-label="Guardar nota interna"
            className="flex size-8 items-center justify-center rounded-full bg-tinta text-white disabled:opacity-40"
          >
            <ArrowUp className="size-[15px]" aria-hidden />
          </button>
        </div>
        <ErroEmLinha erro={erro} />
      </form>
    </section>
  );
}
