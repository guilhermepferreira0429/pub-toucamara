import { Suspense } from "react";
import { PaginaListaEmpresa } from "@/components/empresas/pagina-lista";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "O que a sua empresa precisa" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaListaEmpresa codigo={codigo} />;
}

/** A lista de uma empresa (link partilhável ou do SMS) e o calendário. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
