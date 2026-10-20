"use client";

import { AlertTriangle, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import type { ErroApi } from "@/lib/api";
import { numero } from "./comum";
import type { PassoDiff, Requisito } from "./tipos";

/** O que falta para publicar, em português. */
export const REQUISITOS: Record<Requisito, { rotulo: string; icone: typeof ShieldCheck }> = {
  avaliacao: { rotulo: "falta uma avaliação do agente que passe", icone: Sparkles },
  revisao_interna: { rotulo: "falta a revisão da equipa Tou, Câmara?", icone: UserCheck },
};

export function PrecisaDe({ requisitos }: { requisitos: Requisito[] }) {
  if (!requisitos.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="O que falta para publicar">
      {requisitos.map((r) => {
        const { rotulo, icone: Icone } = REQUISITOS[r];
        return (
          <li
            key={r}
            className="inline-flex items-center gap-1 rounded-xl bg-ambar-suave px-2.5 py-1 text-xs font-semibold text-ambar"
          >
            <Icone className="size-3.5" aria-hidden />
            {rotulo}
          </li>
        );
      })}
    </ul>
  );
}

interface DetalhesGate {
  causa?: string;
  taxa?: number | null;
  limiar?: number;
  versao_atual?: string | null;
  comando?: string;
  precisa_de?: Requisito[];
}

/** Erros que são do gate de publicação (podem ser forçados pela equipa interna). */
export function eErroDeAvaliacao(e: ErroApi | null | undefined): boolean {
  return e?.codigo === "avaliacao_em_falta" || e?.codigo === "avaliacao_abaixo_do_limiar";
}

/**
 * Erro ao publicar: a mensagem da API e, do gate do avaliador, a taxa, o
 * mínimo, o que falta e (para a equipa interna) o comando a correr.
 */
export function ErroPublicacao({
  erro,
  interno,
}: {
  erro: ErroApi | null | undefined;
  interno: boolean;
}) {
  if (!erro) return null;
  const d = (erro.detalhes ?? {}) as DetalhesGate;
  const gate =
    eErroDeAvaliacao(erro) ||
    erro.codigo === "revisao_interna_em_falta" ||
    erro.codigo === "versao_rejeitada";
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-xl border border-terracota/30 bg-terracota-suave/50 p-3.5 text-[13px] text-tinta"
    >
      <p className="flex items-start gap-2 font-semibold text-terracota-escuro">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
        {erro.message}
      </p>
      {gate && (d.taxa != null || d.limiar != null) && (
        <p className="text-tinta-2">
          Última avaliação:{" "}
          <strong className="text-tinta">
            {d.taxa != null ? `${numero(d.taxa, 1)}%` : "sem taxa"}
          </strong>
          {d.limiar != null && <> · mínimo para publicar: {d.limiar}%</>}
          {d.versao_atual && <> · versão do agente {d.versao_atual}</>}
        </p>
      )}
      {d.precisa_de && <PrecisaDe requisitos={d.precisa_de} />}
      {interno && d.comando && (
        <p className="text-xs text-tinta-2">
          Para avaliar: <code className="rounded bg-papel px-1.5 py-0.5 font-mono">{d.comando}</code>
        </p>
      )}
    </div>
  );
}

/** Diferença por frase entre duas versões. */
export function Diferencas({ passos }: { passos: PassoDiff[] }) {
  if (!passos.length) return <p className="text-xs text-tinta-3">Sem texto.</p>;
  return (
    <div className="flex flex-col gap-1">
      {passos.map((p, i) => {
        if (p.tipo === "igual")
          return (
            <p key={i} className="px-2.5 text-[13px] text-tinta-2">
              {p.frase}
            </p>
          );
        return (
          <div key={i} className="flex flex-col gap-1">
            {(p.tipo === "alterada" || p.tipo === "removida") && (
              <p className="flex gap-2 rounded-lg bg-terracota-suave/40 px-2.5 py-1.5 text-[13px] text-tinta-2">
                <span className="font-bold text-terracota-escuro" aria-label="Saiu">
                  −
                </span>
                <span className="line-through decoration-terracota/40">{p.antes}</span>
              </p>
            )}
            {(p.tipo === "alterada" || p.tipo === "adicionada") && (
              <p className="flex gap-2 rounded-lg bg-verde-suave px-2.5 py-1.5 text-[13px] text-tinta">
                <span className="font-bold text-verde" aria-label="Entrou">
                  +
                </span>
                <span>{p.depois}</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
