import { FlaskConical } from "lucide-react";

/**
 * O aviso grande "Simulação — sem validade legal" das páginas do munícipe.
 * Fica sempre visível antes de qualquer botão de autorizar: ninguém pode
 * pensar que fez uma entrega real.
 */
export function AvisoSimulacao({
  detalhe = "A Chave Móvel Digital exige credenciação na AMA. Até lá, a autorização e a entrega são de demonstração: nada chega de verdade à câmara.",
}: {
  detalhe?: string;
}) {
  return (
    <section
      role="note"
      aria-label="Simulação, sem validade legal"
      className="flex w-full gap-3 rounded-2xl border-2 border-ambar bg-ambar-suave p-4"
    >
      <FlaskConical className="mt-0.5 size-6 shrink-0 text-ambar" aria-hidden />
      <div className="flex flex-col gap-1">
        <p className="font-display text-[19px] font-bold leading-tight text-tinta">
          Simulação — sem validade legal
        </p>
        <p className="text-[14px] leading-[1.45] text-tinta">{detalhe}</p>
      </div>
    </section>
  );
}
