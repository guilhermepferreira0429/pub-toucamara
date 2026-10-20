"use client";

import { Check, TriangleAlert } from "lucide-react";
import { quando, numero } from "./formatos";
import { useFuso } from "./dados";
import type { Qualidade } from "./tipos";
import { Esqueleto } from "./ui";

/** "Teste de qualidade" (Visão geral): a última execução do avaliador. */
export function CartaoQualidade({
  dados,
  erro,
}: {
  dados?: Qualidade;
  erro?: string;
}) {
  const fuso = useFuso();
  const u = dados?.ultima ?? null;
  const limiar = dados?.limiar ?? 80;
  const taxa = u?.taxa ?? null;
  const certasOuBem = (u?.certas ?? 0) + (u?.passadas_bem ?? 0);

  return (
    <section
      aria-labelledby="qualidade-titulo"
      className="flex w-full shrink-0 flex-col gap-[18px] rounded-2xl bg-tinta p-6 text-white xl:w-[340px]"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="qualidade-titulo"
          className="font-display text-xl font-bold tracking-[-0.3px]"
        >
          Teste de qualidade
        </h2>
        {u &&
          (u.passou ? (
            <span className="flex items-center gap-1.5 rounded-xl bg-verde px-2.5 py-1 text-[11px] font-bold">
              <Check className="size-3" aria-hidden />
              No ar
            </span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-xl bg-terracota px-2.5 py-1 text-[11px] font-bold">
              <TriangleAlert className="size-3" aria-hidden />
              Abaixo do mínimo
            </span>
          ))}
      </div>

      {!dados && !erro && <Esqueleto className="h-40 bg-white/10" />}
      {erro && <p className="text-[13px] text-white/70">{erro}</p>}
      {dados && !u && (
        <p className="text-[13px] leading-relaxed text-white/70">
          Ainda não correu nenhum teste de qualidade. O agente só vai ao ar
          depois de acertar pelo menos {limiar}% das perguntas.
        </p>
      )}

      {u && (
        <>
          <div className="flex items-end gap-2.5">
            <span className="font-display text-[56px] font-bold leading-none tracking-[-2px]">
              {taxa === null ? "—" : `${Math.round(taxa)}%`}
            </span>
            <span className="text-xs leading-[1.4] text-white/70">
              {numero(certasOuBem)} de {numero(u.perguntas)} perguntas
              <br />
              certas ou bem passadas
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <div
              role="meter"
              aria-label="Taxa de acerto"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={taxa ?? 0}
              className="relative h-2 rounded bg-white/15"
            >
              <span
                className="absolute inset-y-0 left-0 rounded bg-terracota"
                style={{ width: `${Math.min(100, taxa ?? 0)}%` }}
              />
              <span
                className="absolute -top-1 h-4 w-0.5 bg-white"
                style={{ left: `${limiar}%` }}
                aria-hidden
              />
            </div>
            <div className="flex justify-between gap-2 text-[11px] text-white/60">
              <span>
                {u.terminada_em ? `Corrido ${quando(u.terminada_em, fuso).toLowerCase()}` : ""}
              </span>
              <span>Mínimo para ir ao ar: {limiar}%</span>
            </div>
          </div>

          <dl className="flex flex-col pt-1">
            {[
              ["Certas", u.certas, "text-white"],
              ["Passadas a funcionário, como devia", u.passadas_bem, "text-white"],
              [
                "Erradas, a corrigir",
                (u.erradas ?? 0) + (u.sem_resposta ?? 0),
                "text-[#F2B49B]",
              ],
            ].map(([rotulo, v, cor]) => (
              <div
                key={rotulo as string}
                className="flex justify-between border-t border-white/12 py-2.5 text-[13px]"
              >
                <dt className="text-white/80">{rotulo}</dt>
                <dd className={`font-bold ${cor}`}>{numero(v as number | null)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
