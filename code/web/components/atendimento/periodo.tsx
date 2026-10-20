"use client";

import { Calendar, ChevronDown } from "lucide-react";
import { intervalo, somarDias } from "./formatos";

/* Períodos do painel: os da API são dias 'AAAA-MM-DD', `de` e `ate` inclusive. */

export type ChavePeriodo = "7d" | "30d" | "90d" | "mes" | "mes_passado";

export const ROTULOS_PERIODO: Record<ChavePeriodo, string> = {
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  mes: "Este mês",
  mes_passado: "Mês passado",
};

export function periodoDe(chave: ChavePeriodo, hoje: string) {
  switch (chave) {
    case "7d":
      return { de: somarDias(hoje, -6), ate: hoje };
    case "30d":
      return { de: somarDias(hoje, -29), ate: hoje };
    case "90d":
      return { de: somarDias(hoje, -89), ate: hoje };
    case "mes":
      return { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
    case "mes_passado": {
      const fim = somarDias(`${hoje.slice(0, 7)}-01`, -1);
      return { de: `${fim.slice(0, 7)}-01`, ate: fim };
    }
  }
}

export function chaveValida(v: string | null, porOmissao: ChavePeriodo): ChavePeriodo {
  return v && v in ROTULOS_PERIODO ? (v as ChavePeriodo) : porOmissao;
}

/** Botão de período (design: "13 – 19 out. 2026" com calendário). */
export function SeletorPeriodo({
  valor,
  hoje,
  mudar,
  opcoes = ["7d", "30d", "mes", "mes_passado", "90d"],
}: {
  valor: ChavePeriodo;
  hoje: string;
  mudar: (v: ChavePeriodo) => void;
  opcoes?: ChavePeriodo[];
}) {
  const p = periodoDe(valor, hoje);
  return (
    <label className="relative flex h-10 items-center gap-2 rounded-[10px] border border-linha bg-papel pl-3.5 pr-3 focus-within:outline-2 focus-within:outline-terracota">
      <Calendar className="size-4 text-tinta-2" aria-hidden />
      <span className="text-[13px] font-medium text-tinta">{intervalo(p.de, p.ate)}</span>
      <ChevronDown className="size-3.5 text-tinta-3" aria-hidden />
      <span className="sr-only">Período</span>
      <select
        value={valor}
        onChange={(e) => mudar(e.target.value as ChavePeriodo)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {opcoes.map((o) => (
          <option key={o} value={o}>
            {ROTULOS_PERIODO[o]}
          </option>
        ))}
      </select>
    </label>
  );
}
