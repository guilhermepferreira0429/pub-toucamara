import type { Metadata } from "next";
import { Suspense } from "react";
import { ACarregar } from "@/components/municipe/moldura";
import { PaginaRegrasLicenca } from "@/components/regras/regras-licenca";

export const metadata: Metadata = {
  title: "Regras de uma licença",
  robots: { index: true, follow: true },
};

type Params = Promise<{ tipo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { tipo } = await params;
  return <PaginaRegrasLicenca tipo={tipo} />;
}

/** As regras de um tipo de licença, o histórico e o verificador. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
