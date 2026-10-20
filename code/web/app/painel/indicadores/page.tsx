import { Suspense } from "react";
import { Indicadores } from "@/components/atendimento/indicadores";
import { ACarregar } from "@/components/atendimento/ui";

/** Indicadores (atendimento e processos) e "Pergunte ao painel". */
export default function PaginaIndicadores() {
  return (
    <Suspense fallback={<ACarregar />}>
      <Indicadores />
    </Suspense>
  );
}
