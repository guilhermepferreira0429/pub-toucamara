import { Suspense } from "react";
import { PaginaDocumento } from "@/components/municipe/documento";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Documento em linguagem simples" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaDocumento codigo={codigo} />;
}

/** Um edital ou regulamento em linguagem simples, com o texto oficial completo. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
