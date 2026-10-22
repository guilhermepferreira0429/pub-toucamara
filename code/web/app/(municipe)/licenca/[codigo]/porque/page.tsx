import { Suspense } from "react";
import { ACarregar } from "@/components/municipe/moldura";
import { PaginaPorque } from "@/components/municipe/porque";

export const metadata = { title: "Porque foi aprovada" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaPorque codigo={codigo} />;
}

/** As regras aplicadas a uma licença e a versão em vigor nesse dia. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
