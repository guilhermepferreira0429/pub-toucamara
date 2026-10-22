import { Suspense } from "react";
import { PaginaAtestado } from "@/components/municipe/atestado";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Atestado" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaAtestado codigo={codigo} />;
}

/** O atestado da junta: o link do SMS e o que o QR do PDF abre. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
