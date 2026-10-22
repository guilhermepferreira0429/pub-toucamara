import { Suspense } from "react";
import { EntregaMunicipe } from "@/components/entregas/entrega-municipe";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Autorizar a entrega" };

type Params = Promise<{ token: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { token } = await params;
  return <EntregaMunicipe token={token} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
