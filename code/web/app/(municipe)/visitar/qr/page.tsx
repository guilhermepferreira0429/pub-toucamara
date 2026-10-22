import type { Metadata } from "next";
import { Suspense } from "react";
import { linguaValida } from "@/components/turismo/textos";
import { QrVisitar } from "@/components/turismo/qr-visitar";

export const metadata: Metadata = {
  title: "Visitar · código QR",
};

type Pesquisa = Promise<Record<string, string | string[] | undefined>>;

async function Conteudo({ searchParams }: { searchParams: Pesquisa }) {
  const q = await searchParams;
  const l = Array.isArray(q.lingua) ? q.lingua[0] : q.lingua;
  return <QrVisitar lingua={linguaValida(l)} />;
}

/** Cartaz com o QR da página /visitar (posto de turismo, hotéis, monumentos). */
export default function PaginaQrVisitar({ searchParams }: { searchParams: Pesquisa }) {
  return (
    <Suspense fallback={<QrVisitar lingua={null} />}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}
