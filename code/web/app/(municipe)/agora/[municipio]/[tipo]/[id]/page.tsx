import { Suspense } from "react";
import { DetalheAgora } from "@/components/agora/detalhe";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "O que se passa perto de mim" };

type Params = Promise<{ municipio: string; tipo: string; id: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { municipio, tipo, id } = await params;
  return <DetalheAgora slug={decodeURIComponent(municipio)} tipo={tipo} id={id} />;
}

/** Um item do feed: obra, incidente, aviso, evento ou consulta (link dos SMS e do "avise-me"). */
export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
