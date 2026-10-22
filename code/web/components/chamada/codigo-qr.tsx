"use client";

import { Phone } from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { Logo } from "@/components/ui/marca";
import { MUNICIPIO_NOME } from "./config";
import { gerarQr } from "./qr";

/*
 * Página do slide (plano B da demo): QR grande que abre /ligar no telemóvel.
 * O endereço vem de NEXT_PUBLIC_SITE_URL ou, sem ele, do próprio browser.
 * O QR é gerado aqui (components/chamada/qr.ts), sem serviços de fora.
 */

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

const semSubscricao = () => () => {};

function useEndereco(): string | null {
  const origem = useSyncExternalStore(
    semSubscricao,
    () => window.location.origin,
    () => null,
  );
  const base = SITE || origem;
  return base ? `${base}/ligar` : null;
}

function Qr({
  texto,
  className = "aspect-square w-[min(70vh,80vw)] max-w-[560px] rounded-3xl bg-white",
}: {
  texto: string;
  className?: string;
}) {
  const caminho = useMemo(() => {
    const m = gerarQr(texto);
    let d = "";
    m.forEach((linha, y) =>
      linha.forEach((escuro, x) => {
        if (escuro) d += `M${x + 4} ${y + 4}h1v1h-1z`;
      }),
    );
    return { d, lado: m.length + 8 };
  }, [texto]);
  return (
    <svg
      viewBox={`0 0 ${caminho.lado} ${caminho.lado}`}
      role="img"
      aria-label={`Código QR para ${texto}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <path d={caminho.d} className="fill-tinta" />
    </svg>
  );
}

export function PaginaQr() {
  const endereco = useEndereco();
  const visivel = endereco?.replace(/^https?:\/\//, "");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-creme px-6 py-10 lg:flex-row lg:gap-16">
      <div className="flex max-w-md flex-col gap-5 text-center lg:text-left">
        <Logo tamanho={32} />
        <h1 className="font-display text-[44px] font-bold leading-[1.02] tracking-[-1.2px] text-tinta lg:text-[56px]">
          Ligue à câmara pelo telemóvel.
        </h1>
        <p className="text-lg leading-normal text-tinta-2">
          Aponte a câmara do telemóvel ao código e toque em{" "}
          <span className="inline-flex items-center gap-1 font-semibold text-terracota-escuro">
            <Phone className="size-4" aria-hidden />
            Ligar agora
          </span>
          . Atende a Câmara de {MUNICIPIO_NOME}, no browser, sem instalar nada.
        </p>
        {visivel && (
          <p className="font-mono text-2xl font-bold break-all text-tinta lg:text-3xl">
            {visivel}
          </p>
        )}
      </div>
      {endereco ? (
        <Qr texto={endereco} />
      ) : (
        <div
          aria-hidden
          className="aspect-square w-[min(70vh,80vw)] max-w-[560px] rounded-3xl bg-white"
        />
      )}
    </main>
  );
}

/**
 * No computador, ao lado da chamada: o mesmo /ligar num QR pequeno, para quem
 * prefere falar pelo telemóvel (a chamada abre lá, sem instalar nada).
 */
export function QrParaTelemovel() {
  const endereco = useEndereco();
  if (!endereco) return null;
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-linha bg-papel p-4">
      <Qr texto={endereco} className="aspect-square w-[104px] shrink-0 rounded-xl bg-white" />
      <p className="text-[14px] leading-[1.45] text-tinta-2">
        <span className="block font-semibold text-tinta">Prefere o telemóvel?</span>
        Aponte a câmara do telemóvel ao código: a chamada abre lá.
      </p>
    </div>
  );
}
