"use client";

import { Eye, Headset, X } from "lucide-react";

/*
 * Faixa no topo da chamada web: quem está a acompanhar (o familiar, com o
 * botão para deixar de partilhar) e a última mensagem do funcionário.
 */
export function FaixaAoVivo({
  familiar,
  funcionario,
  onRetirar,
}: {
  familiar: string | null;
  funcionario: string | null;
  onRetirar: () => void;
}) {
  if (!familiar && !funcionario) return null;
  return (
    <div className="fixed inset-x-0 top-2 z-30 mx-auto flex w-[calc(100%-32px)] max-w-md flex-col gap-2">
      {familiar && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl border border-linha bg-papel px-3.5 py-2.5 shadow-sm"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-terracota-suave text-terracota-escuro">
            <Eye className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1 text-[13px] leading-snug text-tinta">
            <strong className="font-semibold">{maiuscula(familiar)}</strong> está a
            acompanhar esta chamada.
          </span>
          <button
            type="button"
            onClick={onRetirar}
            className="flex shrink-0 items-center gap-1 rounded-full bg-creme-2 px-3 py-1.5 text-xs font-semibold text-tinta"
          >
            <X className="size-3.5" aria-hidden />
            Deixar de partilhar
          </button>
        </div>
      )}
      {funcionario && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl bg-tinta px-3.5 py-2.5 text-white shadow-sm"
        >
          <Headset className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="text-[13px] leading-snug">
            Um funcionário da câmara está a ajudar: «{funcionario}»
          </span>
        </div>
      )}
    </div>
  );
}

function maiuscula(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
