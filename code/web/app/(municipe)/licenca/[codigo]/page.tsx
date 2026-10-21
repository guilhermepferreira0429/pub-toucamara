import { Suspense } from "react";
import { PaginaLicenca } from "@/components/municipe/licenca";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Licença" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaLicenca codigo={codigo} />;
}

/** A licença com QR: o link do SMS e o que o QR abre. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
