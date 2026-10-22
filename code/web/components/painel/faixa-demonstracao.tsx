import { FlaskConical } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Um aviso único por ecrã para os valores de demonstração (regras, prazos,
 * taxas que ainda não vêm de uma fonte oficial). Em vez de um selo em cada
 * cartão ou linha, que faz parecer que nada é real: o selo por item fica só
 * onde o valor simulado muda a decisão.
 */
export function FaixaDemonstracao({
  children,
  className,
}: {
  /** O que é de demonstração neste ecrã (uma frase). */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={`flex items-start gap-2.5 rounded-xl border border-ambar/25 bg-ambar-suave/60 px-4 py-2.5 text-[13px] leading-snug text-ambar ${className ?? ""}`}
    >
      <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-semibold">Valores de demonstração.</span>{" "}
        {children ?? "Alguns valores deste ecrã são de exemplo e ainda não foram confirmados pela câmara."}
      </p>
    </div>
  );
}
