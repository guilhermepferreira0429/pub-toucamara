"use client";

import { ArrowRight, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MUNICIPIO } from "@/components/chamada/config";
import { api } from "@/lib/api";

/** O que a página de apresentação precisa de GET /v1/public/avaliacao/:municipio. */
interface Resumo {
  limiar: number;
  outro_nome: string;
  nosso: { taxa: number | null; total: number; terminada_em: string | null } | null;
  comparacao: {
    perguntas: number;
    nosso: { acertos: number; taxa: number | null };
    outro: { acertos: number; taxa: number | null };
  } | null;
}

function pct(n: number | null): string {
  return n === null
    ? "—"
    : `${n.toLocaleString("pt-PT", { maximumFractionDigits: 1, minimumFractionDigits: Number.isInteger(n) ? 0 : 1 })}%`;
}

/**
 * Os números da última avaliação, lidos ao abrir a página. Sem avaliação
 * (ou sem API), diz que os resultados aparecem quando a medição terminar:
 * nunca se mostra um número que não foi medido.
 */
export function NumerosAvaliacao() {
  const [d, setD] = useState<Resumo | null | "sem">(null);

  useEffect(() => {
    let ativo = true;
    api<Resumo>(`/v1/public/avaliacao/${encodeURIComponent(MUNICIPIO)}`)
      .then((r) => ativo && setD(r.nosso && r.nosso.total > 0 ? r : "sem"))
      .catch(() => ativo && setD("sem"));
    return () => {
      ativo = false;
    };
  }, []);

  if (d === null) {
    return <div className="h-[188px] animate-pulse rounded-3xl bg-papel/70" aria-hidden />;
  }

  if (d === "sem") {
    return (
      <div className="flex flex-col gap-4 rounded-3xl border border-linha bg-papel p-6 sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-full bg-ambar-suave">
          <ClipboardCheck className="size-5 text-ambar" aria-hidden />
        </span>
        <p className="font-display text-[22px] font-bold leading-tight text-tinta">
          Os resultados aparecem aqui assim que a avaliação terminar.
        </p>
        <p className="text-[15px] leading-relaxed text-tinta-2">
          Não pomos um número que não tenha sido medido. Quando a avaliação acabar, esta caixa mostra a taxa de acerto e a
          comparação, e cada pergunta fica aberta para consulta.
        </p>
      </div>
    );
  }

  const c = d.comparacao;
  return (
    <div className="flex flex-col gap-6 rounded-3xl border border-linha bg-papel p-6 sm:p-8">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <span className="font-display text-[64px] font-extrabold leading-none tracking-[-2px] text-verde">
          {pct(d.nosso!.taxa)}
        </span>
        <span className="pb-2 text-[16px] leading-snug text-tinta-2">
          de respostas certas ou maioritariamente certas, julgadas às cegas por dois juízes,
          <br className="hidden sm:block" /> em {d.nosso!.total} perguntas de teste.
        </span>
      </div>
      {c && (
        <div className="flex flex-col gap-3 border-t border-linha pt-5">
          <p className="text-[14px] font-semibold text-tinta">Nas mesmas {c.perguntas} perguntas, com os mesmos juízes:</p>
          <Barra rotulo="Tou, Câmara?" taxa={c.nosso.taxa} cor="bg-verde" />
          <Barra rotulo={d.outro_nome} taxa={c.outro.taxa} cor="bg-tinta-3" />
        </div>
      )}
      <Link
        href="/avaliacao"
        className="inline-flex min-h-12 items-center gap-2 self-start rounded-full bg-tinta px-5 text-[15px] font-semibold text-papel transition-colors hover:bg-tinta-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-terracota"
      >
        Ver todas as perguntas e respostas
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function Barra({ rotulo, taxa, cor }: { rotulo: string; taxa: number | null; cor: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[150px] shrink-0 text-[14px] text-tinta-2">{rotulo}</span>
      <span className="h-3 flex-1 overflow-hidden rounded-full bg-creme-2" aria-hidden>
        <span className={`block h-full rounded-full ${cor}`} style={{ width: `${Math.max(0, Math.min(100, taxa ?? 0))}%` }} />
      </span>
      <span className="w-12 shrink-0 text-right text-[15px] font-bold tabular-nums text-tinta">{pct(taxa)}</span>
    </div>
  );
}
