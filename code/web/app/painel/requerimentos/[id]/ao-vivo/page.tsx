import { Suspense } from "react";
import { RequerimentoAoVivo } from "@/components/processos/requerimento-ao-vivo";
import { ACarregar } from "@/components/processos/ui";

export default function PaginaRequerimentoAoVivo() {
  return (
    <Suspense fallback={<ACarregar className="px-10 pt-10" />}>
      <RequerimentoAoVivo />
    </Suspense>
  );
}
