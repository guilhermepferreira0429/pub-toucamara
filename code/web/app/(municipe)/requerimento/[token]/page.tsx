import { Suspense } from "react";
import { Requerimento } from "@/components/municipe/requerimento";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Rever e assinar" };

type Params = Promise<{ token: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { token } = await params;
  return <Requerimento token={token} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
