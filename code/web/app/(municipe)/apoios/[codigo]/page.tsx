import { Suspense } from "react";
import { PaginaApoios } from "@/components/municipe/apoios";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Os seus apoios" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaApoios codigo={codigo} />;
}

/** Os apoios a que pode ter direito: o link do SMS, com o que entregar e "pedir". */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
