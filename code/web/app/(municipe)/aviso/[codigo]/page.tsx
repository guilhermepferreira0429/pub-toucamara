import { Suspense } from "react";
import { Aviso } from "@/components/municipe/aviso";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Aviso da câmara" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <Aviso codigo={codigo} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
