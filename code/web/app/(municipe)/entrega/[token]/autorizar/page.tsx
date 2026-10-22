import { Suspense } from "react";
import { CmdSimulada } from "@/components/entregas/cmd-simulada";
import { ACarregar } from "@/components/municipe/moldura";

export const metadata = { title: "Chave Móvel Digital (simulação)" };

type Params = Promise<{ token: string }>;

async function Conteudo({ params }: { params: Params }) {
  const { token } = await params;
  return <CmdSimulada token={token} />;
}

export default function Pagina({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ACarregar />}>
      <Conteudo params={params} />
    </Suspense>
  );
}
