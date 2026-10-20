import { Suspense } from "react";
import { ConversaPagina } from "@/components/atendimento/conversa-detalhe";
import { ACarregar } from "@/components/atendimento/ui";

/** Painel · Conversa (o id só se sabe no pedido: dentro de Suspense). */
export default function PaginaConversa() {
  return (
    <Suspense fallback={<ACarregar />}>
      <ConversaPagina />
    </Suspense>
  );
}
