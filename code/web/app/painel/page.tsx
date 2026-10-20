import { Suspense } from "react";
import { VisaoGeral } from "@/components/atendimento/visao-geral";
import { ACarregar } from "@/components/atendimento/ui";

/** Painel · Visão geral (o período vem em ?periodo=). */
export default function PaginaVisaoGeral() {
  return (
    <Suspense fallback={<ACarregar />}>
      <VisaoGeral />
    </Suspense>
  );
}
