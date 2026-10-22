"use client";

import { BookOpen, X } from "lucide-react";
import { useId, useState } from "react";
import type { Marca, TermoPublico } from "./tipos";

/**
 * Um texto com os termos do glossário sublinhados. Cada termo é um botão:
 * ao tocar (ou Enter/Espaço) abre a explicação logo a seguir ao texto, e o
 * leitor de ecrã ouve-a ao focar (aria-describedby). Esc fecha. Não depende
 * do rato: funciona ao toque e com o teclado.
 */
export function TextoComTermos({
  texto: textoBruto,
  marcas,
  termos,
  className = "",
  como: Tag = "p",
}: {
  texto: string;
  marcas: Marca[];
  termos: Map<string, TermoPublico>;
  className?: string;
  como?: "p" | "div";
}) {
  const base = useId();
  const [aberto, setAberto] = useState<number | null>(null);

  // Listas "- " passam a "• " (mesmo comprimento: as posições das marcas mantêm-se).
  const texto = textoBruto.replace(/^- /gm, "• ");
  const pedacos: React.ReactNode[] = [];
  let pos = 0;
  marcas.forEach((m, i) => {
    const t = termos.get(m.termo_id);
    if (!t || m.inicio < pos || m.fim > texto.length) return;
    if (m.inicio > pos) pedacos.push(texto.slice(pos, m.inicio));
    const idExplicacao = `${base}-e${i}`;
    const idCaixa = `${base}-c${i}`;
    pedacos.push(
      <span key={i}>
        <button
          type="button"
          aria-expanded={aberto === i}
          aria-controls={idCaixa}
          aria-describedby={idExplicacao}
          onClick={() => setAberto(aberto === i ? null : i)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setAberto(null);
          }}
          className="cursor-help rounded-sm text-left underline decoration-terracota decoration-dotted decoration-2 underline-offset-4 hover:bg-terracota-suave/60 focus-visible:bg-terracota-suave focus-visible:outline-2 focus-visible:outline-terracota"
        >
          {texto.slice(m.inicio, m.fim)}
        </button>
        <span id={idExplicacao} className="sr-only">
          {`Termo explicado: ${t.explicacao}`}
        </span>
      </span>,
    );
    pos = m.fim;
  });
  if (pos < texto.length) pedacos.push(texto.slice(pos));

  const marcaAberta = aberto !== null ? marcas[aberto] : null;
  const termoAberto = marcaAberta ? termos.get(marcaAberta.termo_id) : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Tag className={`whitespace-pre-line ${className}`}>{pedacos}</Tag>
      {aberto !== null && termoAberto && (
        <div
          id={`${base}-c${aberto}`}
          role="note"
          aria-label={`O que quer dizer "${termoAberto.termo}"`}
          className="flex gap-2.5 rounded-xl border border-terracota/30 bg-terracota-suave/50 p-3"
        >
          <BookOpen className="mt-0.5 size-4 shrink-0 text-terracota-escuro" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-[15px] leading-[1.45] text-tinta">
            <p>
              <span className="font-bold">{termoAberto.termo}</span>: {termoAberto.explicacao}
            </p>
            {termoAberto.exemplo && (
              <p className="text-[14px] text-tinta-2">Por exemplo: {termoAberto.exemplo}</p>
            )}
            {termoAberto.demonstracao && (
              <p className="text-[12px] font-semibold text-ambar">
                Explicação de demonstração, ainda por validar pela câmara.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => setAberto(null)}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-tinta-2 hover:bg-papel"
            aria-label="Fechar a explicação"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
