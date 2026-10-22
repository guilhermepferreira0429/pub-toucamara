import { Suspense } from "react";
import { DetalheConsultaPublica } from "@/components/consultas/consulta";

export const metadata = { title: "Consulta pública" };

type Params = Promise<{ id: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { id } = await params;
  return <DetalheConsultaPublica id={id} />;
}

/** Uma consulta pública: resultados por freguesia e opiniões. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense>
      <Conteudo params={params} />
    </Suspense>
  );
}
