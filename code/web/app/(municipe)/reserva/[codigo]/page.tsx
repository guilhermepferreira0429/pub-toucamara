import { Suspense } from "react";
import { PaginaReserva } from "@/components/municipe/reserva";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Reserva" };

type Params = Promise<{ codigo: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { codigo } = await params;
  return <PaginaReserva codigo={codigo} />;
}

/** A reserva ou o bilhete (com QR): o link do SMS. */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
