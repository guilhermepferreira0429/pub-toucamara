import { PainelOcorrencias } from "@/components/painel-ocorrencias/painel-ocorrencias";

/** Link direto para uma ocorrência: a mesma página, com ela aberta. */
export default async function PaginaOcorrencia({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PainelOcorrencias inicial={id} />;
}
