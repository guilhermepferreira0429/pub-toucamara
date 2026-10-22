import { Suspense } from "react";
import { PaginaConsulta } from "@/components/municipe/consulta";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Consulta pública" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaConsulta codigo={codigo} />;
}

/** A consulta pública: o que está em causa, participar com o telemóvel e o resultado. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
