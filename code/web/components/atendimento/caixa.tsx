"use client";

import { CornerDownRight, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { TONS, type Tom } from "./formatos";

/*
 * Moldura das caixas (Email geral e Entrada, frames j69Tq e ZRWWs): lista de
 * 600 px à esquerda, pré-visualização à direita, cada uma com o seu scroll.
 */

export function Caixa({
  lista,
  previa,
  previaAberta,
}: {
  lista: React.ReactNode;
  previa: React.ReactNode;
  /** Em ecrãs estreitos só se vê uma das duas. */
  previaAberta: boolean;
}) {
  return (
    <div className="flex lg:h-dvh">
      <div
        className={`w-full shrink-0 flex-col border-r border-linha bg-papel lg:flex lg:w-[440px] lg:overflow-y-auto 2xl:w-[600px] ${
          previaAberta ? "hidden" : "flex"
        }`}
      >
        {lista}
      </div>
      <div
        className={`min-w-0 flex-1 lg:block lg:overflow-y-auto ${previaAberta ? "block" : "hidden"}`}
      >
        {previa}
      </div>
    </div>
  );
}

export function TopoCaixa({
  titulo,
  sub,
  acao,
  children,
}: {
  titulo: string;
  sub: string;
  acao?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-linha px-7 pt-7">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[28px] font-bold tracking-[-0.6px] text-tinta">
            {titulo}
          </h1>
          <p className="text-[13px] text-tinta-2">{sub}</p>
        </div>
        {acao}
      </div>
      {children}
    </div>
  );
}

/** Etiqueta pequena das linhas (encaminhamento, estado). */
export function EtiquetaCaixa({
  tom = "neutro",
  icone: Icone = CornerDownRight,
  children,
}: {
  tom?: Tom;
  icone?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-[5px] rounded-[11px] px-[9px] py-[3px] text-[11px] font-semibold ${TONS[tom]}`}
    >
      <Icone className="size-3" aria-hidden />
      {children}
    </span>
  );
}

export function LinhaCaixa({
  href,
  selecionada,
  icone: Icone,
  rotuloIcone,
  quem,
  hora,
  assunto,
  resumo,
  etiquetas,
  urgente,
}: {
  href: string;
  selecionada: boolean;
  icone: LucideIcon;
  rotuloIcone: string;
  quem: string;
  hora: string;
  assunto: string;
  resumo?: string | null;
  etiquetas?: React.ReactNode;
  urgente?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        aria-current={selecionada ? "true" : undefined}
        className={`flex gap-3.5 border-b py-4 pr-7 ${
          selecionada
            ? "border-b-terracota border-l-[3px] border-l-terracota bg-creme pl-[25px]"
            : "border-linha pl-7 hover:bg-creme/60"
        }`}
      >
        <span
          className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-creme-2"
          title={rotuloIcone}
        >
          <Icone className="size-4 text-tinta-2" aria-label={rotuloIcone} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[5px]">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-tinta-2">
              {quem}
            </span>
            {urgente && (
              <span className="rounded-lg bg-terracota px-1.5 py-px text-[11px] font-bold text-white">
                urgente
              </span>
            )}
            <span className="shrink-0 text-xs text-tinta-3">{hora}</span>
          </span>
          <span className="truncate text-[15px] font-bold text-tinta">{assunto}</span>
          {resumo && (
            <span className="line-clamp-2 text-[13px] leading-[1.4] text-tinta-2">{resumo}</span>
          )}
          {etiquetas && <span className="flex flex-wrap gap-1.5 pt-1">{etiquetas}</span>}
        </span>
      </Link>
    </li>
  );
}

/** Quando nada está escolhido do lado direito. */
export function PreviaVazia({ texto }: { texto: string }) {
  return (
    <div className="hidden h-full items-center justify-center px-8 text-center text-sm text-tinta-3 lg:flex">
      {texto}
    </div>
  );
}

/** Ficha "O que o agente percebeu" (Campo · Valor, 90 px). */
export function Ficha({
  titulo,
  extra,
  children,
}: {
  titulo: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-linha bg-papel px-5 py-4">
      <div className="flex items-center gap-2 pb-2">
        <h2 className="text-[11px] font-bold tracking-[1px] text-tinta-3 uppercase">{titulo}</h2>
        {extra}
      </div>
      <dl>{children}</dl>
    </section>
  );
}

export function BotaoAcao({
  icone: Icone,
  children,
  principal,
  ...resto
}: {
  icone: LucideIcon;
  principal?: boolean;
} & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...resto}
      className={`flex h-10 items-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold disabled:opacity-60 ${
        principal
          ? "bg-terracota text-white hover:bg-terracota-escuro"
          : "border border-linha bg-papel text-tinta hover:bg-creme"
      }`}
    >
      <Icone className="size-4" aria-hidden />
      {children}
    </button>
  );
}
