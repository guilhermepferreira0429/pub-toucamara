import { Suspense } from "react";
import { Resumo } from "@/components/municipe/resumo";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "O que tem de fazer" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <Resumo codigo={codigo} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
