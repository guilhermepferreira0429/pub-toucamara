import { Suspense } from "react";
import { Pagamento } from "@/components/municipe/pagamento";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Pagar" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <Pagamento codigo={codigo} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
