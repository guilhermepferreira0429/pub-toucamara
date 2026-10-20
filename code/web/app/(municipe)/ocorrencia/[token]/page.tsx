import { Suspense } from "react";
import { Ocorrencia } from "@/components/municipe/ocorrencia";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "A sua ocorrência" };

type Params = Promise<{ token: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { token } = await params;
  return <Ocorrencia token={token} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
