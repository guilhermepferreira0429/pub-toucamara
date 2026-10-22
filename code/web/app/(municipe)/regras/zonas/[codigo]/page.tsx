import type { Metadata } from "next";
import { Suspense } from "react";
import { ACarregar } from "@/components/municipe/moldura";
import { PaginaRegrasZona } from "@/components/regras/regras-zona";

export const metadata: Metadata = {
  title: "Regras de uma zona do PDM",
  robots: { index: true, follow: true },
};

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaRegrasZona codigo={codigo} />;
}

/** As regras de uma zona do plano diretor municipal, o histórico e o verificador. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
