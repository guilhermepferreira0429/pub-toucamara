import { Suspense } from "react";
import { Processo } from "@/components/municipe/processo";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "O seu processo" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <Processo codigo={codigo} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
