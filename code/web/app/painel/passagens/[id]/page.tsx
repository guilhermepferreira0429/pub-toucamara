import { Suspense } from "react";
import { PassagemPagina } from "@/components/atendimento/passagem-pagina";
import { ACarregar } from "@/components/atendimento/ui";

/** Passagem a funcionário (sem frame próprio no design). */
export default function PaginaPassagem() {
  return (
    <Suspense fallback={<ACarregar />}>
      <PassagemPagina />
    </Suspense>
  );
}
