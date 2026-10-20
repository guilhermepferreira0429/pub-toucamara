"use client";

import { FileDown } from "lucide-react";
import { useState } from "react";
import { useSessao } from "@/lib/sessao";
import { mensagemErro } from "./formatos";

/**
 * "Relatório para o vereador": gera o relatório do período e abre o PDF
 * (URL assinada de 5 minutos). Só para quem tem Indicadores.
 */
export function BotaoRelatorio({
  tipo,
  de,
  ate,
  rotulo,
}: {
  tipo: "semanal" | "mensal" | "executivo";
  de: string;
  ate: string;
  rotulo: string;
}) {
  const { pedido, pode } = useSessao();
  const [aGerar, setAGerar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (!pode("indicadores")) return null;

  async function gerar() {
    setAGerar(true);
    setErro(null);
    // A janela abre já (senão o browser bloqueia) e recebe o PDF depois.
    const janela = window.open("", "_blank");
    try {
      const r = await pedido<{ id: string }>("/v1/painel/relatorios/gerar", {
        corpo: { tipo, de, ate },
      });
      const { url } = await pedido<{ url: string }>(
        `/v1/painel/relatorios/${r.id}/pdf`,
      );
      if (janela) janela.location.href = url;
      else window.location.href = url;
    } catch (e) {
      janela?.close();
      setErro(mensagemErro(e));
    } finally {
      setAGerar(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={gerar}
        disabled={aGerar}
        aria-busy={aGerar}
        className="flex h-10 items-center gap-2 rounded-[10px] bg-tinta px-4 text-[13px] font-semibold text-white hover:bg-tinta/90 disabled:opacity-70"
      >
        <FileDown className="size-4" aria-hidden />
        {aGerar ? "A preparar o PDF…" : rotulo}
      </button>
      {erro && (
        <p
          role="alert"
          className="absolute right-0 top-12 z-10 w-72 rounded-lg border border-terracota/30 bg-papel p-3 text-xs text-terracota-escuro shadow-sm"
        >
          {erro}
        </p>
      )}
    </div>
  );
}
