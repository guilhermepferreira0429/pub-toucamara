"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { mensagemErro } from "@/components/atendimento/formatos";
import { useSessao } from "@/lib/sessao";

/** "ocorrencias-2026-10-22.csv" (o dia em Lisboa, como na API). */
function nomeFicheiro(base: string): string {
  const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
  return `${base}-${dia}.csv`;
}

/**
 * "Exportar" das listas do painel: pede o CSV com o token da sessão (fetch,
 * nunca o URL aberto à mão sem Authorization) e descarrega-o por um blob.
 * `caminho` é o da API com os mesmos filtros da lista, ex.:
 * `/v1/painel/ocorrencias/exportar.csv?estado=nova`.
 */
export function BotaoExportar({
  caminho,
  base,
  className,
}: {
  caminho: string;
  /** Início do nome do ficheiro: "ocorrencias" → ocorrencias-AAAA-MM-DD.csv. */
  base: string;
  className?: string;
}) {
  const { pedidoFicheiro } = useSessao();
  const [aExportar, setAExportar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function exportar() {
    setAExportar(true);
    setErro(null);
    try {
      const r = await pedidoFicheiro(caminho);
      if (r.tipo !== "ficheiro") throw new Error("A exportação não devolveu um ficheiro.");
      const url = URL.createObjectURL(r.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeFicheiro(base);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAExportar(false);
    }
  }

  return (
    <span className={`inline-flex flex-col items-end gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={exportar}
        disabled={aExportar}
        title="Descarregar a lista (com os filtros) em CSV para o Excel"
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full border-[1.5px] border-tinta px-4 text-sm font-semibold text-tinta transition-colors hover:bg-tinta/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracota disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download className="size-4" aria-hidden />
        {aExportar ? "A exportar…" : "Exportar"}
      </button>
      {erro && (
        <span role="alert" className="text-xs text-terracota-escuro">
          {erro}
        </span>
      )}
    </span>
  );
}
