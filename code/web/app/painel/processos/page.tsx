import { Suspense } from "react";
import { ListaProcessos } from "@/components/processos/lista-processos";
import { ACarregar } from "@/components/processos/ui";

export default function PaginaProcessos() {
  return (
    <Suspense fallback={<ACarregar className="px-10 pt-10" />}>
      <ListaProcessos />
    </Suspense>
  );
}
