"use client";

import { SeparadoresLinks } from "./ui";

/** "Lista · Tipos de processo · Modelos de resposta" (cabeçalho dos processos). */
export function SeparadoresProcessos({ atual }: { atual: string }) {
  return (
    <SeparadoresLinks
      rotulo="Secções dos processos"
      atual={atual}
      itens={[
        { href: "/painel/processos", rotulo: "Lista" },
        { href: "/painel/processos/tipos", rotulo: "Tipos de processo" },
        { href: "/painel/processos/modelos", rotulo: "Modelos de resposta" },
      ]}
    />
  );
}

/** Barras de fase da lista (4 passos: entrada, documentos, apreciação, decisão). */
export function passoDaFase(fase: string): number {
  switch (fase) {
    case "entrada":
      return 0;
    case "documentos":
      return 1;
    case "apreciacao":
    case "pareceres_externos":
      return 2;
    case "decisao":
      return 3;
    default:
      return 4; // notificado, arquivado: tudo feito
  }
}

export function BarrasFase({ fase }: { fase: string }) {
  const passo = passoDaFase(fase);
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`h-[5px] w-7 rounded-[3px] ${
            i < passo ? "bg-verde" : i === passo ? "bg-terracota" : "bg-linha"
          }`}
        />
      ))}
    </span>
  );
}
