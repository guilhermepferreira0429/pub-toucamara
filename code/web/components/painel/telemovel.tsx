"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";

/**
 * Filtros que no telemóvel (abaixo de `md`) ficam atrás de um botão
 * "Filtros", para não ocuparem meio ecrã antes da lista. No computador
 * aparecem sempre, como antes (`md:contents`: os filtros continuam filhos do
 * contentor de fora). `ativos` é o número de filtros escolhidos.
 */
export function FiltrosRecolhiveis({
  children,
  ativos = 0,
  className = "flex flex-wrap items-center gap-2 md:contents",
}: {
  children: React.ReactNode;
  ativos?: number;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls={id}
        onClick={() => setAberto((a) => !a)}
        className={`inline-flex h-10 w-fit items-center gap-2 rounded-[10px] border px-3 text-[13px] font-semibold md:hidden ${
          aberto || ativos
            ? "border-tinta bg-tinta text-white"
            : "border-linha bg-papel text-tinta"
        }`}
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        Filtros
        {ativos > 0 && (
          <span className="rounded-full bg-white/20 px-1.5 text-[11px] font-bold tabular-nums">
            {ativos}
          </span>
        )}
      </button>
      <div id={id} className={`${aberto ? "" : "max-md:hidden"} ${className}`}>
        {children}
      </div>
    </>
  );
}
