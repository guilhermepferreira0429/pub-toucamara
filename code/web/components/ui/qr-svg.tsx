"use client";

import { useMemo } from "react";
import { gerarQr } from "@/components/chamada/qr";

/** Código QR em SVG (gerado aqui, sem serviços de fora). */
export function QrSvg({
  texto,
  className,
  rotulo = "Código QR da licença",
}: {
  texto: string;
  className?: string;
  rotulo?: string;
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
      aria-label={rotulo}
      shapeRendering="crispEdges"
      className={`aspect-square rounded-2xl bg-white ${className ?? ""}`}
    >
      <path d={caminho.d} className="fill-tinta" />
    </svg>
  );
}
