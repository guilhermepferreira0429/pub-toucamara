import { Suspense } from "react";
import { Marcacao } from "@/components/municipe/marcacao";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "A sua marcação" };

type Params = Promise<{ token: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { token } = await params;
  return <Marcacao token={token} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
