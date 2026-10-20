import { Suspense } from "react";
import { ConversasLista } from "@/components/atendimento/conversas-lista";
import { ACarregar } from "@/components/atendimento/ui";

/** Painel · Conversas (filtros no URL). */
export default function PaginaConversas() {
  return (
    <Suspense fallback={<ACarregar />}>
      <ConversasLista />
    </Suspense>
  );
}
