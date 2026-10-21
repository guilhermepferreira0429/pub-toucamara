import { Suspense } from "react";
import { PaginaReclamacao } from "@/components/municipe/reclamacao";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Reclamação" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaReclamacao codigo={codigo} />;
}

/** A reclamação (link do SMS): estado, prazo de resposta e a resposta. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
