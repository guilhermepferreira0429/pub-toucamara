"use client";

import { useSyncExternalStore } from "react";
import { Logo } from "@/components/ui/marca";
import { QrSvg } from "@/components/ui/qr-svg";
import { CODIGO_LINGUA, LINGUAS, NOME_LINGUA, TEXTOS, type Lingua } from "./textos";

/*
 * Cartaz com o código QR da página /visitar, para o posto de turismo, hotéis
 * e monumentos. O endereço vem de NEXT_PUBLIC_SITE_URL ou do próprio browser;
 * com ?lingua= o QR abre a página já nessa língua. O título aparece nas
 * quatro línguas (o cartaz é para todos).
 */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
const MUNICIPIO = process.env.NEXT_PUBLIC_MUNICIPIO ?? "guimaraes";
const semSubscricao = () => () => {};

export function QrVisitar({ lingua }: { lingua: Lingua | null }) {
  const origem = useSyncExternalStore(
    semSubscricao,
    () => window.location.origin,
    () => null,
  );
  const base = SITE || origem;
  const endereco = base ? `${base}/visitar/${encodeURIComponent(MUNICIPIO)}${lingua ? `?lingua=${lingua}` : ""}` : null;
  const visivel = endereco?.replace(/^https?:\/\//, "");
  const ordem: Lingua[] = lingua ? [lingua, ...LINGUAS.filter((l) => l !== lingua)] : [...LINGUAS];

  return (
    <div className="flex w-full flex-col items-center gap-6 py-4 text-center">
      <Logo tamanho={28} />
      <h1 className="sr-only">{TEXTOS[ordem[0]].qr}</h1>
      <ul className="flex flex-col gap-3">
        {ordem.map((l) => (
          <li key={l} lang={CODIGO_LINGUA[l]} className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold tracking-[1px] text-tinta-3 uppercase">{NOME_LINGUA[l]}</span>
            <span className="font-display text-[22px] leading-tight font-bold text-tinta">{TEXTOS[l].tituloQr}</span>
          </li>
        ))}
      </ul>
      {endereco ? (
        <QrSvg texto={endereco} rotulo={`${TEXTOS[ordem[0]].qr}: ${visivel ?? endereco}`} className="w-full max-w-[320px]" />
      ) : (
        <div aria-hidden className="aspect-square w-full max-w-[320px] rounded-2xl bg-white" />
      )}
      <p lang={CODIGO_LINGUA[ordem[0]]} className="text-[15px] leading-[1.45] text-tinta-2">
        {TEXTOS[ordem[0]].textoQr}
      </p>
      {visivel && <p className="font-mono text-[15px] font-bold break-all text-tinta">{visivel}</p>}
    </div>
  );
}
