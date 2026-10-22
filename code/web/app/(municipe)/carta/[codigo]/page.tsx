import { Suspense } from "react";
import { PaginaCarta } from "@/components/municipe/carta";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "A sua carta" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaCarta codigo={codigo} />;
}

/** "Não percebi esta carta": o link do SMS, do chat e da app. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
