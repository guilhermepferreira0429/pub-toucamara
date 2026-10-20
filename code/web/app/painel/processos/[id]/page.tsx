import { Suspense } from "react";
import { FichaProcesso } from "@/components/processos/ficha-processo";
import { ACarregar } from "@/components/processos/ui";

export default function PaginaProcesso() {
  return (
    <Suspense fallback={<ACarregar className="px-10 pt-10" />}>
      <FichaProcesso />
    </Suspense>
  );
}
