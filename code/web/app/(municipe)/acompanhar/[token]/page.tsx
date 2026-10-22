import { Suspense } from "react";
import { PaginaAcompanhar } from "@/components/municipe/acompanhar";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Acompanhar a chamada" };

type Params = Promise<{ token: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { token } = await params;
  return <PaginaAcompanhar token={token} />;
}

/** "Fale com o meu filho" na chamada web: o link do SMS do familiar. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
