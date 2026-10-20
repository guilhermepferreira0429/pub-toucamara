import { Suspense } from "react";
import { Entrada } from "@/components/atendimento/entrada";
import { ACarregar } from "@/components/atendimento/ui";

/** V2 · Entrada (filtros e item aberto no URL: ?canal=&tipo=&item=tipo:id). */
export default function PaginaEntrada() {
  return (
    <Suspense fallback={<ACarregar />}>
      <Entrada />
    </Suspense>
  );
}
