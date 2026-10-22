import { Suspense } from "react";
import { ACarregar } from "@/components/municipe/moldura";
import { PaginaZona } from "@/components/municipe/zona";

export const metadata = { title: "O que posso fazer" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaZona codigo={codigo} />;
}

/** "O que posso fazer nesta morada": a planta, a zona do PDM e os passos. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
